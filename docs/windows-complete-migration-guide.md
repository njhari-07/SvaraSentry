# SvaraSentry: Complete Windows Migration and Setup Guide

This guide rebuilds the current SvaraSentry workspace on a Windows machine, including the private Git repository, local datasets, augmentation assets, XLSR model files, Python/ML environment, GPU verification, Docker setup, manifests, and tests.

The commands below use **Windows PowerShell**. Run them in PowerShell, not Command Prompt.

## 1. What Git will and will not clone

Running `git clone` downloads the application source, tests, configurations, and documentation. It deliberately does **not** download the large local files listed in `.gitignore` and `.dockerignore`.

| Component | In Git? | Current local state | How Windows receives it |
|---|---:|---|---|
| Backend, frontend, training and tests | Yes | Complete | `git clone` |
| ASVspoof 2019 LA train + dev + protocols | No | 50,224 FLAC files, approximately 3.1 GB | Download and selectively extract `LA.zip`, or copy the existing folder |
| ASVspoof evaluation audio | No | Not currently installed | Do not extract when reproducing the current state |
| OpenSLR SLR28 noise/RIR assets | No | 935 noise and 60,325 RIR WAV files, approximately 3.6 GB | Download, extract, and reorganize `rirs_noises.zip`, or copy the existing folder |
| Wav2Vec2 XLSR-53 encoder | No | Four files, approximately 1.2 GB | Download from Hugging Face, or copy the existing folder |
| Team voice recordings | No | Empty placeholder | Record/copy later |
| Common Voice Hindi | No | Empty placeholder | Download later when selected by the dataset owner |
| Sarvam cloned speech | No | Empty placeholder | Generate/copy later |
| Trained checkpoint | No | No trained checkpoint yet | Produced by future training |
| Python virtual environment | No | Linux environment exists | Recreate on Windows; never copy a Linux `venv` |
| Docker images | No | Rebuildable | Rebuild with Docker Desktop |

To reproduce the project **as it currently exists**, install ASVspoof train/dev/protocols, SLR28, and XLSR. Leave the three empty dataset placeholders empty.

## 2. Disk-space requirement

Use a drive with at least **30 GB free**, preferably 40 GB or more. The temporary ZIP archives, extracted datasets, virtual environment, model, and Docker layers coexist during setup.

Recommended layout:

```text
D:\SvaraSentry\                  # Git repository
D:\SvaraSentry-downloads\        # Temporary ZIP downloads
```

If only the Windows `C:` drive has space, replace `D:` with `C:` in the commands.

Check available space:

```powershell
Get-PSDrive -PSProvider FileSystem
```

Do not place the download directory inside the repository. ZIP archives are source material, not project files, and would unnecessarily enlarge Git and Docker contexts.

## 3. Install Windows prerequisites

Open PowerShell as Administrator for the first installation step:

```powershell
winget install --id Git.Git -e
winget install --id GitHub.cli -e
winget install --id Python.Python.3.12 -e
winget install --id 7zip.7zip -e
winget install --id aria2.aria2 -e
winget install --id Docker.DockerDesktop -e
```

Close and reopen PowerShell so the new commands are available.

Verify them:

```powershell
git --version
gh --version
py -3.12 --version
7z --help
aria2c --version
docker --version
docker compose version
```

If `7z` is not found after reopening PowerShell, add its usual installation directory to the current session:

```powershell
$env:Path += ";C:\Program Files\7-Zip"
```

## 4. NVIDIA and WSL preparation

Install the latest compatible NVIDIA Windows driver for the RTX 4060 before installing CUDA-enabled PyTorch.

Official sources:

- NVIDIA drivers: <https://www.nvidia.com/Download/index.aspx>
- PyTorch installation selector: <https://pytorch.org/get-started/locally/>
- Docker Desktop for Windows: <https://docs.docker.com/desktop/setup/install/windows-install/>

Verify the GPU from PowerShell:

```powershell
nvidia-smi
```

The output must list the NVIDIA GeForce RTX 4060 Laptop GPU.

Docker Desktop should use its WSL 2 backend. Install or update WSL if necessary:

