#requires -Version 7.0
# Local fixtures and SSH configuration parsing only: never connects to SSH or reads customer data.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$client = Join-Path (Split-Path $PSScriptRoot -Parent) 'Backup-Namilux.ps1'
$recipient = 'age1' + ('a' * 58)
. $client -ServerHost 'backup.example.test' -SshKeyPath 'unused' -KnownHostsPath 'unused' -Recipient $recipient
$nativeTransport = ${function:Invoke-NamiluxProcess}
$generatedRunId = New-NamiluxRunId

function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw "FAIL: $Message" } }
function Assert-Throws([scriptblock]$Action, [string]$Message) {
    $threw = $false
    try { & $Action | Out-Null } catch { $threw = $true }
    Assert-True $threw $Message
}

$fixture = Join-Path ([IO.Path]::GetTempPath()) ('namilux-backup-client-' + [Guid]::NewGuid().ToString('N'))
$null = [IO.Directory]::CreateDirectory($fixture)
$key = Join-Path $fixture 'key with spaces'
$known = Join-Path $fixture 'known hosts'
$script:NamiluxExporter = Join-Path $fixture 'export.sh'
[IO.File]::WriteAllText($key, 'fixture key')
[IO.File]::WriteAllText($known, 'fixture known host')
[IO.File]::WriteAllText($script:NamiluxExporter, "#!/bin/bash`r`nprintf fixture`r`n")
$script:FixtureRunId = '20261008T120000Z-' + ('a' * 32)
$script:Payload = [byte[]](0, 1, 2, 10, 13, 128, 255)
$hasher = [Security.Cryptography.SHA256]::Create()
try { $script:Digest = -join ($hasher.ComputeHash($script:Payload) | ForEach-Object { $_.ToString('x2') }) } finally { $hasher.Dispose() }
$script:Calls = [Collections.Generic.List[object]]::new()
$script:Scenario = 'success'
function New-NamiluxRunId { return $script:FixtureRunId }
function Invoke-NamiluxProcess {
    param([string]$FilePath, [string[]]$Arguments, [string]$InputText = '')
    $script:Calls.Add(@{ File = $FilePath; Args = $Arguments; Input = $InputText })
    if ($FilePath -eq 'scp.exe') {
        [IO.File]::WriteAllBytes($Arguments[-1], $script:Payload)
        if ($script:Scenario -eq 'metadata-save-failure') {
            $metadataBlocker = Join-Path ([IO.Path]::GetDirectoryName($Arguments[-1])) "$script:FixtureRunId.json"
            $null = [IO.Directory]::CreateDirectory($metadataBlocker)
        }
        return @{ ExitCode = $(if ($script:Scenario -eq 'scp-failure') { 1 } else { 0 }); Output = '' }
    }
    if ($Arguments[-1] -like 'bash -s -- cleanup *') {
        return @{ ExitCode = $(if ($script:Scenario -like '*cleanup-failure') { 1 } else { 0 }); Output = '' }
    }
    if ($script:Scenario -eq 'malformed-metadata') { return @{ ExitCode = 0; Output = 'invalid JSON' } }
    if ($script:Scenario -eq 'create-failure') { return @{ ExitCode = 1; Output = 'untrusted output' } }
    $path = "/var/backups/namilux-customer/$script:FixtureRunId/namilux-backup.tar.gz.age"
    if ($script:Scenario -eq 'malicious-path') { $path = '/etc/shadow' }
    $hash = $(if ($script:Scenario -like 'bad-hash*') { '0' * 64 } else { $script:Digest })
    $size = $(if ($script:Scenario -eq 'bad-size') { $script:Payload.Length + 1 } else { $script:Payload.Length })
    return @{ ExitCode = 0; Output = (@{ runId = $script:FixtureRunId; path = $path; sha256 = $hash;
        bytes = $size; release = 'fixture-release' } | ConvertTo-Json -Compress) }
}

