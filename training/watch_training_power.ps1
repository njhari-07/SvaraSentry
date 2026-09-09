param(
    [Parameter(Mandatory = $true)]
    [int]$ControllerProcessId,
    [string]$LogPath = "runs/xlsr-full/power-guard.log",
    [int]$PollSeconds = 15
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$resolvedLogPath = Join-Path $projectRoot $LogPath

$powerProbeSource = @"
using System;
using System.Runtime.InteropServices;

public static class TrainingPowerProbe
{
    [StructLayout(LayoutKind.Sequential)]
    public struct SystemPowerStatus
    {
        public byte ACLineStatus;
        public byte BatteryFlag;
        public byte BatteryLifePercent;
        public byte SystemStatusFlag;
        public int BatteryLifeTime;
        public int BatteryFullLifeTime;
    }

    [DllImport("kernel32.dll")]
    public static extern bool GetSystemPowerStatus(out SystemPowerStatus status);
}
"@

Add-Type -TypeDefinition $powerProbeSource

function Get-TrainingPowerStatus {
    $status = New-Object TrainingPowerProbe+SystemPowerStatus
    if (-not [TrainingPowerProbe]::GetSystemPowerStatus([ref]$status)) {
        throw "GetSystemPowerStatus failed."
    }
    return $status
}

function Write-PowerGuardLog([string]$Message) {
    $timestamp = (Get-Date).ToString("o")
    "[$timestamp] $Message" | Add-Content -LiteralPath $resolvedLogPath -Encoding UTF8
}

$lastAcState = $null
$lastAlert = [datetime]::MinValue
Write-PowerGuardLog "Monitoring AC power for training controller PID $ControllerProcessId."

while (Get-Process -Id $ControllerProcessId -ErrorAction SilentlyContinue) {
    $power = Get-TrainingPowerStatus
    $acOnline = $power.ACLineStatus -eq 1
    if ($lastAcState -ne $acOnline) {
        $stateName = if ($acOnline) { "online" } else { "DISCONNECTED" }
        Write-PowerGuardLog "AC power $stateName; battery $($power.BatteryLifePercent)%."
        $lastAcState = $acOnline
    }

    if (-not $acOnline -and ((Get-Date) - $lastAlert).TotalSeconds -ge 60) {
        $message = "SvaraSentry training alert: charger disconnected; battery $($power.BatteryLifePercent)%. Reconnect power now."
        try {
            [console]::Beep(1400, 1000)
            & msg.exe * /TIME:60 $message 2>$null | Out-Null
        }
        catch {
            Write-PowerGuardLog "Could not display interactive alert: $($_.Exception.Message)"
        }
        Write-PowerGuardLog $message
        $lastAlert = Get-Date
    }
    Start-Sleep -Seconds $PollSeconds
}

Write-PowerGuardLog "Training controller exited; power monitoring stopped."
