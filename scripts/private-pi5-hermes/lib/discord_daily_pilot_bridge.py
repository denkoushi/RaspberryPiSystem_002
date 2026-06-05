#!/usr/bin/env python3
"""Discord /daily bridge for the safe daily-use pilot (D6-pre)."""

from __future__ import annotations

import asyncio
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None  # type: ignore[assignment]

try:
    from .daily_pilot_policy import (
        DailyPilotPolicy,
        validate_daily_pilot_document,
        validate_daily_prompt,
    )
except ImportError:
    from daily_pilot_policy import (
        DailyPilotPolicy,
        validate_daily_pilot_document,
        validate_daily_prompt,
    )


def _default_policy_path() -> Path:
    plugin_dir = Path(__file__).resolve().parent
    deployed = plugin_dir / "daily-pilot.policy.yaml"
    if deployed.is_file():
        return deployed
    repo_policy = plugin_dir.parent / "config" / "daily-pilot.policy.yaml"
    if repo_policy.is_file():
        return repo_policy
    return Path(__file__).resolve().parent.parent / "config" / "daily-pilot.policy.yaml"


def load_daily_pilot_policy(path: Path | None = None) -> DailyPilotPolicy:
    policy_path = path or _default_policy_path()
    if yaml is None:
        raise RuntimeError("PyYAML is required to load daily pilot policy")
    data = yaml.safe_load(policy_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("daily pilot policy root must be a mapping")
    errors = validate_daily_pilot_document(data)
    if errors:
        raise ValueError("; ".join(errors))
    return DailyPilotPolicy.from_mapping(data)


def render_daily_usage() -> str:
    return (
        "usage: /daily <memo or request>\n"
        "example: /daily 今日の作業メモを整理して、Cursorに渡す指示書にして"
    )


def _blockquote(text: str) -> str:
    lines = [line.rstrip() for line in (text or "").strip().splitlines()]
    return "\n".join(f"> {line}" if line else ">" for line in lines)


def render_daily_markdown(prompt: str, policy: DailyPilotPolicy) -> str:
    memo = (prompt or "").strip()
    deferred = "\n".join(f"- {item}" for item in policy.deferred_task_classes)
    return f"""# Daily Pilot Draft

## User Request

{_blockquote(memo)}

## Safe Output

- This is Markdown only.
- Hermes does not run Cursor, Codex, terminal, git, deploy, or secret access in this pilot.
- Human review stays between this draft and any real change.

## Cursor Instruction Draft

以下をCursorに渡す作業依頼として使う。

### 依頼

{_blockquote(memo)}

### 進め方

- まず対象ファイル、前提、リスクを短く確認する。
- 実装が必要な場合は、変更範囲を小さく保つ。
- テストまたは確認手順を明記する。
- git操作、デプロイ、秘密情報の読み取りは行わない。

## Codex Review Prompt Draft

以下の内容を第三者レビューしてください。

### レビュー対象

{_blockquote(memo)}

### 見てほしい点

- 計画や実装方針に危険な権限拡大がないか。
- テスト、CI、デプロイ前確認が足りているか。
- 非エンジニアが判断できる説明になっているか。

## Checks Before Next Step

- Cursor/Codexに渡す前に、作業対象が本番系か実験系かを確認する。
- GitHub ActionsやDeployを動かす前に、人間が差分を確認する。
- token、.env、秘密鍵、内部ネットワーク情報を貼らない。

## Not Allowed In This Pilot

{deferred}
""".strip()


def run_daily_pilot_bridge(prompt: str, policy: DailyPilotPolicy | None = None) -> str:
    loaded_policy = policy or load_daily_pilot_policy()
    validation = validate_daily_prompt(prompt, loaded_policy)
    if not validation.ok:
        return f"daily rejected: {validation.reason}\n\n{render_daily_usage()}"
    return render_daily_markdown(prompt, loaded_policy)


async def run_daily_pilot_bridge_async(
    prompt: str,
    policy: DailyPilotPolicy | None = None,
) -> str:
    return await asyncio.to_thread(run_daily_pilot_bridge, prompt, policy)
