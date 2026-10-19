"""Isolated environment for public OCI attestation verification."""

from __future__ import annotations

import os
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path


PUBLIC_ATTESTATION_TOKEN = "public-oci-attestation-verification"


@dataclass(frozen=True)
class AttestationEnvironment:
    values: dict[str, str]
    directory: Path


@contextmanager
def isolated_attestation_environment(
    token: str = "",
) -> Iterator[AttestationEnvironment]:
    """Provide a clean gh config without requiring a credential for public OCI."""
    with tempfile.TemporaryDirectory(prefix="public-oci-attestation-") as directory:
        values = os.environ.copy()
        values["GH_CONFIG_DIR"] = directory
        values["GH_TOKEN"] = token or PUBLIC_ATTESTATION_TOKEN
        values.pop("GITHUB_TOKEN", None)
        yield AttestationEnvironment(values=values, directory=Path(directory))
