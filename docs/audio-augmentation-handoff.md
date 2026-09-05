# Audio augmentation pipeline handoff

## Objective

Build a training-only waveform augmentation pipeline that improves SvaraSentry's
robustness to microphones, rooms, background noise, telephony, resampling, and
lossy codecs without changing the real/fake label or the serving input contract.

The pipeline must accept decoded mono audio and return exactly one model-ready
window:

- sample rate: 16,000 Hz
- shape: `[48_000]` for one example, or a documented batched equivalent
- dtype: `torch.float32`
- finite values only
- amplitude bounded to `[-1, 1]`
- label unchanged

Augmentation is enabled only for the training split. Validation and test audio
must use deterministic decode, resample, crop/pad, and amplitude-safety logic,
but no random augmentation.

## Why this matters

The detector must learn voice-generation artifacts rather than shortcuts such as
one dataset's codec, loudness, microphone, room, or noise floor. Therefore:

1. Apply every channel augmentation to both real and fake examples using the
   same probabilities and parameter distributions.
2. Never apply an augmentation only to one label or one source dataset.
3. Keep speaker, source, and generator split rules outside this module; the
   augmentation pipeline must not influence split assignment.
4. Preserve original raw audio. Augment dynamically during training unless a
   codec transform is explicitly cached as a reproducible derived artifact.
5. Do not peak-normalize every example. That destroys potentially useful natural
   level variation. Only prevent overflow/clipping at the end.

## Suggested repository changes

```text
training/
├── augmentations.py       # pipeline and individual waveform transforms
├── audio_dataset.py       # calls the pipeline for training examples only
└── configs/
    └── augmentation.yaml  # optional; a dataclass is also acceptable

tests/
└── test_augmentations.py
```

Keep augmentation independent from `training/model.py`. The model should only
receive already prepared tensors.

## Public interface

A suitable interface is:

```python
from dataclasses import dataclass

import torch


@dataclass(frozen=True)
class AugmentationConfig:
    sample_rate: int = 16_000
    window_samples: int = 48_000
    enabled: bool = True
    max_random_transforms: int = 3


class AudioAugmenter:
    def __init__(self, config: AugmentationConfig, assets=None) -> None:
        ...

    def __call__(
        self,
        waveform: torch.Tensor,
        *,
        generator: torch.Generator | None = None,
    ) -> torch.Tensor:
        """Return mono float32 audio with exactly `window_samples` values."""
```

`waveform` may arrive as `[samples]` or `[1, samples]`; normalize it internally
to one documented representation. Reject multichannel tensors unless the caller
has explicitly downmixed them. Do not silently accept the wrong sample rate.

For debugging and experiment analysis, optionally return metadata alongside the
audio:

```python
AugmentationResult(
    waveform=waveform,
    applied=[
        {"name": "gain", "db": -3.1},
        {"name": "noise", "snr_db": 17.4, "asset": "noise_042.wav"},
    ],
)
```

The training loop can log this metadata occasionally, but it must not become a
model input.

## Processing sequence

Use this order:

1. Validate tensor, dtype, dimensionality, and finite values.
2. Select a random three-second crop from long audio. For short audio, defer
   final padding until after length-changing transforms.
3. Optionally apply speed perturbation.
4. Optionally apply room/channel effects such as RIR convolution.
5. Optionally apply filtering, resampling degradation, and gain.
6. Optionally add background noise at a measured SNR.
7. Optionally apply a lossy-codec round trip.
8. Restore exactly 48,000 samples using a random crop in training and zero or
   reflection padding according to configuration.
9. Remove NaN/Inf by failing loudly during development; do not silently hide a
   broken transform.
10. Apply amplitude safety: if `abs().max() > 1`, scale the complete waveform
    just enough to fit, then clamp for floating-point edge cases.

Do not apply every transform to every example. Clean, unmodified examples must
remain common in training.

## Initial transform policy

Start with conservative values and make every range configurable.

