"""haizen_agent.config の TLS 設定解釈を検証する。"""

from __future__ import annotations

from pathlib import Path

import pytest

from haizen_agent.config import HaizenAgentConfig, load_config_path, load_haizen_config


def test_tls_skip_verify_one_forces_insecure(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    p = tmp_path / "haizen.conf"
    p.write_text(
        'API_BASE_URL="https://ex.example"\nX_CLIENT_KEY="k"\nTLS_SKIP_VERIFY="1"\n',
        encoding="utf-8",
    )
    monkeypatch.setenv("CONFIG_PATH", str(p))
    monkeypatch.delenv("TLS_SKIP_VERIFY", raising=False)
    monkeypatch.delenv("HAIZEN_TLS_VERIFY_MODE", raising=False)
    cfg = load_haizen_config()
    assert isinstance(cfg, HaizenAgentConfig)
    assert cfg.tls_verify_mode == "insecure"
    assert cfg.tls_skip_verify is True


def test_tls_skip_verify_zero_allows_system_verify(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    p = tmp_path / "haizen.conf"
    p.write_text(
        'API_BASE_URL="https://ex.example"\nX_CLIENT_KEY="k"\n'
        'TLS_SKIP_VERIFY="0"\nHAIZEN_TLS_VERIFY_MODE="system"\n',
        encoding="utf-8",
    )
    monkeypatch.setenv("CONFIG_PATH", str(p))
    monkeypatch.delenv("TLS_SKIP_VERIFY", raising=False)
    cfg = load_haizen_config()
    assert cfg.tls_verify_mode == "system"
    assert cfg.tls_skip_verify is False


def test_default_insecure_when_no_tls_vars(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    p = tmp_path / "haizen.conf"
    p.write_text('API_BASE_URL="https://ex.example"\nX_CLIENT_KEY="k"\n', encoding="utf-8")
    monkeypatch.setenv("CONFIG_PATH", str(p))
    monkeypatch.delenv("TLS_SKIP_VERIFY", raising=False)
    cfg = load_haizen_config()
    assert cfg.tls_verify_mode == "insecure"


def test_load_config_path_skips_comments_and_blank(tmp_path: Path) -> None:
    p = tmp_path / "c.conf"
    p.write_text(
        "\n# x\nFOO=\"bar\"\n\n",
        encoding="utf-8",
    )
    d = load_config_path(p)
    assert d.get("FOO") == "bar"
