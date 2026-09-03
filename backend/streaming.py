"""Streaming PCM buffering and overlapping analysis windows."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field


@dataclass(slots=True)
class AudioChunk:
    """One fixed-size signed 16-bit PCM analysis window."""

    pcm: bytes
    start_sample: int
    sample_rate: int

    @property
    def timestamp(self) -> float:
        return (self.start_sample + self.sample_count) / self.sample_rate

    @property
    def sample_count(self) -> int:
        return len(self.pcm) // 2


@dataclass(slots=True)
class PCMChunker:
    """Emit overlapping windows from arbitrarily sized PCM byte frames."""

    sample_rate: int = 16_000
    window_seconds: float = 3.0
    stride_seconds: float = 1.0
    sample_width: int = 2
    _buffer: bytearray = field(default_factory=bytearray, init=False, repr=False)
    _next_start_sample: int = field(default=0, init=False, repr=False)

    def __post_init__(self) -> None:
        if self.sample_rate <= 0 or self.sample_width <= 0:
            raise ValueError("sample_rate and sample_width must be positive")
        if self.window_seconds <= 0 or self.stride_seconds <= 0:
            raise ValueError("window_seconds and stride_seconds must be positive")
        if self.stride_samples > self.window_samples:
            raise ValueError("stride cannot be longer than the analysis window")

    @property
    def window_samples(self) -> int:
        return round(self.window_seconds * self.sample_rate)

    @property
    def stride_samples(self) -> int:
        return round(self.stride_seconds * self.sample_rate)

    @property
    def window_bytes(self) -> int:
        return self.window_samples * self.sample_width

    @property
    def stride_bytes(self) -> int:
        return self.stride_samples * self.sample_width

    def push(self, frame: bytes) -> list[AudioChunk]:
        if len(frame) % self.sample_width:
            raise ValueError("PCM frame ends with a partial sample")
        self._buffer.extend(frame)
        chunks: list[AudioChunk] = []

        while len(self._buffer) >= self.window_bytes:
            chunks.append(
                AudioChunk(
                    pcm=bytes(self._buffer[: self.window_bytes]),
                    start_sample=self._next_start_sample,
                    sample_rate=self.sample_rate,
                )
            )
            del self._buffer[: self.stride_bytes]
            self._next_start_sample += self.stride_samples

        return chunks

    def extend(self, frames: Iterable[bytes]) -> list[AudioChunk]:
        return [chunk for frame in frames for chunk in self.push(frame)]

    def reset(self) -> None:
        self._buffer.clear()
        self._next_start_sample = 0
