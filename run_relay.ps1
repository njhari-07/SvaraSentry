param(
    [Parameter(Mandatory = $true)]
    [string]$PublicHost,
    [string]$Certificate = "certificates\svarasentry.pem",
    [string]$PrivateKey = "certificates\svarasentry-key.pem"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = $PSScriptRoot
$frontendRoot = Join-Path $repositoryRoot "frontend"
$python = Join-Path $repositoryRoot "venv\Scripts\python.exe"
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$checkpoint = Join-Path $repositoryRoot "training\checkpoints\model.pt"
$certificateInput = if ([IO.Path]::IsPathRooted($Certificate)) {
    $Certificate
} else {
    Join-Path $repositoryRoot $Certificate
}
$privateKeyInput = if ([IO.Path]::IsPathRooted($PrivateKey)) {
    $PrivateKey
} else {
    Join-Path $repositoryRoot $PrivateKey
}
$certificatePath = (Resolve-Path -LiteralPath $certificateInput).Path
$privateKeyPath = (Resolve-Path -LiteralPath $privateKeyInput).Path

if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    throw "Python environment not found: $python"
}
if (-not (Test-Path -LiteralPath $checkpoint -PathType Leaf)) {
    throw "Serving checkpoint not found: $checkpoint"
}

$frontendOrigin = "https://${PublicHost}:3000"
$apiOrigin = "https://${PublicHost}:8000"
$env:SVARASENTRY_MODEL_MODE = "checkpoint"
$env:SVARASENTRY_CHECKPOINT = $checkpoint
$env:SVARASENTRY_CAUTION_THRESHOLD = "0.55"
$env:SVARASENTRY_HIGH_THRESHOLD = "0.8793585300445557"
$env:SVARASENTRY_FRONTEND_ORIGIN = $frontendOrigin
$env:SVARASENTRY_CORS_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000,$frontendOrigin"
$env:SVARASENTRY_ALLOWED_DEV_ORIGINS = $PublicHost
$env:NEXT_PUBLIC_API_BASE = $apiOrigin
$env:NEXT_PUBLIC_PUBLIC_ORIGIN = $frontendOrigin

$backendArguments = @(
    "-m", "uvicorn", "backend.main:app",
    "--host", "0.0.0.0",
    "--port", "8000",
    "--ssl-keyfile", ('"' + $privateKeyPath + '"'),
    "--ssl-certfile", ('"' + $certificatePath + '"')
)
$backend = Start-Process -FilePath $python `
    -ArgumentList $backendArguments `
    -WorkingDirectory $repositoryRoot `
    -WindowStyle Hidden `
    -PassThru

try {
    Write-Host "Secure phone relay: $frontendOrigin/phone"
    Write-Host "The certificate must be trusted by the phone before microphone access will work."
    Set-Location -LiteralPath $frontendRoot
    & $npm run dev -- `
        --hostname 0.0.0.0 `
        --experimental-https `
        --experimental-https-key $privateKeyPath `
        --experimental-https-cert $certificatePath
}
finally {
    if (-not $backend.HasExited) {
        Stop-Process -Id $backend.Id -Force
    }
}