| Transform | Probability | Initial range | Notes |
|---|---:|---|---|
| Leave unchanged | 0.20 | n/a | Skip all random transforms for roughly 20% of examples. |
| Gain | 0.45 | -8 to +6 dB | Scale waveform; final safety stage prevents overflow. |
| Background noise | 0.45 | 8 to 35 dB SNR | Mix real noise assets when available; calculate scale from active RMS. |
| Room impulse response | 0.25 | one sampled RIR | Convolve and trim; vary wet/dry mix from about 0.2 to 0.8. |
| Resampling degradation | 0.25 | 8, 12, 22.05, or 24 kHz and back | Simulates channel conversion while final output remains 16 kHz. |
| Band limiting / EQ | 0.25 | ±6 dB, broad bands | Include occasional telephone-like 300–3400 Hz filtering. |
| Speed perturbation | 0.20 | 0.95 to 1.05 | Must not introduce pitch/length bugs; restore final length afterward. |
| Soft clipping / saturation | 0.10 | mild only | Simulates overloaded capture, not deliberate destruction. |
| Lossy codec | 0.20 | several moderate bitrates | MP3/Opus/AAC only if binaries and licensing/deployment are controlled. |

`max_random_transforms=3` should cap the number selected for one example. Treat
the unchanged probability as a top-level decision before sampling transforms.

These are starting ranges, not permanent truth. Compare clean and augmented
validation subsets before making augmentation stronger.

## Transform implementation details

### Random crop and padding

- Training: choose a uniformly random start for files longer than 48,000 samples.
- Validation/test: use a deterministic policy, normally center crop or a fixed
  multi-window evaluator.
- Very short clips should normally have been rejected by dataset validation.
- For accepted clips shorter than three seconds, zero padding is simplest.
  Reflection padding is optional but must not fail on tiny inputs.
- Never loop/repeat short speech; repetition creates an artificial periodic cue.

### Gain

Convert sampled decibels to a multiplier:

```python
scale = 10 ** (gain_db / 20)
waveform = waveform * scale
```

Do not independently normalize afterward unless amplitude safety requires it.

### Background noise and SNR

Noise assets should include indoor, outdoor, traffic, fans, keyboard, crowd,
music bleed, electrical hum, and device/self-noise. Avoid noise clips containing
clearly intelligible speech unless speech interference is an intentional and
separately measured condition.

Calculate signal RMS over active/non-silent speech when possible. Given signal
RMS `s`, noise RMS `n`, and target SNR `r` in dB:

```text
target_noise_rms = s / 10^(r/20)
noise_scale = target_noise_rms / max(n, epsilon)
mixed = signal + noise * noise_scale
```

Handle silent signal or noise explicitly. Never divide by zero, and do not use a
silent clip to create an extreme multiplier.

Noise files must be decoded, mono-converted, and resampled to 16 kHz. Randomly
crop long noise and tile noise only when necessary. Record the chosen asset and
SNR in debug metadata.

### Room impulse response

- Normalize RIR energy before convolution.
- Randomly sample the RIR and wet/dry ratio.
- Use efficient one-dimensional convolution or FFT convolution.
- Trim delay/tail so final crop/pad remains well defined.
- Keep some clean examples; excessive reverberation can erase spoof artifacts.

### Resampling and filtering

Resampling degradation means downsample/upsample to an intermediate rate and
return to 16 kHz. Use a real band-limited resampler, not tensor indexing.

Filter parameters must stay below Nyquist. Telephone simulation should be an
occasional condition, not the default dataset sound.

### Speed perturbation

Keep the initial range narrow. Verify whether the chosen implementation changes
pitch; document the behavior. A length-changing implementation must be followed
by the common crop/pad stage. If the library API is unstable or produces device
transfers, omit this transform from version one rather than implementing an
incorrect resampler.

### Lossy codecs

Codec round trips are valuable but substantially slower and may require ffmpeg
or another external binary. Implement them behind a feature flag.

Preferred options:

1. Pre-generate a small, versioned cache of codec variants for training files;
   or
2. Apply codec augmentation in data-loader workers with bounded caching.

Never overwrite the original audio. Capture codec name, bitrate, and tool
version in metadata. Ensure real and fake examples receive identical codec
sampling probabilities.

## Asset management

Use configurable directories such as:

```text
data/augmentation_assets/
├── noise/
└── rir/
```

The asset loader should:

- recursively discover supported WAV/FLAC assets;
- validate and index them once at startup;
- reject corrupt, empty, or near-silent assets;
- avoid reading the entire collection into GPU memory;
- cache a bounded number of decoded assets per worker if useful;
- store asset licensing/provenance outside the training code;
- fail with a clear message when an enabled transform has no valid assets.

Generated/private assets should remain ignored by Git. Commit only configuration,
small test fixtures, and provenance documentation when licensing allows it.

## Reproducibility and data-loader workers

All randomness must come from a supplied or worker-seeded PyTorch generator, or
from another explicitly seeded RNG. Do not mix unseeded `random`, NumPy, and
PyTorch calls.

Requirements:

