"""Module entry point for ``python3 -m scripts.git_lifecycle``."""

from .cli import main


if __name__ == "__main__":  # pragma: no cover - delegated to cli.main
    raise SystemExit(main())
