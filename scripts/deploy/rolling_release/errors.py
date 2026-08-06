"""Stable domain failures shared by rolling-release execution boundaries."""

from __future__ import annotations


class CanaryApprovalTimeout(RuntimeError):
    """The authoritative human canary gate expired before approval."""


class TerminalManifestCapturePreMutationError(RuntimeError):
    """Manifest capture failed with proof that no remote state was sealed."""
