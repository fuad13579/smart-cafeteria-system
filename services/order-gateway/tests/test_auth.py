import importlib.util
from pathlib import Path

import pytest


MODULE_PATH = Path(__file__).resolve().parents[1] / "main.py"
SPEC = importlib.util.spec_from_file_location("order_gateway_main", MODULE_PATH)
assert SPEC and SPEC.loader
gateway = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gateway)


def test_extract_token_prefers_bearer() -> None:
    token = gateway._extract_token("Bearer abc123", "cookie456")
    assert token == "abc123"


def test_extract_token_falls_back_to_cookie() -> None:
    token = gateway._extract_token(None, "cookie456")
    assert token == "cookie456"


def test_extract_auth_returns_none_when_token_missing() -> None:
    assert gateway._extract_auth(None, None) is None


def test_extract_auth_returns_none_on_failed_verify(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_verify(_token: str):
        return None

    monkeypatch.setattr(gateway, "_verify_token", fake_verify)
    assert gateway._extract_auth("Bearer bad", None) is None


def test_extract_auth_returns_student_and_role(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_verify(_token: str):
        return {"student_id": "240041246", "role": "admin"}

    monkeypatch.setattr(gateway, "_verify_token", fake_verify)
    auth = gateway._extract_auth("Bearer valid", None)
    assert auth is not None
    assert auth["student_id"] == "240041246"
    assert auth["role"] == "admin"
    assert auth["token"] == "valid"


def test_extract_auth_rejects_missing_student_id(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_verify(_token: str):
        return {"role": "student"}

    monkeypatch.setattr(gateway, "_verify_token", fake_verify)
    assert gateway._extract_auth("Bearer valid", None) is None


def test_valid_main_slot_pairs() -> None:
    assert gateway._is_valid_main_slot("regular", "lunch") is True
    assert gateway._is_valid_main_slot("ramadan", "iftar") is True
    assert gateway._is_valid_main_slot("regular", "iftar") is False
    assert gateway._is_valid_main_slot("ramadan", "dinner") is False


def test_legacy_context_mapping_regular() -> None:
    now_local = gateway.datetime(2026, 3, 1, 12, 0, tzinfo=gateway.ZoneInfo("Asia/Dhaka"))
    main, slot = gateway._resolve_main_slot_from_legacy_context("regular", now_local)
    assert (main, slot) == ("regular", "lunch")


def test_legacy_context_mapping_ramadan_labels() -> None:
    now_local = gateway.datetime(2026, 3, 1, 12, 0, tzinfo=gateway.ZoneInfo("Asia/Dhaka"))
    assert gateway._resolve_main_slot_from_legacy_context("iftar", now_local) == ("ramadan", "iftar")
    assert gateway._resolve_main_slot_from_legacy_context("saheri", now_local) == ("ramadan", "suhoor")
