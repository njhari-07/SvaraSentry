"""Optional LangChain presentation layer for evidence-bound explanations.

No model provider is configured by default. Pass a LangChain runnable from
deployment code only after choosing and authorizing an LLM provider.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Protocol

SYSTEM_GUARDRAIL = """You explain voice-clone risk to a non-technical operator.
Use only the supplied structured evidence. Never claim that a spectrogram colour,
a specific frequency, or a model score proves a voice is fake. Preserve the stated
limits and recommended action. Use cautious, short, action-oriented language."""


class Runnable(Protocol):
    def invoke(self, input: object, /, **kwargs: object) -> object: ...


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
    result = runnable.invoke(json.dumps(prompt, ensure_ascii=False))
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