```powershell
wsl --install
wsl --update
wsl --version
```

Restart Windows if requested. Start Docker Desktop and select Linux containers with the WSL 2 engine.

> For this repository, model training is performed in the native Python environment with CUDA. Docker provides the shared application/test environment. The current Compose configuration does not expose the GPU to a training container.

## 5. Configure project paths

In a normal PowerShell window:

```powershell
$Project = "D:\SvaraSentry"
$Downloads = "D:\SvaraSentry-downloads"

New-Item -ItemType Directory -Force -Path $Downloads | Out-Null
```

Change both paths if using another drive or directory.

## 6. Authenticate and clone the private repository

Authenticate through GitHub's browser flow:

```powershell
gh auth login
```

Choose GitHub.com, HTTPS, and browser authentication. Then clone:

```powershell
git clone https://github.com/njhari-07/SvaraSentry.git $Project
Set-Location $Project
git switch main
git pull --ff-only origin main
```

Verify the repository:

```powershell
git remote -v
git status -sb
git log --oneline -5
```

The history must include at least:

```text
62ab08c feat: complete production audio augmentation pipeline
831fb24 docs: add project technology stack
a272248 feat: integrate dataset and training workflows
```

If newer commits exist on `main`, keep them; do not reset the branch backward.

## 7. Create the required local folders

```powershell
$Folders = @(
    "data\raw\real\team_recordings",
    "data\raw\real\common_voice_hindi",
    "data\raw\real\asvspoof_bonafide",
    "data\raw\fake\sarvam_cloned",
    "data\raw\fake\asvspoof",
    "data\processed",
    "data\manifests",
    "data\reports",
    "data\augmentation_assets\noise\pointsource",
    "data\augmentation_assets\noise\real_isotropic",
    "data\augmentation_assets\rir\real",
    "data\augmentation_assets\rir\simulated",
    "training\pretrained",
    "training\checkpoints",
    "runs"
)

$Folders | ForEach-Object {
    New-Item -ItemType Directory -Force -Path (Join-Path $Project $_) | Out-Null
}
```

## 8. Download ASVspoof 2019 LA

Official dataset page:

<https://datashare.ed.ac.uk/items/31074a11-b6f6-4e92-a4ad-07093f8c0c45>

Download the official 7.12 GB LA archive with resume support:

```powershell
$LaUrl = "https://datashare.ed.ac.uk/bitstreams/a9f87c35-f055-4015-80e2-2fdff0d46269/download"
$LaZip = Join-Path $Downloads "LA.zip"

aria2c -x 16 -s 16 -c $LaUrl -d $Downloads -o "LA.zip"
```

If the direct URL changes, open the official dataset page, select `LA.zip`, and save it as `$Downloads\LA.zip`.

Test the archive before extraction:

```powershell
7z t $LaZip
```

The command must finish with `Everything is Ok`.

### Selectively extract the current project partitions

The current workspace contains the training partition, development partition, and label protocols. It does not contain evaluation audio. Extract only those paths:

```powershell
7z x $LaZip "-o$Project\data\raw" `
    "LA\ASVspoof2019_LA_train\*" `
    "LA\ASVspoof2019_LA_dev\*" `
    "LA\ASVspoof2019_LA_cm_protocols\*" `
    -y
```

Required final layout:

```text
data\raw\LA\
├── ASVspoof2019_LA_train\flac\
├── ASVspoof2019_LA_dev\flac\
└── ASVspoof2019_LA_cm_protocols\
```

The protocol directory is mandatory because filenames do not contain the real/fake labels or attack types.

Verify file counts and protocol presence:

```powershell
$TrainCount = (Get-ChildItem "$Project\data\raw\LA\ASVspoof2019_LA_train\flac" -Filter *.flac).Count
$DevCount = (Get-ChildItem "$Project\data\raw\LA\ASVspoof2019_LA_dev\flac" -Filter *.flac).Count

"Train FLAC files: $TrainCount"
"Dev FLAC files:   $DevCount"

Get-ChildItem "$Project\data\raw\LA\ASVspoof2019_LA_cm_protocols"
```

