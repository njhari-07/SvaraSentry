# Augmentation asset provenance

SvaraSentry uses locally stored waveform assets only during model training.
They are excluded from Git through `data/augmentation_assets/` in `.gitignore`.

## Installed collection

| Field | Value |
| --- | --- |
| Dataset | OpenSLR SLR28, Room Impulse Response and Noise Database |
| Source | https://www.openslr.org/28/ |
| License | Apache License 2.0 |
| Downloaded | 2026-09-05 |
| Archive | `rirs_noises.zip` |
| Project placement | `data/augmentation_assets/` |

The local collection was assembled from these SLR28 paths:

- `simulated_rirs/` → `data/augmentation_assets/rir/`
- `pointsource_noises/` → `data/augmentation_assets/noise/`
- `real_rirs_isotropic_noises/*_rir_*` and `air_*` → `rir/`
- `real_rirs_isotropic_noises/*_noise_*` → `noise/`

At installation, the collection contained 60,325 RIR WAV files and 935 noise
WAV files. The augmentation loader performs its own startup validation and
silently excludes corrupt or near-silent individual files; it raises a clear
error if an explicitly configured asset directory has no valid files.

Do not place source speech or spoofed speech in `noise/`. Keep the downloaded
archive and this provenance record with any experiment metadata. If assets are
redistributed, retain the applicable license and attribution notices.
