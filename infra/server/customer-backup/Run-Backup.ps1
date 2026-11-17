#requires -Version 7.0
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
try {
    $config = Join-Path $PSScriptRoot 'settings.psd1'
    if (-not (Test-Path -LiteralPath $config -PathType Leaf)) {
        throw 'Copy settings.example.psd1 to settings.psd1 and fill in your own paths and public recipient.'
    }
    $settings = Import-PowerShellDataFile -LiteralPath $config
    $allowed = @('ServerHost', 'SshKeyPath', 'KnownHostsPath', 'Recipient', 'Destination', 'BindAddress')
    foreach ($key in $settings.Keys) {
        if ($key -notin $allowed) { throw "Unknown backup setting: $key" }
    }
    foreach ($key in @('ServerHost', 'SshKeyPath', 'KnownHostsPath', 'Recipient')) {
        if (-not $settings.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($settings[$key])) {
            throw "Missing required backup setting: $key"
        }
    }
    $global:LASTEXITCODE = 0
    & (Join-Path $PSScriptRoot 'Backup-Namilux.ps1') @settings
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
