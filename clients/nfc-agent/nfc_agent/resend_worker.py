from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Dict, Any

from .queue_store import QueueStore
from .config import AgentConfig

if TYPE_CHECKING:
    from .main import WebSocketManager

LOGGER = logging.getLogger("nfc_agent")


class ResendWorker:
    """
    オフライン時に保存されたキューイベントを、オンライン復帰後にWebSocket経由で再配信するワーカー
    """

    def __init__(
        self,
        queue_store: QueueStore,
        event_manager: "WebSocketManager",
        config: AgentConfig,
    ) -> None:
        self.queue_store = queue_store
        self.event_manager = event_manager
        self.config = config
        self._running = False
        self._task: asyncio.Task[None] | None = None

    async def _resend_queued_events(self) -> None:
        """
        キューに保存されたイベントをWebSocket経由で再配信する
        """
        if not self.event_manager.connections:
            # WebSocket接続がない場合はスキップ
            return

        events = self.queue_store.list_events(limit=100)
        if not events:
            return

        LOGGER.info("Resending %d queued events", len(events))
        successful_ids: list[int] = []

        for event_id, payload in events:
            try:
                # WebSocket経由で再配信
                payload_with_id = dict(payload)
                payload_with_id.setdefault("eventId", event_id)
                await self.event_manager.broadcast(payload_with_id)
                successful_ids.append(event_id)
                # 少し間隔を空けて送信（負荷軽減）
                await asyncio.sleep(0.1)
            except Exception as exc:
                LOGGER.warning("Failed to resend event %d: %s", event_id, exc)
                # エラーが発生した場合は、そのイベント以降の処理を停止
                # （順序を保つため）
                break

        if successful_ids:
            # 再送成功したイベントをキューから削除
            self.queue_store.delete(successful_ids)
            LOGGER.info("Resent and removed %d events from queue", len(successful_ids))

    async def _worker_loop(self) -> None:
        """
        バックグラウンドワーカーのメインループ
        定期的にキューをチェックして、WebSocket接続がある場合は再送を試みる
        """
        while self._running:
            try:
                await self._resend_queued_events()
                # 30秒ごとにチェック
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                LOGGER.error("Error in resend worker: %s", exc, exc_info=True)
                # エラーが発生した場合も30秒後に再試行
                await asyncio.sleep(30)

    def start(self) -> None:
        """ワーカーを開始"""
        if self._running:
            return

        self._running = True
        self._task = asyncio.create_task(self._worker_loop())
        LOGGER.info("Resend worker started")

    def stop(self) -> None:
        """ワーカーを停止"""
        if not self._running:
            return

        self._running = False
        if self._task:
            self._task.cancel()
        LOGGER.info("Resend worker stopped")

    async def wait_stopped(self) -> None:
        """ワーカーの停止を待つ"""
        if self._task:
            try:
                await self._task
            except asyncio.CancelledError:
                pass