try {
    Assert-True ($generatedRunId -cmatch '^\d{8}T\d{6}Z-[a-f0-9]{32}$') 'UTC and unique run identifier format'
    $pwsh = (Get-Process -Id $PID).Path
    $probeText = "UTF8: نامی‌لوکس`n"
    $probe = & $nativeTransport -FilePath $pwsh -Arguments @('-NoProfile', '-NonInteractive', '-Command', '$m=[IO.MemoryStream]::new();[Console]::OpenStandardInput().CopyTo($m);[Console]::Out.Write([Convert]::ToBase64String($m.ToArray()))') -InputText $probeText
    Assert-True ($probe.ExitCode -eq 0 -and $probe.Output -ceq [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($probeText))) 'native stdin uses UTF8 without BOM'
    $probe = & $nativeTransport -FilePath $pwsh -Arguments @('-NoProfile', '-NonInteractive', '-File', $client, '-ServerHost', 'invalid;host', '-SshKeyPath', $key, '-KnownHostsPath', $known, '-Recipient', $recipient)
    Assert-True ($probe.ExitCode -ne 0) 'script entry exits nonzero for invalid input without transport'
    $errorProbe = Join-Path $fixture 'probe-error.ps1'
    [IO.File]::WriteAllText($errorProbe, @'
param($ClientPath, $KeyPath, $KnownPath, $AgeRecipient)
& (Join-Path $PSHOME 'pwsh.exe') -NoProfile -NonInteractive -File $ClientPath -ServerHost 'invalid;host' -SshKeyPath $KeyPath -KnownHostsPath $KnownPath -Recipient $AgeRecipient 2>&1 | ForEach-Object { [Console]::Out.WriteLine($_.ToString()) }
exit $LASTEXITCODE
'@)
    $probe = & $nativeTransport -FilePath $pwsh -Arguments @('-NoProfile', '-NonInteractive', '-File', $errorProbe, $client, $key, $known, $recipient)
    Assert-True ($probe.ExitCode -ne 0 -and $probe.Output.Contains('Invalid server host.')) 'entry failure retains actionable local validation details'
    $wrapperFixture = Join-Path $fixture 'wrapper'
    $null = [IO.Directory]::CreateDirectory($wrapperFixture)
    Copy-Item -LiteralPath $client -Destination (Join-Path $wrapperFixture 'Backup-Namilux.ps1')
    $wrapper = Join-Path (Split-Path $client -Parent) 'Run-Backup.ps1'
    Copy-Item -LiteralPath $wrapper -Destination (Join-Path $wrapperFixture 'Run-Backup.ps1')
    [IO.File]::WriteAllText((Join-Path $wrapperFixture 'settings.psd1'), "@{ ServerHost = 'invalid;host'; SshKeyPath = 'unused'; KnownHostsPath = 'unused'; Recipient = '$recipient' }")
    $probe = & $nativeTransport -FilePath $pwsh -Arguments @('-NoProfile', '-NonInteractive', '-File', (Join-Path $wrapperFixture 'Run-Backup.ps1'))
    Assert-True ($probe.ExitCode -eq 1) 'scheduled wrapper propagates child validation failure as exit 1 without SSH'
    $timeout = [Diagnostics.Stopwatch]::StartNew()
    Assert-Throws { & $nativeTransport -FilePath $pwsh -Arguments @('-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 30') -TimeoutSeconds 1 } 'native transport timeout'
    Assert-True ($timeout.Elapsed.TotalSeconds -lt 10) 'timeout terminates the owned local process promptly'
    # -G prints parsed configuration without connecting; -F NUL prevents local config hooks.
    $probe = & $nativeTransport -FilePath 'ssh.exe' -Arguments @('-G', '-F', 'NUL', '-o', "UserKnownHostsFile=`"$known`"", '127.0.0.1')
    $knownLine = @($probe.Output -split "`r?`n" | Where-Object { $_ -like 'userknownhostsfile *' })
    Assert-True ($probe.ExitCode -eq 0 -and $knownLine.Count -eq 1 -and $knownLine[0] -ceq "userknownhostsfile $known") 'OpenSSH parses the exact Windows known-hosts path including spaces'
    foreach ($hostName in @('127.0.0.1', 'backup.example.test', 'server-1')) { Assert-True (Test-NamiluxHost $hostName) "accept host $hostName" }
    foreach ($hostName in @('host;whoami', '-oProxyCommand=bad', 'host/path', '999.1.2.3', '127.1', 'a..b', 'a_b', "host`nother")) {
        Assert-True (-not (Test-NamiluxHost $hostName)) 'reject unsafe host'
    }
    Assert-True (-not (Test-NamiluxIPv4 '127.01.0.1')) 'reject ambiguous bind address'
    $base = @{ ServerHost = 'backup.example.test'; SshKeyPath = $key; KnownHostsPath = $known; Recipient = $recipient }
    Assert-Throws { Invoke-NamiluxBackup @base -BindAddress 'localhost' -Destination (Join-Path $fixture 'invalid-bind') } 'reject invalid bind'
    $bad = $base.Clone(); $bad.Recipient = $recipient.ToUpperInvariant()
    Assert-Throws { Invoke-NamiluxBackup @bad -Destination (Join-Path $fixture 'invalid-recipient') } 'reject uppercase recipient'
    foreach ($length in @(49, 121)) {
        $bad = $base.Clone(); $bad.Recipient = 'age1' + ('a' * $length)
        Assert-Throws { Invoke-NamiluxBackup @bad -Destination (Join-Path $fixture "invalid-recipient-$length") } 'reject recipient outside exporter length contract'
    }
    $bad = $base.Clone(); $bad.SshKeyPath = Join-Path $fixture 'missing'
    Assert-Throws { Invoke-NamiluxBackup @bad -Destination (Join-Path $fixture 'missing-key') } 'reject missing key'
    Assert-True ($script:Calls.Count -eq 0) 'invalid input never starts transport'
    $valid = @{ runId = $script:FixtureRunId; path = "/var/backups/namilux-customer/$script:FixtureRunId/namilux-backup.tar.gz.age";
        sha256 = $script:Digest; bytes = 7; release = 'fixture' }
    foreach ($field in @('runId', 'sha256', 'bytes')) {
        $badMetadata = $valid.Clone()
        $badMetadata[$field] = $(if ($field -eq 'bytes') { 7.5 } else { 'invalid' })
        Assert-Throws { ConvertFrom-NamiluxExport ($badMetadata | ConvertTo-Json -Compress) $script:FixtureRunId } "reject invalid metadata $field"
    }
    Assert-Throws { ConvertFrom-NamiluxExport '[]' $script:FixtureRunId } 'reject non-object metadata'

    $target = Join-Path $fixture 'success with spaces'
    $result = Invoke-NamiluxBackup @base -BindAddress '192.0.2.10' -Destination $target
    Assert-True ([IO.File]::Exists($result.Path)) 'final file exists'
    Assert-True ($result.Sha256 -ceq $script:Digest) 'binary checksum preserved'
    Assert-True (-not [IO.File]::Exists($result.Path + '.partial')) 'partial promoted'
    Assert-True ([IO.File]::Exists((Join-Path $target "$script:FixtureRunId.json"))) 'metadata exists'
    Assert-True ($script:Calls.Count -eq 3 -and $result.CleanupSucceeded) 'create, download, cleanup'
    Assert-True ($script:Calls[0].Args -contains 'StrictHostKeyChecking=yes') 'strict host verification'
    Assert-True ($script:Calls[0].Args -contains "UserKnownHostsFile=`"$known`"") 'explicit known hosts including spaces'
    Assert-True ($script:Calls[0].Args -contains '-b') 'SSH local bind requested'
    Assert-True ($script:Calls[1].Args -contains 'BindAddress=192.0.2.10') 'SCP local bind requested'
    Assert-True (-not $script:Calls[0].Input.Contains("`r")) 'exporter normalized to LF'
    Assert-True ($script:Calls[2].Args[-1] -ceq "bash -s -- cleanup $script:FixtureRunId") 'cleanup has no recipient'

    foreach ($scenario in @('malicious-path', 'malformed-metadata', 'create-failure', 'bad-hash', 'bad-size', 'scp-failure', 'metadata-save-failure')) {
        $script:Scenario = $scenario; $script:Calls.Clear()
        $target = Join-Path $fixture $scenario
        $failure = $null
        try { Invoke-NamiluxBackup @base -Destination $target | Out-Null } catch { $failure = $_.Exception.Message }
        Assert-True ($null -ne $failure -and $failure.Contains($script:FixtureRunId)) "reject $scenario with trusted run identifier"
        Assert-True (-not $failure.Contains('untrusted output')) 'remote failure output never appears in diagnostics'
        Assert-True (-not [IO.File]::Exists((Join-Path $target "$script:FixtureRunId.tar.gz.age"))) 'failure never produces final file'
        $failureJson = [IO.File]::ReadAllText((Join-Path $target "$script:FixtureRunId.failed.json"))
        $failureRecord = $failureJson | ConvertFrom-Json -AsHashtable
        Assert-True ($failureRecord.Count -eq 4 -and $failureRecord.runId -ceq $script:FixtureRunId -and $failureRecord.cleanupSucceeded -eq $true) 'failure record stores only trusted run, stage, time, and cleanup status'
        Assert-True ($failureRecord.stage.Length -gt 0 -and $failureJson -match '"failedAt":\s*"\d{4}-\d{2}-\d{2}T[^"\r\n]+Z"') 'failure record identifies a local step and UTC timestamp'
        $cleanupCalls = @($script:Calls | Where-Object { $_.Args[-1] -like 'bash -s -- cleanup *' })
        Assert-True ($cleanupCalls.Count -eq 1 -and $cleanupCalls[0].Args[-1] -ceq "bash -s -- cleanup $script:FixtureRunId") 'failure cleanup only uses locally generated run identifier'
        if ($scenario -in @('malicious-path', 'malformed-metadata', 'create-failure')) { Assert-True (@($script:Calls | Where-Object { $_.File -eq 'scp.exe' }).Count -eq 0) 'invalid metadata or failed export never reaches SCP' }
        else { Assert-True ([IO.File]::Exists((Join-Path $target "$script:FixtureRunId.tar.gz.age.partial"))) 'failed download or verification preserves partial' }
    }

    $script:Scenario = 'bad-hash-cleanup-failure'; $script:Calls.Clear()
    $cleanupWarnings = @()
    $failure = $null
    try { Invoke-NamiluxBackup @base -Destination (Join-Path $fixture 'failed-cleanup') -WarningVariable +cleanupWarnings -WarningAction SilentlyContinue | Out-Null } catch { $failure = $_.Exception.Message }
    Assert-True ($null -ne $failure -and $failure.Contains('checksum verification failed')) 'failed cleanup retains original backup failure'
    Assert-True ($cleanupWarnings.Count -eq 1 -and $cleanupWarnings[0].Message.Contains($script:FixtureRunId)) 'failed cleanup identifies the exact generated run for operator recovery'
    $failurePath = Join-Path (Join-Path $fixture 'failed-cleanup') "$script:FixtureRunId.failed.json"
    $failureRecord = [IO.File]::ReadAllText($failurePath) | ConvertFrom-Json -AsHashtable
    Assert-True ($failureRecord.cleanupSucceeded -eq $false) 'failure record persists cleanup failure for scheduled runs'

    $script:Scenario = 'create-failure'; $script:Calls.Clear()
    $target = Join-Path $fixture 'existing-failure-record'
    $null = [IO.Directory]::CreateDirectory($target)
    $failurePath = Join-Path $target "$script:FixtureRunId.failed.json"
    [IO.File]::WriteAllText($failurePath, 'previous failure record')
    Assert-Throws { Invoke-NamiluxBackup @base -Destination $target -WarningAction SilentlyContinue } 'failure record collision does not hide backup failure'
    Assert-True ([IO.File]::ReadAllText($failurePath) -ceq 'previous failure record') 'existing failure record is never overwritten'

    $script:Scenario = 'success'; $script:Calls.Clear()
    $target = Join-Path $fixture 'existing'
    $null = [IO.Directory]::CreateDirectory($target)
    $existing = Join-Path $target "$script:FixtureRunId.tar.gz.age"
    [IO.File]::WriteAllText($existing, 'precious previous backup')
    Assert-Throws { Invoke-NamiluxBackup @base -Destination $target } 'never overwrite existing backup'
    Assert-True ([IO.File]::ReadAllText($existing) -ceq 'precious previous backup') 'existing bytes unchanged'
    Assert-True ($script:Calls.Count -eq 0) 'collision detected before transport'

    $script:Scenario = 'cleanup-failure'; $script:Calls.Clear()
    $result = Invoke-NamiluxBackup @base -Destination (Join-Path $fixture 'cleanup-failure') -WarningAction SilentlyContinue
    Assert-True ([IO.File]::Exists($result.Path) -and -not $result.CleanupSucceeded) 'cleanup failure preserves successful local backup'
    Write-Host 'PASS: backup client validation, safe transport arguments, binary checksum, failure preservation, and cleanup fixtures.'
} finally {
    $resolvedFixture = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolvedFixture.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolvedFixture) -notmatch '^namilux-backup-client-[a-f0-9]{32}$') { throw 'Refusing unsafe fixture cleanup.' }
    Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
}