Expected counts:

```text
Train FLAC files: 25380
Dev FLAC files:   24844
```

Keep `LA.zip` until the manifest and tests have passed. To match the current Linux workspace exactly, delete it afterward because the evaluation partition can be downloaded again later:

```powershell
Remove-Item $LaZip
```

Alternatively, keep the archive in `$Downloads`, outside the repository, if Windows has enough space.

## 9. Build the ASVspoof manifest on Windows

Do not copy the Linux-generated CSV manifest. It contains absolute Linux paths and must be rebuilt with Windows paths.

The official protocol-aware builder is:

```powershell
Set-Location $Project

python data_pipeline/build_manifest.py `
    --asvspoof-root data/raw/LA `
    --output data/manifests/dataset_manifest.csv
```

Expected result:

```text
Wrote 50224 rows to data\manifests\dataset_manifest.csv
```

Verify the CSV:

```powershell
$Manifest = Import-Csv "$Project\data\manifests\dataset_manifest.csv"

"Rows: $($Manifest.Count)"
$Manifest | Group-Object split | Select-Object Name, Count
$Manifest | Group-Object label | Select-Object Name, Count
$Manifest | Select-Object -First 3
```

Every `path` value should begin with the Windows project location and point to an existing FLAC file.

## 10. Download and arrange OpenSLR SLR28

Official dataset page:

<https://www.openslr.org/28/>

Download with resume support:

```powershell
$SlrUrl = "https://www.openslr.org/resources/28/rirs_noises.zip"
$SlrZip = Join-Path $Downloads "rirs_noises.zip"
$SlrStage = Join-Path $Downloads "SLR28-staging"

aria2c -x 16 -s 16 -c $SlrUrl -d $Downloads -o "rirs_noises.zip"
7z t $SlrZip
```

Only continue if `7z t` reports `Everything is Ok`.

Extract to a temporary staging directory:

```powershell
New-Item -ItemType Directory -Force -Path $SlrStage | Out-Null
7z x $SlrZip "-o$SlrStage" -y
```

Locate the extracted source root:

```powershell
$SlrSource = Join-Path $SlrStage "RIRS_NOISES"
if (-not (Test-Path $SlrSource)) {
    $SlrSource = $SlrStage
}

Get-ChildItem $SlrSource
```

The source must contain `pointsource_noises`, `real_rirs_isotropic_noises`, and `simulated_rirs`.

### Reorganize it into the paths expected by SvaraSentry

```powershell
$AssetRoot = Join-Path $Project "data\augmentation_assets"
$NoisePoint = Join-Path $AssetRoot "noise\pointsource"
$NoiseReal = Join-Path $AssetRoot "noise\real_isotropic"
$RirReal = Join-Path $AssetRoot "rir\real"
$RirSim = Join-Path $AssetRoot "rir\simulated"

New-Item -ItemType Directory -Force -Path $NoisePoint, $NoiseReal, $RirReal, $RirSim | Out-Null

Move-Item (Join-Path $SlrSource "pointsource_noises\*") $NoisePoint -Force
Move-Item (Join-Path $SlrSource "simulated_rirs\*") $RirSim -Force

Get-ChildItem (Join-Path $SlrSource "real_rirs_isotropic_noises") -Recurse -File -Filter *.wav |
    ForEach-Object {
        if ($_.Name -match "_noise_") {
            Move-Item $_.FullName (Join-Path $NoiseReal $_.Name) -Force
        }
        else {
            Move-Item $_.FullName (Join-Path $RirReal $_.Name) -Force
        }
    }

$SourceReadme = Get-ChildItem $SlrSource -File | Where-Object Name -Match "README" | Select-Object -First 1
if ($SourceReadme) {
    Copy-Item $SourceReadme.FullName (Join-Path $AssetRoot "SLR28_README") -Force
}
```

Validate the installed counts:

```powershell
$NoiseCount = (Get-ChildItem "$AssetRoot\noise" -Recurse -File -Filter *.wav).Count
$RirCount = (Get-ChildItem "$AssetRoot\rir" -Recurse -File -Filter *.wav).Count

"Noise WAV files: $NoiseCount"
"RIR WAV files:   $RirCount"
```

