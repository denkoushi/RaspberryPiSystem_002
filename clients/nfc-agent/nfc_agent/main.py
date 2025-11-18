import asyncio
import logging
from dataclasses import dataclass

LOGGER = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


@dataclass
class ReaderStatus:
    connected: bool
    message: str


def probe_reader() -> ReaderStatus:
    """pyscard 経由でリーダーを検出する仮実装。Milestone 2 で実装予定。"""
    try:
        import smartcard  # type: ignore # noqa: F401
    except ImportError:
        return ReaderStatus(False, "pyscard 未インストール")

    # 実機検証までは仮のレスポンス
    return ReaderStatus(False, "RC-S300/S1 との接続処理は未実装")


async def main() -> None:
    status = probe_reader()
    LOGGER.info("NFC Agent starting. Reader connected=%s, note=%s", status.connected, status.message)
    await asyncio.sleep(0)


if __name__ == "__main__":
    asyncio.run(main())
