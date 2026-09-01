#!/usr/bin/env python3
"""Compatibility entry point for the Pi5 Docker release-image maintainer."""

from __future__ import annotations

import sys

from docker_image_retention import main


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
