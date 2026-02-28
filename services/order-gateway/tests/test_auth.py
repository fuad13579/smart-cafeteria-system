from pathlib import Path
import importlib.util

from fastapi.testclient import TestClient


MODULE_PATH = Path(__file__).resolve().parents[1] / "main.py"
SPEC = importlib.util.spec_from_file_location("order_gateway_main", MODULE_PATH)
assert SPEC and SPEC.loader
gateway = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gateway)


client = TestClient(gateway.app)


def test_menu_requires_bearer_token() -> None:
    response = client.get("/api/menu")
    assert response.status_code == 401


def test_create_order_requires_bearer_token() -> None:
    response = client.post("/api/orders", json={"items": [{"id": "1", "qty": 1}]})
    assert response.status_code == 401


def test_extract_student_id_returns_none_on_401_verify(monkeypatch) -> None:
    class FakeResponse:
        status_code = 401

        def json(self):
            return {}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, *args, **kwargs):
            return FakeResponse()

    monkeypatch.setattr(gateway.httpx, "Client", FakeClient)
    assert gateway._extract_student_id("Bearer invalid") is None
