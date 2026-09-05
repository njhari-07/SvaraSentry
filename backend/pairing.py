"""Pairing token management for mobile relay."""

import secrets
import time
from dataclasses import dataclass, field
from typing import Dict, Optional


@dataclass
class PairingToken:
    token: str
    session_id: str
    expires_at: float
    used: bool = False


class PairingManager:
    """Manages short-lived, single-use pairing tokens."""

    def __init__(self, ttl_seconds: int = 120):
        self.ttl_seconds = ttl_seconds
        self._tokens: Dict[str, PairingToken] = {}

    def generate(self, session_id: str) -> str:
        self._cleanup()
        token_str = secrets.token_urlsafe(32)
        expires_at = time.time() + self.ttl_seconds
        self._tokens[token_str] = PairingToken(
            token=token_str, session_id=session_id, expires_at=expires_at
        )
        return token_str

    def validate_and_consume(self, token_str: str) -> str:
        """Validates a pairing token and consumes it. Returns the session_id or raises ValueError."""
        self._cleanup()
        
        token = self._tokens.get(token_str)
        if not token:
            raise ValueError("Invalid or expired pairing token")
        
        if token.used:
            raise ValueError("Pairing token has already been used")
            
        if time.time() > token.expires_at:
            raise ValueError("Pairing token has expired")

        token.used = True
        return token.session_id

    def invalidate_session(self, session_id: str) -> None:
        """Invalidate any unused tokens for a given session."""
        for token in self._tokens.values():
            if token.session_id == session_id and not token.used:
                token.used = True

    def _cleanup(self) -> None:
        now = time.time()
        expired = [k for k, v in self._tokens.items() if now > v.expires_at or v.used]
        for k in expired:
            self._tokens.pop(k, None)

from backend.config import Settings
settings = Settings.from_env()

# Global singleton
pairing_manager = PairingManager(ttl_seconds=settings.pairing_token_ttl_seconds)
