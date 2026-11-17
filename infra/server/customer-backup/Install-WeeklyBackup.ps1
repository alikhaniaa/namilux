#requires -Version 7.0
[CmdletBinding()]
param(
    [ValidateSet('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')]
    [string]$Day = 'Friday',
    [ValidatePattern('^([01][0-9]|2[0-3]):[0-5][0-9]$')]
    [string]$Time = '20:00'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Run this on the customer Windows backup computer.' }
Import-Module ScheduledTasks -ErrorAction Stop
$taskName = 'Namilux encrypted weekly backup'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    throw 'The Namilux backup task already exists. Review it in Task Scheduler instead of overwriting it.'
}
$runner = Join-Path $PSScriptRoot 'Run-Backup.ps1'
if ($runner.Contains('"') -or $runner.Contains("`n")) { throw 'Move the package to a simple Windows folder path.' }
$pwsh = (Get-Process -Id $PID).Path
# Prove credentials, verified host keys, encryption and destination access before scheduling.
& $pwsh -NoProfile -NonInteractive -File $runner
if ($LASTEXITCODE -ne 0) { throw 'Initial backup failed. No task was created.' }
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $pwsh -Argument ('-NoProfile -NonInteractive -File "' + $runner + '"') -WorkingDirectory $PSScriptRoot
$at = [datetime]::ParseExact($Time, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture)
$trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek $Day -At $at
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 3) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Download and verify an encrypted Namilux backup. PC must be on, connected, and the configured Windows user logged in.' | Out-Null
Write-Output "Created '$taskName': $Day at $Time in this PC's local time zone."
Write-Output 'Keep the computer connected and your Windows account logged in. Check the latest successful backup each week.'