Expected result:

```text
Noise WAV files: 935
RIR WAV files:   60325
```

After those counts are correct, remove only the staging directory and ZIP:

```powershell
Remove-Item $SlrStage -Recurse -Force
Remove-Item $SlrZip
```

The installed assets remain under `data\augmentation_assets`.

## 11. Download the multilingual XLSR encoder

The project uses:

```text
facebook/wav2vec2-large-xlsr-53
revision c3f9d884181a224a6ac87bf8885c84d1cff3384f
```

Its local destination is:

```text
training\pretrained\wav2vec2-large-xlsr-53
```

Download the four required files directly so this step does not depend on the Python environment:

```powershell
$XlsrRevision = "c3f9d884181a224a6ac87bf8885c84d1cff3384f"
$XlsrDir = Join-Path $Project "training\pretrained\wav2vec2-large-xlsr-53"
$XlsrBase = "https://huggingface.co/facebook/wav2vec2-large-xlsr-53/resolve/$XlsrRevision"

New-Item -ItemType Directory -Force -Path $XlsrDir | Out-Null
aria2c -x 16 -s 16 -c "$XlsrBase/pytorch_model.bin?download=true" -d $XlsrDir -o "pytorch_model.bin"
aria2c -c "$XlsrBase/config.json?download=true" -d $XlsrDir -o "config.json"
aria2c -c "$XlsrBase/preprocessor_config.json?download=true" -d $XlsrDir -o "preprocessor_config.json"
aria2c -c "$XlsrBase/README.md?download=true" -d $XlsrDir -o "README.md"
```

Verify the files:

```powershell
Get-ChildItem "$Project\training\pretrained\wav2vec2-large-xlsr-53"
```

Expected files:

```text
README.md
config.json
preprocessor_config.json
pytorch_model.bin
```

XLSR is a pretrained multilingual speech encoder, not a labelled Indian-language dataset and not an already-trained deepfake detector.

## 12. Create the Windows Python/ML environment

Create a fresh environment. Never copy `venv/` from Linux because its executables and paths are operating-system specific.

```powershell
Set-Location $Project
py -3.12 -m venv venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip setuptools wheel
```

### Install CUDA-enabled PyTorch first

Open the official PyTorch selector and choose:

- OS: Windows
- Package: Pip
- Language: Python
- Compute platform: the newest CUDA option supported by the installed NVIDIA driver

Run the command generated by <https://pytorch.org/get-started/locally/>. Do not use the CPU-only index used by the Docker development image.

Immediately verify CUDA:

```powershell
python -c "import torch; print('torch:', torch.__version__); print('cuda build:', torch.version.cuda); print('cuda available:', torch.cuda.is_available()); print('gpu:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'NONE')"
```

Do not continue to training unless `cuda available` is `True` and the GPU name contains `RTX 4060`.

### Install the remaining project dependencies

```powershell
python -m pip install -r requirements-base.txt
python -m pip install -r requirements-ml.txt
python -m pip install -r requirements-dev.txt
python -m pip install --no-deps -e .
```

Because compatible CUDA-enabled `torch` and `torchaudio` were installed first, the requirements command should report them as already satisfied instead of replacing them.

Verify the important versions:

```powershell
python -c "import torch, torchaudio, transformers, imageio_ffmpeg; print('torch', torch.__version__); print('torchaudio', torchaudio.__version__); print('transformers', transformers.__version__); print('ffmpeg', imageio_ffmpeg.get_ffmpeg_version())"
```

Transformers must satisfy `>=4.49,<5`. The completed Linux workflow used version 4.57.6.

## 13. Validate the full augmentation configuration

The default configuration expects these paths:

```text
data\augmentation_assets\noise
data\augmentation_assets\rir
```

Load and index every augmentation asset:

```powershell
python -c "from pathlib import Path; from training.augmentations import load_augmentation_config, AugmentationAssets; c=load_augmentation_config(Path('training/configs/augmentation.yaml'), project_root=Path.cwd()); a=AugmentationAssets(c); print('noise:', len(a.noise)); print('rir:', len(a.rir))"
```

