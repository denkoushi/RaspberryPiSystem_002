#!/usr/bin/env python3
"""Resolve the one API service selected by the canonical Pi5 Caddyfile."""

from __future__ import annotations

import re
import sys
from pathlib import Path


API_DIRECTIVE = re.compile(r"^\s*reverse_proxy\s+@api(?:\s|$)")
ACTIVE_API_DIRECTIVE = re.compile(
    r"^\s*reverse_proxy\s+@api\s+(api-(?:blue|green)):8080\s+\{\s*$"
)
WEB_DIRECTIVE = re.compile(r"^\s*reverse_proxy\s+(?!@)\S+")
ACTIVE_WEB_DIRECTIVE = re.compile(
    r"^\s*reverse_proxy\s+web-(blue|green):80\s+\{\s*$"
)


def resolve_active_api(config_text: str) -> str:
    api_directives = [line for line in config_text.splitlines() if API_DIRECTIVE.match(line)]
    web_directives = [line for line in config_text.splitlines() if WEB_DIRECTIVE.match(line)]
    if len(api_directives) != 1 or len(web_directives) != 1:
        raise ValueError("canonical API route is not singular")

    api_match = ACTIVE_API_DIRECTIVE.fullmatch(api_directives[0])
    web_match = ACTIVE_WEB_DIRECTIVE.fullmatch(web_directives[0])
    if api_match is None or web_match is None:
        raise ValueError("canonical route is invalid")

    api_service = api_match.group(1)
    if api_service.removeprefix("api-") != web_match.group(1):
        raise ValueError("canonical API and Web routes disagree")
    return api_service


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("resolver requires one canonical Caddyfile", file=sys.stderr)
        return 2

    try:
        config_text = Path(argv[0]).read_text(encoding="utf-8")
        active_api = resolve_active_api(config_text)
    except (OSError, UnicodeError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1

    print(active_api)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
