"""Pairing token management for mobile relay."""

import secrets
import time
from dataclasses import dataclass


@dataclass
class PairingToken:
    token: str
    session_id: str
    expires_at: float
    reconnect_expires_at: float | None = None
    revoked: bool = False


class PairingManager:
    """Manage one-time pairing with a short, revocable reconnect window."""

    def __init__(self, ttl_seconds: int = 120, reconnect_ttl_seconds: int = 60):
        self.ttl_seconds = ttl_seconds
        self.reconnect_ttl_seconds = reconnect_ttl_seconds
        self._tokens: dict[str, PairingToken] = {}

    def generate(self, session_id: str) -> str:
        self._cleanup()
        token_str = secrets.token_urlsafe(32)
        expires_at = time.time() + self.ttl_seconds
        self._tokens[token_str] = PairingToken(
            token=token_str, session_id=session_id, expires_at=expires_at
        )
        return token_str

    def validate_and_consume(self, token_str: str) -> str:
        """Validate initial pairing or an allowed reconnect and return its session."""
        self._cleanup()

        token = self._tokens.get(token_str)
        if not token:
            raise ValueError("Invalid or expired pairing token")

        now = time.time()
        if token.revoked:
            raise ValueError("Pairing token has been revoked")
        if token.reconnect_expires_at is None and now > token.expires_at:
            raise ValueError("Pairing token has expired")
        if token.reconnect_expires_at is not None and now > token.reconnect_expires_at:
            raise ValueError("Pairing reconnect window has expired")

        token.reconnect_expires_at = now + self.reconnect_ttl_seconds
        return token.session_id

    def revoke(self, token_str: str) -> None:
        """Revoke a token after an intentional stop."""
        token = self._tokens.get(token_str)
        if token is not None:
            token.revoked = True

    def invalidate_session(self, session_id: str) -> None:
        """Invalidate every pairing and reconnect token for a session."""
        for token in self._tokens.values():
            if token.session_id == session_id:
                token.revoked = True

    def _cleanup(self) -> None:
        now = time.time()
        expired = [
            key
            for key, token in self._tokens.items()
            if token.revoked
            or (
                token.reconnect_expires_at is None
                and now > token.expires_at
                or token.reconnect_expires_at is not None
                and now > token.reconnect_expires_at
            )
        ]
        for k in expired:
            self._tokens.pop(k, None)


from backend.config import Settings

settings = Settings.from_env()

# Global singleton
pairing_manager = PairingManager(
    ttl_seconds=settings.pairing_token_ttl_seconds,
    reconnect_ttl_seconds=settings.pairing_reconnect_ttl_seconds,
)
