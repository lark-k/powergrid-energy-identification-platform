from __future__ import annotations

import hmac
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import Annotated, AsyncIterator

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, PlainTextResponse

from .config import Settings
from .metrics import metrics
from .model_versions import ModelVersions, ModelSwitchError
from .schemas import StrictModel
from .schemas import (
    BatchInferenceRequest,
    ErrorResponse,
    HealthResponse,
    InferenceRequest,
    InferenceResult,
    ModelManifest,
    ModelTask,
)


LOGGER = logging.getLogger("powergrid.model_service")


def _request_id(request: Request) -> str:
    return str(getattr(request.state, "request_id", "unknown"))


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = Settings.from_env()
    app.state.settings = settings
    app.state.coordinator = None
    app.state.load_error = None
    try:
        app.state.coordinator = ModelVersions(settings)
        LOGGER.info(json.dumps({"event": "models_loaded", "status": "ready"}))
    except Exception as exc:
        app.state.load_error = str(exc)
        metrics.gauge("model_service_ready", 0)
        LOGGER.error(
            json.dumps(
                {"event": "models_load_failed", "status": "failed", "error_type": type(exc).__name__}
            )
        )
    else:
        metrics.gauge("model_service_ready", 1)
    yield
    app.state.coordinator = None


def create_app() -> FastAPI:
    environment = Settings.from_env().environment
    docs_url = None if environment == "production" else "/docs"
    app = FastAPI(
        title="台区能源辨识内部模型服务",
        version="1.0.0",
        docs_url=docs_url,
        redoc_url=None,
        lifespan=lifespan,
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):  # type: ignore[no-untyped-def]
        request.state.request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        started = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        LOGGER.info(
            json.dumps(
                {
                    "event": "http_request",
                    "request_id": request.state.request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 3),
                },
                ensure_ascii=False,
            )
        )
        metrics.increment(
            "http_requests_total",
            {"method": request.method, "status": str(response.status_code)},
        )
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            {"location": list(item["loc"]), "message": item["msg"], "type": item["type"]}
            for item in exc.errors()
        ]
        payload = ErrorResponse(
            code="DATA_VALIDATION_FAILED",
            message="请求数据不符合模型服务契约",
            request_id=_request_id(request),
            details={"errors": errors},
        )
        return JSONResponse(status_code=422, content=payload.model_dump(mode="json"))

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
        code = "UNAUTHORIZED" if exc.status_code == 401 else "MODEL_REQUEST_FAILED"
        if isinstance(exc.detail, dict):
            code = str(exc.detail.get("code", code))
            message = str(exc.detail.get("message", "请求失败"))
            details = dict(exc.detail.get("details", {}))
        else:
            message = str(exc.detail)
            details = {}
        payload = ErrorResponse(
            code=code,
            message=message,
            request_id=_request_id(request),
            details=details,
        )
        return JSONResponse(status_code=exc.status_code, content=payload.model_dump(mode="json"))

    return app


app = create_app()


def require_service_auth(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    settings: Settings = request.app.state.settings
    if not settings.auth_required:
        return
    prefix = "Bearer "
    if not authorization or not authorization.startswith(prefix):
        raise HTTPException(status_code=401, detail="service bearer token is required")
    provided = authorization[len(prefix) :]
    if not settings.service_token or not hmac.compare_digest(provided, settings.service_token):
        raise HTTPException(status_code=401, detail="service bearer token is invalid")


ServiceAuth = Annotated[None, Depends(require_service_auth)]


def coordinator(request: Request) -> ModelVersions:
    instance: ModelVersions | None = request.app.state.coordinator
    if instance is None:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "MODEL_SERVICE_UNAVAILABLE",
                "message": "模型或其预处理契约未就绪",
                "details": {"reason": request.app.state.load_error or "not_loaded"},
            },
        )
    return instance


@app.get("/health/live", response_model=HealthResponse)
def live(request: Request) -> HealthResponse:
    return HealthResponse(status="ok", request_id=_request_id(request), details={})


@app.get(
    "/health/ready",
    response_model=HealthResponse,
    responses={503: {"model": ErrorResponse}},
)
def ready(request: Request) -> HealthResponse:
    instance: ModelVersions | None = request.app.state.coordinator
    if instance is None:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "MODEL_NOT_READY",
                "message": "模型摘要、checkpoint 或预处理定义未通过就绪检查",
                "details": {"reason": request.app.state.load_error or "not_loaded"},
            },
        )
    return HealthResponse(
        status="ready",
        request_id=_request_id(request),
        details={"models": [item.model_dump(mode="json") for item in instance.health()]},
    )


@app.get("/metrics", response_class=PlainTextResponse)
def prometheus_metrics(_: ServiceAuth) -> str:
    return metrics.render()


@app.get("/internal/v1/models", response_model=list[ModelManifest])
def list_models(request: Request, _: ServiceAuth) -> list[ModelManifest]:
    return coordinator(request).manifests()


@app.get("/internal/v1/models/{task}/manifest", response_model=ModelManifest)
def get_manifest(task: ModelTask, request: Request, _: ServiceAuth) -> ModelManifest:
    return coordinator(request).manifest(task)


class ActivateModelRequest(StrictModel):
    model_version: str
    expected_version: str


@app.get("/internal/v1/model-versions")
def model_versions(request: Request, _: ServiceAuth) -> dict:
    return coordinator(request).catalog()


@app.post("/internal/v1/model-versions/{task}/activate")
def activate_model(task: ModelTask, body: ActivateModelRequest, request: Request, _: ServiceAuth) -> dict:
    try:
        return coordinator(request).activate(task, body.model_version, body.expected_version)
    except ModelSwitchError as exc:
        raise HTTPException(status_code=exc.status, detail={"code": exc.code, "message": str(exc)}) from exc


@app.post("/internal/v1/inference/minute", response_model=InferenceResult)
def infer_minute(body: InferenceRequest, request: Request, _: ServiceAuth) -> InferenceResult:
    return coordinator(request).infer(body)


def _infer_targets(body: BatchInferenceRequest, request: Request) -> list[InferenceResult]:
    service = coordinator(request).snapshot()
    return [
        service.infer(
            InferenceRequest(
                request_id=body.request_id,
                station_id=body.station_id,
                target_time=target,
                points=body.points,
                separation_points=body.separation_points,
            )
        )
        for target in sorted(body.target_times)
    ]


@app.post("/internal/v1/inference/batch", response_model=list[InferenceResult])
def infer_batch(body: BatchInferenceRequest, request: Request, _: ServiceAuth) -> list[InferenceResult]:
    return _infer_targets(body, request)


@app.post("/internal/v1/inference/replay", response_model=list[InferenceResult])
def replay(body: BatchInferenceRequest, request: Request, _: ServiceAuth) -> list[InferenceResult]:
    return _infer_targets(body, request)
