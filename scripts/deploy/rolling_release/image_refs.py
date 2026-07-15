"""Strict compatibility parser for immutable Pi5 release image references."""

from __future__ import annotations

import re
from typing import Any


_RELEASE_TAG_RE = re.compile(
    r"^(?P<sha>[0-9a-f]{40})-[0-9a-f]{12}(?:-[0-9a-f]{64})?$"
)


def release_sha_from_image(image: Any) -> str | None:
    """Return the release SHA for a legacy or run-scoped immutable tag."""

    if not isinstance(image, str):
        return None
    repository, separator, tag = image.rpartition(":")
    if not repository or not separator:
        return None
    match = _RELEASE_TAG_RE.fullmatch(tag)
    return match.group("sha") if match is not None else None


def image_matches_release(image: Any, sha: Any) -> bool:
    return isinstance(sha, str) and release_sha_from_image(image) == sha
