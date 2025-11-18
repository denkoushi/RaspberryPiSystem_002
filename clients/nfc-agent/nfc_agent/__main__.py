from __future__ import annotations

import asyncio
import logging

from .main import main as run_main


LOGGER = logging.getLogger("nfc_agent")


def main() -> None:
    try:
        asyncio.run(run_main())
    except KeyboardInterrupt:
        LOGGER.info("Agent stopped by user.")


if __name__ == "__main__":
    main()
