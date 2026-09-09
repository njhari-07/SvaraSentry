"""Optional LangChain presentation layer for evidence-bound explanations.

No model provider is configured by default. Pass a LangChain runnable from
deployment code only after choosing and authorizing an LLM provider.
"""

from __future__ import annotations

import json
import os
from collections.abc import Mapping
from pathlib import Path
from typing import Protocol

SYSTEM_GUARDRAIL = """You explain voice-clone risk to a non-technical operator.
Use only the supplied structured evidence. Never claim that a spectrogram colour,
a specific frequency, or a model score proves a voice is fake. Preserve the stated
limits and recommended action. Use cautious, short, action-oriented language."""


class Runnable(Protocol):
    def invoke(self, input: object, /, **kwargs: object) -> object: ...


def create_groq_runnable(
    *,
    enabled: bool,
    model: str,
    api_key_file: Path | None = None,
    timeout_seconds: float = 5.0,
) -> Runnable | None:
    """Create the optional Groq presentation model without exposing its secret."""

    if not enabled:
        return None
    api_key = ""
    if api_key_file is not None:
        try:
            api_key = api_key_file.read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise RuntimeError("Could not read the configured Groq API-key file") from exc
    if not api_key:
        api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("LangChain is enabled but no Groq API key is configured")

    try:
        from langchain_groq import ChatGroq
    except ImportError as exc:
        raise RuntimeError("LangChain is enabled but langchain-groq is not installed") from exc

    return ChatGroq(
        model=model,
        api_key=api_key,
        temperature=0,
        timeout=timeout_seconds,
        max_retries=0,
    )


def rewrite_with_langchain(runnable: Runnable, explanation: Mapping[str, object]) -> dict[str, object]:
    """Rewrite structured evidence through a configured LangChain runnable.

    The deterministic explanation remains the source of truth. A failed or
    unsafe rewrite returns its original summary unchanged.
    """

    prompt = {
        "system": SYSTEM_GUARDRAIL,
        "evidence": dict(explanation),
        "required_output": "Return one concise paragraph only.",
    }
    try:
        result = runnable.invoke(json.dumps(prompt, ensure_ascii=False))
    except Exception:  # noqa: BLE001 - provider failures must never stop detector results.
        return {**explanation, "source": "deterministic-fallback"}
    candidate = str(getattr(result, "content", result)).strip()
    if not _safe_rewrite(candidate):
        return {**explanation, "source": "deterministic-fallback"}
    return {**explanation, "source": "langchain", "summary": candidate}


def _safe_rewrite(text: str) -> bool:
    if not text or len(text) > 900:
        return False
    lowered = text.lower()
    forbidden = ("definitely synthetic", "guaranteed real", "proves the voice", "fake frequency")
    return not any(phrase in lowered for phrase in forbidden)
