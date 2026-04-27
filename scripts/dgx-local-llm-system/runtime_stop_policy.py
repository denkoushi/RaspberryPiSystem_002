"""
Blue backend の /stop 挙動（on-demand 実行 vs no-op）を制御するポリシー層。

control-server 本体の分岐を避け、将来のモード追加（always_on 等）をここに集約する。
互換: BLUE_LLM_RUNTIME_KEEP_WARM が未導入以前の真偽制御。優先: BLUE_LLM_RUNTIME_STOP_MODE。
"""
from __future__ import annotations

import os
import sys
from typing import Mapping, Literal, Union

# 公開契約: blue の /stop 解釈
BlueStopMode = Union[
    Literal["on_demand"],
    Literal["keep_warm"],
    Literal["always_on"],
]


def _parse_bool_for_policy(name: str, env: Mapping[str, str], default: bool = False) -> bool:
    raw = (env.get(name) or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _classify_stop_mode_token(raw: str) -> str:
    """
    BLUE_LLM_RUNTIME_STOP_MODE の1トークンを分類。
    戻り値: on_demand | keep_warm | always_on | __legacy__ | __invalid__
    __legacy__ は default/auto 等、レガシー真偽に委譲。
    """
    r = raw.strip().lower()
    if r in ("", "default", "auto", "legacy"):
        return "__legacy__"
    if r in ("on_demand", "on-demand", "strict", "stop"):
        return "on_demand"
    if r in ("keep_warm", "keep-warm", "warm", "retain", "no_stop", "noop", "no-op"):
        return "keep_warm"
    if r in ("always_on", "always-on", "resident", "persistent"):
        return "always_on"
    return "__invalid__"


def load_blue_stop_mode_from_env(
    env: Mapping[str, str] | None = None,
) -> BlueStopMode:
    """
    BLUE_LLM_RUNTIME_STOP_MODE（優先）と BLUE_LLM_RUNTIME_KEEP_WARM（互換）から blue の停止モードを解決。
    明示的な STOP_MODE が有効であれば常にそちらを採用する。
    """
    env = env or os.environ
    raw = (env.get("BLUE_LLM_RUNTIME_STOP_MODE") or "").strip()
    if raw:
        kind = _classify_stop_mode_token(raw)
        if kind in ("on_demand", "keep_warm", "always_on"):
            return kind  # type: ignore[return-value]
        if kind == "__invalid__":
            print(
                "[dgx-llm-runtime-control] invalid BLUE_LLM_RUNTIME_STOP_MODE="
                f"{raw!r}; using BLUE_LLM_RUNTIME_KEEP_WARM / on_demand",
                file=sys.stderr,
            )
        # __legacy__ または無効（警告後）: 下へ
    keep_warm = _parse_bool_for_policy("BLUE_LLM_RUNTIME_KEEP_WARM", env, default=False)
    return "keep_warm" if keep_warm else "on_demand"


def should_use_noop_stop_for_blue(mode: BlueStopMode) -> bool:
    """true の場合、/stop はシェル no-op（':'）にし、実ランタイムを止めない。"""
    return mode in ("keep_warm", "always_on")
