# Multilingual XLSR encoder

The selected pretrained encoder is `facebook/wav2vec2-large-xlsr-53`, pinned to
revision `c3f9d884181a224a6ac87bf8885c84d1cff3384f`.
Official model card: https://huggingface.co/facebook/wav2vec2-large-xlsr-53

Local download destination: `training/pretrained/wav2vec2-large-xlsr-53`.
Only PyTorch weights, configuration, preprocessing configuration, and the model
card are downloaded; the redundant Flax weights are excluded. These large local
assets are ignored by Git.

XLSR is a pretrained multilingual speech encoder, not a labelled dataset or a
trained deepfake classifier. Indian-language recognition must be evaluated with
labelled genuine and synthetic speech in each target language. ASVspoof LA alone
does not establish Indian-language detection quality.

The existing detector accepts a configurable encoder and derives the projection
input width from that encoder's configuration:

```python
from training.model import VoiceCloneDetector

model = VoiceCloneDetector(
    model_name="training/pretrained/wav2vec2-large-xlsr-53",
)
```

The new attention/classification head still needs training. Loading this encoder
does not change the live application's model or existing checkpoints.

Use mono 16 kHz waveforms. Read the downloaded feature-extractor settings and
apply consistent normalization during training and serving; avoid normalizing
only one side of that boundary. Keep the original waveform for signal metrics.

XLSR-large uses more memory than wav2vec2-base. On an 8 GB GPU, begin with the
encoder frozen and a physical batch of one, measure memory, and increase only
after a successful forward/backward smoke test. Use mixed precision and gradient
accumulation; benchmark before deciding how many encoder layers to unfreeze.

Record the encoder ID and revision in checkpoints. A model trained with XLSR
cannot load a wav2vec2-base state dictionary interchangeably. Deployment must
provide the same encoder assets or instantiate the architecture from saved
configuration before loading the full trained state dictionary.
