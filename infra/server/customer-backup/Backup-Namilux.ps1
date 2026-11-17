#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ServerHost,
    [Parameter(Mandatory)][string]$SshKeyPath,
    [Parameter(Mandatory)][string]$KnownHostsPath,
    [Parameter(Mandatory)][string]$Recipient,
    [string]$Destination = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'NamiluxBackups'),
    [string]$BindAddress
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:NamiluxExporter = Join-Path $PSScriptRoot 'export.sh'

function Test-NamiluxIPv4([string]$Value) {
    if ($Value -notmatch '^(0|[1-9][0-9]{0,2})(\.(0|[1-9][0-9]{0,2})){3}$') { return $false }
    return @($Value.Split('.') | Where-Object { [int]$_ -gt 255 }).Count -eq 0
}

function Test-NamiluxHost([string]$Value) {
    if (Test-NamiluxIPv4 $Value) { return $true }
    if ($Value.Length -gt 253 -or $Value -match '^[0-9.]+$') { return $false }
    return $Value -cmatch '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$'
}

function Resolve-NamiluxFile([string]$Value, [string]$Label = 'Required local file') {
    if ([string]::IsNullOrWhiteSpace($Value)) { throw "$Label path is empty." }
    $full = [IO.Path]::GetFullPath($Value)
    if (-not [IO.File]::Exists($full)) { throw "$Label is missing." }
    return $full
}

function New-NamiluxRunId {
    return [DateTime]::UtcNow.ToString("yyyyMMdd'T'HHmmss'Z'", [Globalization.CultureInfo]::InvariantCulture) + '-' + [Guid]::NewGuid().ToString('N')
}

function Invoke-NamiluxProcess {
    param([string]$FilePath, [string[]]$Arguments, [string]$InputText = '', [ValidateRange(1, 7200)][int]$TimeoutSeconds = 7200)
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $FilePath
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardInputEncoding = [Text.UTF8Encoding]::new($false)
    foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    try {
        if (-not $process.Start()) { throw 'Backup transport could not start.' }
        $timer = [Diagnostics.Stopwatch]::StartNew()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $inputTask = $process.StandardInput.WriteAsync($InputText)
        if (-not $inputTask.Wait($TimeoutSeconds * 1000)) { throw 'Backup transport exceeded its time limit.' }
        $process.StandardInput.Close()
        $remaining = [Math]::Max(0, $TimeoutSeconds * 1000 - $timer.ElapsedMilliseconds)
        if (-not $process.WaitForExit([int]$remaining)) { throw 'Backup transport exceeded its time limit.' }
        foreach ($readTask in @($stdout, $stderr)) {
            $remaining = [Math]::Max(0, $TimeoutSeconds * 1000 - $timer.ElapsedMilliseconds)
            if (-not $readTask.Wait([int]$remaining)) { throw 'Backup transport exceeded its time limit.' }
        }
        $output = $stdout.GetAwaiter().GetResult()
        $null = $stderr.GetAwaiter().GetResult() # Transport diagnostics are never printed with secrets.
        return @{ ExitCode = $process.ExitCode; Output = $output }
    } catch {
        try { if (-not $process.HasExited) { $process.Kill($true); $null = $process.WaitForExit(5000) } } catch { }
        throw
    } finally { $process.Dispose() }
}