Expected output:

```text
noise: 935
rir: 60325
```

The first run can take several seconds because all assets are validated.

Generate a real 32-sample augmentation report:

```powershell
python -m training.augmentation_report `
    --manifest data/manifests/dataset_manifest.csv `
    --augmentation-config training/configs/augmentation.yaml `
    --output data/reports/augmentation-smoke.jsonl `
    --count 32 `
    --seed 42
```

Inspect it:

```powershell
Get-Content data/reports/augmentation-smoke.jsonl -TotalCount 5
```

The report should show a mixture of unchanged samples and effects such as noise, RIR, filtering, resampling, gain, speed, saturation, and Opus codec round-trips.

## 14. Verify the XLSR model on the RTX 4060

Run a forward-pass smoke test from the repository root:

```powershell
python -c "import torch; from training.model import VoiceCloneDetector; device=torch.device('cuda'); model=VoiceCloneDetector(model_name='training/pretrained/wav2vec2-large-xlsr-53').to(device).eval(); x=torch.zeros(1,48000,device=device); y=model(x); print('device:', torch.cuda.get_device_name(0)); print('logits:', y.logits); print('embedding shape:', tuple(y.embedding.shape)); print('finite:', bool(torch.isfinite(y.logits).all() and torch.isfinite(y.embedding).all())); print('peak GiB:', torch.cuda.max_memory_allocated()/1024**3)"
```

The exact model output value is unimportant. The command must use the RTX 4060, complete without an out-of-memory error, and report a finite output.

## 15. Run local automated verification

```powershell
python -m pytest -q
ruff check backend data_pipeline training tests
git diff --check
```

The completed integration produced:

```text
81 passed, 1 skipped
All checks passed!
```

A newer repository revision may contain more tests. New tests are acceptable; failures are not.

## 16. Docker Desktop setup

Before building, open Docker Desktop and confirm:

1. Docker uses Linux containers.
2. The WSL 2 backend is enabled.
3. Docker has sufficient disk space on the Windows drive.
4. `docker info` succeeds from PowerShell.

The repository's `.dockerignore` prevents the virtual environment, raw datasets, SLR28 assets, reports, runs, checkpoints, and downloaded XLSR weights from entering the build context. Those files remain on the host and are mounted only where Compose specifies them.

Build the shared development image:

```powershell
Set-Location $Project
docker compose build app
```

The transferred build context should remain small. It should not contain gigabytes of data or model files.

Run verification in Docker:

```powershell
docker compose run --rm app python -m pytest -q
docker compose run --rm app ruff check backend data_pipeline training tests
```

Start the development application:

```powershell
docker compose up app
```

Open:

- Dashboard: <http://127.0.0.1:8000>
- Phone relay: <http://127.0.0.1:8000/phone>
- API documentation: <http://127.0.0.1:8000/docs>
- Health endpoint: <http://127.0.0.1:8000/health>

Stop it with `Ctrl+C`, then:

```powershell
docker compose down
```

## 17. Model-serving mode

There is currently no trained detector checkpoint in the repository. The baseline application mode can still be used for integration testing:

```powershell
docker compose up app
```

After training produces a validated checkpoint, place it at:

```text
training\checkpoints\model.pt
```

Then start checkpoint inference:

```powershell
docker compose --profile ml up --build app-ml
```

Verify readiness:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health | ConvertTo-Json
```

Do not claim trained deepfake-recognition performance until a real checkpoint has been trained and evaluated.

## 18. Current dataset placeholders

The following folders are part of the planned dataset architecture but are empty in the current workspace:

```text
data\raw\real\team_recordings
data\raw\real\common_voice_hindi
data\raw\real\asvspoof_bonafide
data\raw\fake\sarvam_cloned
data\raw\fake\asvspoof
```

ASVspoof is currently consumed directly from `data\raw\LA` using its official protocols. Do not manually copy files into the `asvspoof_bonafide` and `fake\asvspoof` placeholders unless the team intentionally changes the manifest design.

