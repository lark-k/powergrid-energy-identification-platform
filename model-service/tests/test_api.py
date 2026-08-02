from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.schemas import MinutePoint


def payload(points: list[MinutePoint]) -> dict:
    return {
        "request_id": "REQ-API-SMOKE",
        "station_id": "A01",
        "target_time": points[-1].event_time.isoformat(),
        "points": [point.model_dump(mode="json") for point in points],
    }


def test_health_manifests_and_real_inference_contract(
    sample_points: list[MinutePoint],
) -> None:
    with TestClient(app) as client:
        assert client.get("/health/live").status_code == 200
        ready = client.get("/health/ready")
        assert ready.status_code == 200
        manifests = client.get("/internal/v1/models")
        assert manifests.status_code == 200
        assert {item["task"] for item in manifests.json()} == {
            "resource_identification",
            "pv_separation",
        }
        response = client.post(
            "/internal/v1/inference/minute", json=payload(sample_points[-240:])
        )
        assert response.status_code == 200
        body = response.json()
        assert body["request_id"] == "REQ-API-SMOKE"
        assert body["energy_station"]["score"] is not None
        assert body["pv_generation_kw"] is not None
        assert body["input_window_end"] == body["target_time"]
        assert response.headers["X-Request-ID"]


def test_validation_error_has_unified_request_id() -> None:
    with TestClient(app) as client:
        response = client.post("/internal/v1/inference/minute", json={})
        assert response.status_code == 422
        assert response.json()["code"] == "DATA_VALIDATION_FAILED"
        assert response.json()["request_id"] == response.headers["X-Request-ID"]
