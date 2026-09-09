param(
    [string]$HostAddress = "127.0.0.1",
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$repositoryRoot = $PSScriptRoot
$python = Join-Path $repositoryRoot "venv\Scripts\python.exe"
$checkpoint = Join-Path $repositoryRoot "training\checkpoints\model.pt"

if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    throw "Python environment not found: $python"
}
if (-not (Test-Path -LiteralPath $checkpoint -PathType Leaf)) {
    throw "Serving checkpoint not found: $checkpoint"
}

$env:SVARASENTRY_MODEL_MODE = "checkpoint"
$env:SVARASENTRY_CHECKPOINT = $checkpoint
$env:SVARASENTRY_CAUTION_THRESHOLD = "0.55"
$env:SVARASENTRY_HIGH_THRESHOLD = "0.8793585300445557"

Set-Location -LiteralPath $repositoryRoot
& $python -m uvicorn backend.main:app --host $HostAddress --port $Port
