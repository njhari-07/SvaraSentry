# SvaraSentry Windows Migration and Docker Verification Report

**Verification date:** 8 September 2026  
**Repository:** `njhari-07/SvaraSentry`  
**Branch:** `main`  
**Workspace:** Windows with Docker Desktop and a native Python 3.12 virtual environment

## Outcome

The repository, Python environment, datasets, augmentation assets, pretrained model, and Docker development and production environments are installed and operational on Windows. The latest `main` changes are present at commit `3c434ea`. The Linux error checklist was treated as diagnostic reference material, and the Docker configuration was hardened against the relevant repeat failures.

## Migrated workspace inventory

| Item | Verified result |
|---|---:|
| ASVspoof 2019 LA training FLAC files | 25,380 |
| ASVspoof 2019 LA development FLAC files | 24,844 |
| Dataset manifest rows | 51,180 |
| Personal real recordings (6 speakers) | 13 |
| Personal fake recordings | 45 |
| CDAC Kannada real recordings | 300 clips / 40.75 minutes |
| CDAC Tamil real recordings | 300 clips / 38.67 minutes |
| Odia TTS real recordings | 300 clips / 34.89 minutes |
| Noise augmentation audio files | 935 |
| RIR augmentation audio files | 60,325 |
| Augmentation smoke-report rows | 32 |
| XLSR pretrained model file | 1,269,737,156 bytes |

All 51,180 manifest entries resolve to files on the local filesystem. The personal entries are grouped under six speaker names without naming fragmentation: Aditi, Diya, Harish, Keerti, Praj, and Pranathi. Praj has 3 real and 8 fake entries after the filename correction. The two available Hindi clips are excluded from the manifest as an unrepresentative language sample while their original files remain preserved. The manifest also contains 300 real clips each from the CDAC Kannada, CDAC Tamil, and Odia TTS sources; all 900 are verified FLAC, 16 kHz, and mono. The Odia subset retains 84 source speaker IDs. The pretrained XLSR model also completed a finite CUDA forward pass on the NVIDIA RTX 4060, producing a `(1, 256)` embedding.

## Leakage-safe split assignment

- Team recordings and matching cloned voices are grouped by identity: five speakers are in train and Harish is wholly in dev.
- CDAC Kannada and Tamil use reproducible seed-42 row-level splits because their source rows do not expose speaker IDs: 240 train and 60 dev clips per language.
- Odia uses its retained source speaker IDs: 240 train and 60 dev rows across 84 speakers (67 train and 17 dev speakers), with no speaker appearing in both splits.
- ASVspoof retains its protocol-authoritative train and dev assignments.
- No manifest rows remain `unspecified`.
- Remaining language metadata is normalized to ISO codes (`en`, `kn`, `or`, and `ta`) to prevent label fragmentation.

## Native Python environment

- Virtual environment: `venv`
- Python: 3.12
- PyTorch: 2.11.0 with CUDA 12.8
- TorchAudio: 2.11.0 with CUDA 12.8
- Transformers: 4.57.6, constrained below version 5
- CUDA availability: confirmed
- Dependency audit: no broken requirements
- Ruff: passed
- Pytest: passed, with one intentional skip

## Docker corrections

The following repeat-failure protections were added:

1. The base image now uses Python 3.12, matching the native Windows workspace.
2. PyTorch and TorchAudio are pinned together at 2.11.0.
3. Docker installs explicit matching CPU wheels: `2.11.0+cpu` for both packages.
4. Every ML and development image build runs `pip check` and fails on broken dependencies.
5. Package downloads use a 120-second timeout and 10 retries.
6. The development image inherits the same ML dependency layer as the ML runtime image.
7. Python source permissions are normalized inside images.
8. Ruff ignores only `EXE002`, a false positive caused by Docker Desktop exposing Windows bind-mounted Python files as executable.
9. `.dockerignore` explicitly excludes virtual environments, raw and processed data, augmentation assets, manifests, reports, pretrained weights, checkpoints, runs, and downloaded archives.
10. Node 24 multi-stage targets provide isolated frontend development, build, and standalone production images.
11. Compose exposes the backend on port 8000 and the frontend on port 3000 with the frontend configured to reach the backend.

## Docker verification evidence

| Check | Result |
|---|---|
| Compose configuration validation | Passed |
| Development image build | Passed |
| Production image build | Passed |
| Python in image | 3.12.14 |
| PyTorch in image | 2.11.0+cpu |
| TorchAudio in image | 2.11.0+cpu |
| Transformers in image | 4.57.6 |
| Dependency audit in container | No broken requirements |
| Ruff in Compose container | Passed |
| Pytest in Compose container | Passed, one intentional skip |
| Docker health status | Healthy |
| `/health` endpoint | `status: ok` |
| Frontend Node / npm | 24.20.0 / 11.19.0 |
| Frontend ESLint | Passed with zero errors or warnings |
| Frontend TypeScript check | Passed |
| Frontend production build | Passed |
| Frontend `/`, `/app`, and `/phone` | HTTP 200 |
| Application directory inside image | 1.5 MB |
| Large host assets found inside image | None |

The development images are available locally as `svarasentry-app:latest` and `svarasentry-frontend:latest`. The standalone production images are available as `svarasentry-app-prod:latest` and `svarasentry-frontend-prod:latest`. The development stack was left running after verification at `http://localhost:8000` and `http://localhost:3000`.

## Files changed for Docker reliability

- `.dockerignore`
- `Dockerfile`
- `pyproject.toml`
- `requirements-ml.txt`
- `frontend/app/page.tsx`
- `frontend/components/CodeBlock.tsx`
- `frontend/components/FluidBackground/FluidBackground.tsx`
- `frontend/components/Navbar.tsx`
- `frontend/components/PipelineScrub.tsx`
- `frontend/landing.js`
- `frontend/postcss.config.mjs`

These changes are currently uncommitted so they can be reviewed before committing or pushing.

## Non-blocking observation

The passing test suite emits one Starlette deprecation warning about an AnyIO type alias. It does not affect test results or runtime health. Docker currently has build cache and unused local volumes; they were deliberately not pruned because cleanup could remove unrelated or recoverable Docker data.

## Reverification commands

```powershell
docker compose build app frontend
docker compose run --rm app python -m pip check
docker compose run --rm app python -m pytest -q
docker compose run --rm app ruff check backend data_pipeline training tests
docker compose -f compose.production.yaml build app-prod frontend-prod
docker compose up -d app frontend
docker compose ps
docker compose down
```