Common Voice Hindi and Sarvam-cloned examples are future labelled sources. Downloading a multilingual XLSR encoder does not replace either source.

## 19. Faster alternative: copy the existing large folders

If the Linux files are accessible through an external SSD or network share, copying them avoids downloading and extracting again.

Copy these exact directories into the cloned Windows repository:

```text
Linux source                                      Windows destination
data/raw/LA                                       D:\SvaraSentry\data\raw\LA
data/augmentation_assets                         D:\SvaraSentry\data\augmentation_assets
training/pretrained/wav2vec2-large-xlsr-53       D:\SvaraSentry\training\pretrained\wav2vec2-large-xlsr-53
```

Example using an external drive mounted as `E:`:

```powershell
robocopy "E:\SvaraSentry-data\LA" "$Project\data\raw\LA" /E /Z /J /R:2 /W:2
robocopy "E:\SvaraSentry-data\augmentation_assets" "$Project\data\augmentation_assets" /E /Z /J /R:2 /W:2
robocopy "E:\SvaraSentry-data\wav2vec2-large-xlsr-53" "$Project\training\pretrained\wav2vec2-large-xlsr-53" /E /Z /J /R:2 /W:2
```

After copying, rebuild `data\manifests\dataset_manifest.csv` on Windows because the old manifest contains Linux absolute paths.

Do not copy:

- The Linux `venv/` directory
- Linux Docker images or Docker Desktop virtual disks
- Python cache directories
- The Linux manifest without rebuilding it

## 20. Final integrity checklist

Run from the activated Windows environment:

```powershell
Set-Location $Project

git status -sb
nvidia-smi
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'NO GPU')"

"ASV train: $((Get-ChildItem 'data\raw\LA\ASVspoof2019_LA_train\flac' -Filter *.flac).Count)"
"ASV dev:   $((Get-ChildItem 'data\raw\LA\ASVspoof2019_LA_dev\flac' -Filter *.flac).Count)"
"Noise:     $((Get-ChildItem 'data\augmentation_assets\noise' -Recurse -Filter *.wav).Count)"
"RIR:       $((Get-ChildItem 'data\augmentation_assets\rir' -Recurse -Filter *.wav).Count)"
"Manifest:  $((Import-Csv 'data\manifests\dataset_manifest.csv').Count)"

Test-Path 'training\pretrained\wav2vec2-large-xlsr-53\pytorch_model.bin'
python -m pytest -q
ruff check backend data_pipeline training tests
docker compose config
```

Expected key values:

| Check | Expected |
|---|---:|
| ASV train FLAC | 25,380 |
| ASV dev FLAC | 24,844 |
| Manifest rows | 50,224 |
| Noise WAV | 935 |
| RIR WAV | 60,325 |
| XLSR `pytorch_model.bin` | Present |
| CUDA available | `True` |
| GPU | RTX 4060 |
| pytest | No failures |
| Ruff | All checks passed |
| Docker Compose configuration | Valid |

## 21. Space cleanup after successful migration

Only after every integrity check passes:

```powershell
Remove-Item "$Downloads\LA.zip" -ErrorAction SilentlyContinue
Remove-Item "$Downloads\rirs_noises.zip" -ErrorAction SilentlyContinue
Remove-Item "$Downloads\SLR28-staging" -Recurse -Force -ErrorAction SilentlyContinue
```

Inspect Docker usage without deleting anything:

```powershell
docker system df
```

Avoid `docker system prune -a` unless you have reviewed the images and containers it will remove.

## 22. Normal commands after setup

Start a new PowerShell session:

```powershell
Set-Location D:\SvaraSentry
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\venv\Scripts\Activate.ps1
```

Pull team changes safely:

```powershell
git status -sb
git pull --ff-only origin main
```

Run the application natively:

```powershell
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

Run tests:

```powershell
python -m pytest -q
ruff check backend data_pipeline training tests
```

Run Docker:

```powershell
docker compose up --build app
```

This completes a reproducible Windows copy of the present SvaraSentry source, ASVspoof train/dev data, SLR28 augmentation collection, multilingual XLSR encoder, native GPU environment, and Docker development environment.
