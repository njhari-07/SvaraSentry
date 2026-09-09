param(
    [string]$OutputDirectory = "runs/xlsr-full",
    [int]$PhaseAEpochs = 3,
    [int]$PhaseBEpochs = 5,
    [string]$ResumeCheckpoint = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot "venv\Scripts\python.exe"
$outputPath = Join-Path $projectRoot $OutputDirectory
$logPath = Join-Path $outputPath "full-training.log"
$statusPath = Join-Path $outputPath "training-status.json"

if (-not (Test-Path -LiteralPath $pythonPath -PathType Leaf)) {
    throw "Project virtual-environment Python was not found: $pythonPath"
}

New-Item -ItemType Directory -Path $outputPath -Force | Out-Null

$executionStateSource = @"
using System;
using System.Runtime.InteropServices;

public static class TrainingPowerState
{
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint executionState);
}
"@

Add-Type -TypeDefinition $executionStateSource
$continuous = [uint32]2147483648
$systemRequired = [uint32]0x00000001
$awayModeRequired = [uint32]0x00000040
$requestedState = $continuous -bor $systemRequired -bor $awayModeRequired
$powerStateResult = [TrainingPowerState]::SetThreadExecutionState($requestedState)
if ($powerStateResult -eq 0) {
    throw "Windows rejected the request to prevent system sleep during training."
}

$startedAt = (Get-Date).ToString("o")
@{
    state = "running"
    started_at = $startedAt
    process_id = $PID
    output_directory = $outputPath
    log = $logPath
    phase_a_epochs = $PhaseAEpochs
    phase_b_epochs = $PhaseBEpochs
    resumed_from = $ResumeCheckpoint
} | ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding UTF8

$trainingPhase = if ($ResumeCheckpoint) { "b" } else { "all" }
$trainingArguments = @(
    "-u",
    "-m", "training.train",
    "--manifest", "data/manifests/dataset_manifest.csv",
    "--output", $OutputDirectory,
    "--phase", $trainingPhase,
    "--phase-a-epochs", $PhaseAEpochs,
    "--phase-b-epochs", $PhaseBEpochs,
    "--batch-size", "1",
    "--gradient-accumulation", "8",
    "--workers", "0",
    "--max-steps-per-epoch", "0",
    "--validation-max-examples", "0",
    "--augmentation-config", "training/configs/augmentation.yaml",
    "--unfreeze-layers", "4",
    "--log-every", "100",
    "--device", "cuda",
    "--gradient-checkpointing"
)

if ($ResumeCheckpoint) {
    $trainingArguments += @("--resume", $ResumeCheckpoint)
}

Push-Location $projectRoot
try {
    if ($ResumeCheckpoint) {
        "[$startedAt] Resuming training from $ResumeCheckpoint." |
            Tee-Object -FilePath $logPath -Append
    }
    else {
        "[$startedAt] Starting full Phase A + Phase B training." |
            Tee-Object -FilePath $logPath -Append
    }
    & $pythonPath @trainingArguments 2>&1 | Tee-Object -FilePath $logPath -Append
    $trainingExitCode = $LASTEXITCODE
    $finishedAt = (Get-Date).ToString("o")
    $finalState = if ($trainingExitCode -eq 0) { "complete" } else { "failed" }
    @{
        state = $finalState
        started_at = $startedAt
        finished_at = $finishedAt
        process_id = $PID
        exit_code = $trainingExitCode
        output_directory = $outputPath
        log = $logPath
        resumed_from = $ResumeCheckpoint
    } | ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding UTF8
    exit $trainingExitCode
}
catch {
    $failedAt = (Get-Date).ToString("o")
    $_ | Out-String | Tee-Object -FilePath $logPath -Append
    @{
        state = "failed"
        started_at = $startedAt
        finished_at = $failedAt
        process_id = $PID
        exit_code = 1
        error = $_.Exception.Message
        output_directory = $outputPath
        log = $logPath
        resumed_from = $ResumeCheckpoint
    } | ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding UTF8
    exit 1
}
finally {
    [void][TrainingPowerState]::SetThreadExecutionState($continuous)
    Pop-Location
}
