param([switch]$Build)

$ErrorActionPreference = 'Stop'
$repositoryRoot = $PSScriptRoot
$command = Get-Command docker -ErrorAction SilentlyContinue
$dockerPath = if ($command) { $command.Source } else {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe'),
        (Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe')
    )
    $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
if (-not $dockerPath) { throw 'Docker CLI was not found. Start Docker Desktop or add docker.exe to PATH.' }
Set-Location -LiteralPath $repositoryRoot
& $dockerPath info --format '{{.ServerVersion}}'
if ($LASTEXITCODE -ne 0) { throw 'Docker engine is not ready. Start Docker Desktop and retry.' }
foreach ($asset in @('training\checkpoints\model.pt', 'training\pretrained\wav2vec2-large-xlsr-53\config.json', '.secrets\groq_api_key')) {
    if (-not (Test-Path -LiteralPath (Join-Path $repositoryRoot $asset) -PathType Leaf)) {
        throw "Required asset missing: $asset"
    }
}
& $dockerPath compose -f compose.production.yaml config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Production Compose configuration is invalid.' }
if ($Build) {
    & $dockerPath compose -f compose.production.yaml build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed; existing containers have not been replaced.' }
}
& $dockerPath compose -f compose.production.yaml up -d --wait --wait-timeout 240
if ($LASTEXITCODE -ne 0) { throw 'Production services did not become healthy.' }
$health = Invoke-RestMethod 'http://127.0.0.1:8000/health'
if (-not $health.checkpoint_loaded -or $health.mode -ne 'checkpoint') {
    throw 'Backend is reachable but the trained checkpoint is not active.'
}
Write-Output 'SvaraSentry is ready: http://127.0.0.1:3000/app'
Write-Output "Model: $($health.model); checkpoint phase $($health.checkpoint.phase), epoch $($health.checkpoint.epoch)"