- same seed + same sample + same epoch context produces the same augmentation;
- different epochs may produce different versions of the same training sample;
- separate data-loader workers must not produce identical random sequences;
- validation and test output must be identical across runs;
- save the augmentation configuration and global seed with every experiment.

If strict per-sample reproducibility is required, derive a seed from the global
seed, epoch, sample ID, and worker/rank identity.

## CPU/GPU boundary and performance

The RTX 4060 should be reserved mainly for model forward/backward computation.
Audio decode, codec round trips, and most stochastic augmentation can run in
data-loader workers on CPU.

- Avoid copying individual transforms repeatedly between CPU and GPU.
- Return contiguous float32 tensors, then transfer batches with pinned memory
  and non-blocking copies.
- Benchmark loader throughput before increasing worker count.
- Do not assume more workers is always faster, especially with codec subprocesses.
- Cache decoded noise/RIR assets with a strict memory bound.

## Configuration example

The exact format is flexible, but all behavior must be captured in experiment
configuration:

```yaml
audio:
  sample_rate: 16000
  window_samples: 48000

augmentation:
  enabled: true
  unchanged_probability: 0.20
  max_random_transforms: 3
  gain:
    probability: 0.45
    min_db: -8.0
    max_db: 6.0
  noise:
    probability: 0.45
    min_snr_db: 8.0
    max_snr_db: 35.0
    asset_dir: data/augmentation_assets/noise
  rir:
    probability: 0.25
    min_wet: 0.20
    max_wet: 0.80
    asset_dir: data/augmentation_assets/rir
  resample:
    probability: 0.25
    intermediate_rates: [8000, 12000, 22050, 24000]
  speed:
    probability: 0.20
    min_factor: 0.95
    max_factor: 1.05
  codec:
    enabled: false
    probability: 0.20
```

## Required tests

Add unit tests using short synthetic tensors and tiny committed fixtures. At a
minimum test:

1. Output is always float32, finite, mono, bounded, and exactly 48,000 samples.
2. Input tensor is not mutated in place.
3. Every transform independently preserves the public contract.
4. Gain produces the expected numerical scale when clipping is not involved.
5. Noise mixing reaches the requested SNR within a reasonable tolerance.
6. Silent signal and silent noise do not create NaN, Inf, or extreme values.
7. Crop/pad handles empty, one-sample, short, exact, and long inputs according
   to the documented validation policy.
8. A fixed seed produces identical output and metadata.
9. Different seeds normally produce different output.
10. Disabled augmentation returns deterministic prepared audio.
11. Validation/test mode never applies stochastic transforms.
12. Missing RIR/noise assets produce a clear configuration error when enabled.
13. Both labels call the same augmentation path; no label is accepted by the
    augmenter API.
14. Codec tests are skipped cleanly when the optional binary is unavailable.

Also add a small integration test through the dataset class proving that only
the training split invokes random augmentation.

## Quality evaluation

Do not judge the pipeline only by listening to examples. Run controlled model
experiments:

1. Train a no-augmentation baseline.
2. Train with conservative channel augmentation.
3. Evaluate both on separate clean, noisy, reverberant, telephone, and codec
   subsets.
4. Compare ROC-AUC, PR-AUC, EER, and false-positive rate at the selected operating
   threshold.
5. Confirm augmented training does not materially damage clean-audio results.
6. Review metrics by language, source, speaker group, and fake engine.

Store a sample grid/report containing transform metadata and waveform statistics.
Listening checks are useful for catching broken SNR, excessive clipping, RIR
alignment errors, and codec failures, but test-set metrics decide whether a
transform remains enabled.

## Definition of done

The task is complete when:

- `AudioAugmenter` has a small, documented, testable API;
- output always matches the 16 kHz / 48,000-sample model contract;
- augmentation is training-only and independent of labels;
- clean examples remain in the training distribution;
- gain, noise, RIR, resampling/filtering, and optional speed transforms work;
- Opus codec augmentation is implemented behind a configuration flag;
- randomness is reproducible across runs and data-loader workers;
- configuration and applied-transform metadata can be logged;
- unit and dataset-integration tests pass;
- a benchmark shows the data loader keeps the GPU fed without unbounded memory
  or subprocess growth;
- a short README section explains configuration, assets, and known limitations.

## Explicit non-goals

This task does not include dataset collection, label correction, train/validation/
test splitting, model architecture changes, the optimizer/training loop, score
calibration, or serving-time augmentation. Coordinate with those components only
through the waveform contract described above.
