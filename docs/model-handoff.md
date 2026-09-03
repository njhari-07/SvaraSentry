# Model handoff contract

The application and training tracks meet at a PyTorch checkpoint. The runtime
expects this payload at `training/checkpoints/model.pt`:

```python
torch.save(
    {
        "format_version": 1,
        "model_name": "facebook/wav2vec2-base",
        "hidden_size": 256,
        "state_dict": model.state_dict(),
        "metrics": {"eer": 0.0, "accuracy": 0.0},
        "languages": ["en", "hi"],
    },
    "training/checkpoints/model.pt",
)
```

## Runtime assumptions

- Input is mono float32 audio at 16 kHz in `[-1, 1]`.
- Each inference window is 3 seconds; a new window arrives every second.
- `VoiceCloneDetector.forward()` returns one logit, a pooled voice embedding,
  and normalized temporal attention weights per sample in the batch.
- The embedding dimension must be stable between enrollment and live scoring.
- The runtime applies `sigmoid(logit)`; training should use
  `BCEWithLogitsLoss` and label synthetic audio as `1`.
- Calibration belongs in training/evaluation. If Platt scaling or temperature
  scaling is added, include those values in the checkpoint and update
  `backend/model_inference.py` before quoting risk probabilities.

`training/model.py` currently supplies a compact attentive head so the serving
boundary is concrete. If the final trainer uses a full AASIST graph-attention
head, change that module and the loader together while preserving the
`DetectorOutput` fields.

## Validate the handoff

1. Copy the checkpoint to `training/checkpoints/model.pt`.
2. Run `make ml-up`.
3. Confirm `/health` reports `checkpoint_loaded: true` and
   `model: wav2vec2-attentive`.
4. Stream a known bona-fide and known synthetic clip through the dashboard.
5. Verify scores against the offline evaluator before demo use.