function ConvertFrom-NamiluxExport {
    param([string]$Output, [string]$RunId)
    try { $data = ConvertFrom-Json -InputObject $Output -AsHashtable -ErrorAction Stop }
    catch { throw 'The server returned invalid backup metadata.' }
    $required = @('runId', 'path', 'sha256', 'bytes', 'release')
    if ($data -isnot [Collections.IDictionary] -or $data.Count -ne $required.Count) { throw 'Unexpected backup metadata.' }
    foreach ($key in $required) { if (-not $data.Contains($key)) { throw 'Incomplete backup metadata.' } }
    $expected = "/var/backups/namilux-customer/$RunId/namilux-backup.tar.gz.age"
    if ($data.runId -isnot [string] -or $data.runId -cne $RunId -or $data.path -isnot [string] -or $data.path -cne $expected) {
        throw 'The server returned an unexpected backup location.'
    }
    if ($data.sha256 -isnot [string] -or $data.sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid backup checksum.' }
    if (($data.bytes -isnot [long] -and $data.bytes -isnot [int]) -or $data.bytes -le 0) { throw 'Invalid backup size.' }
    if ($data.release -isnot [string] -or $data.release.Length -gt 1024) { throw 'Invalid release metadata.' }
    return $data
}

function Invoke-NamiluxBackup {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ServerHost,
        [Parameter(Mandatory)][string]$SshKeyPath,
        [Parameter(Mandatory)][string]$KnownHostsPath,
        [Parameter(Mandatory)][string]$Recipient,
        [string]$Destination = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'NamiluxBackups'),
        [string]$BindAddress
    )
    if (-not (Test-NamiluxHost $ServerHost)) { throw 'Invalid server host.' }
    if ($Recipient -cnotmatch '^age1[a-z0-9]{50,120}$') { throw 'Invalid age recipient.' }
    if ($BindAddress -and -not (Test-NamiluxIPv4 $BindAddress)) { throw 'Invalid local bind address.' }
    if ([string]::IsNullOrWhiteSpace($Destination)) { throw 'Invalid destination.' }
    $key = Resolve-NamiluxFile $SshKeyPath 'SSH key file'
    $knownHosts = Resolve-NamiluxFile $KnownHostsPath 'SSH known-hosts file'
    $exporter = Resolve-NamiluxFile $script:NamiluxExporter 'Backup exporter script'
    $destinationPath = [IO.Path]::GetFullPath($Destination)
    $runId = New-NamiluxRunId
    $final = Join-Path $destinationPath "$runId.tar.gz.age"
    $partial = "$final.partial"
    $metadataPath = Join-Path $destinationPath "$runId.json"
    foreach ($candidate in @($final, $partial, $metadataPath)) {
        if (Test-Path -LiteralPath $candidate) { throw 'A backup file with this run identifier already exists.' }
    }
    $null = [IO.Directory]::CreateDirectory($destinationPath)
    $exportScript = [IO.File]::ReadAllText($exporter).Replace("`r`n", "`n").Replace("`r", "`n")
    $common = @('-o', 'StrictHostKeyChecking=yes', '-o', 'BatchMode=yes', '-o', "UserKnownHostsFile=`"$knownHosts`"",
        '-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3', '-i', $key)
    $sshArguments = @('-T', '-p', '22') + $common
    $scpArguments = @('-B', '-P', '22') + $common
    if ($BindAddress) {
        $sshArguments += @('-b', $BindAddress)
        $scpArguments += @('-o', "BindAddress=$BindAddress")
    }
    $remote = "root@$ServerHost"
    $step = 'creating the server backup'
    try {
        Write-Host 'Creating an encrypted server backup...'
        $result = Invoke-NamiluxProcess 'ssh.exe' ($sshArguments + @($remote, "bash -s -- create $runId $Recipient")) $exportScript
        if ($result.ExitCode -ne 0) { throw 'The server could not create the backup.' }
        $step = 'validating server metadata'
        $data = ConvertFrom-NamiluxExport $result.Output $runId

        # Reserve our partial path without replacing any existing file, then let SCP write binary bytes.
        $reservation = [IO.File]::Open($partial, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $reservation.Dispose()
        $step = 'downloading the backup'
        Write-Host 'Downloading and verifying the encrypted backup...'
        $result = Invoke-NamiluxProcess 'scp.exe' ($scpArguments + @("${remote}:$($data.path)", $partial))
        if ($result.ExitCode -ne 0) { throw 'The backup download failed; its partial file was preserved.' }
        $step = 'verifying the downloaded backup'
        $file = Get-Item -LiteralPath $partial
        if ($file.Length -ne $data.bytes) { throw 'Backup size verification failed; its partial file was preserved.' }
        $hash = (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($hash -cne $data.sha256.ToLowerInvariant()) { throw 'Backup checksum verification failed; its partial file was preserved.' }
        $step = 'saving the verified backup and metadata'
        if (Test-Path -LiteralPath $final) { throw 'The final backup path already exists.' }
        $metadata = [ordered]@{ runId = $runId; file = $final; sha256 = $hash; bytes = $data.bytes; release = $data.release;
            serverHost = $ServerHost; downloadedAt = [DateTime]::UtcNow.ToString('o') }
        $stream = [IO.File]::Open($metadataPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $writer = [IO.StreamWriter]::new($stream, [Text.UTF8Encoding]::new($false))
        try { $writer.Write(($metadata | ConvertTo-Json)) } finally { $writer.Dispose() }
        Move-Item -LiteralPath $partial -Destination $final -ErrorAction Stop
    } catch {
        $failure = $_.Exception.Message
        $cleaned = $false
        try {
            $cleanup = Invoke-NamiluxProcess 'ssh.exe' ($sshArguments + @($remote, "bash -s -- cleanup $runId")) $exportScript
            $cleaned = $cleanup.ExitCode -eq 0
        } catch { }
        try {
            $record = [ordered]@{ runId = $runId; stage = $step; failedAt = [DateTime]::UtcNow.ToString('o'); cleanupSucceeded = $cleaned }
            $failurePath = Join-Path $destinationPath "$runId.failed.json"
            $failureStream = [IO.File]::Open($failurePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            $failureWriter = [IO.StreamWriter]::new($failureStream, [Text.UTF8Encoding]::new($false))
            try { $failureWriter.Write(($record | ConvertTo-Json)) } finally { $failureWriter.Dispose() }
        } catch { Write-Warning "Could not save the local failure record for run $runId." }
        if (-not $cleaned) { Write-Warning "Temporary server backup cleanup failed for run $runId; an operator must retry cleanup for this run." }
        throw "Backup failed while $step (run $runId): $failure"
    }

    $cleaned = $false
    try {
        $result = Invoke-NamiluxProcess 'ssh.exe' ($sshArguments + @($remote, "bash -s -- cleanup $runId")) $exportScript
        $cleaned = $result.ExitCode -eq 0
    } catch { $cleaned = $false }
    if (-not $cleaned) { Write-Warning "The local backup is verified, but server cleanup failed for run $runId; an operator must retry cleanup for this run." }
    Write-Host "Backup complete: $final"
    Write-Host "SHA256: $hash"
    return [pscustomobject]@{ Path = $final; Sha256 = $hash; CleanupSucceeded = $cleaned }
}

# Dot-sourcing exposes helpers to the local fixture harness without executing any transport.
if ($MyInvocation.InvocationName -ne '.') {
    try { Invoke-NamiluxBackup @PSBoundParameters | Out-Null }
    catch {
        # All exception details originate locally; raw transport stderr is discarded above.
        [Console]::Error.WriteLine($_.Exception.Message)
        [Console]::Error.WriteLine('Backup did not complete. Existing backups were preserved; partial files may remain.')
        exit 1
    }
}
