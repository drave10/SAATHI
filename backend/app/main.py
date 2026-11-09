"""SAATHI API entrypoint."""
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .config import get_settings
from .database import engine
from .routers import admin, analytics, assessments, auth, beneficiaries, cases, followups, interventions, me

logger = logging.getLogger("saathi")
settings = get_settings()
settings.validate_for_runtime()

app = FastAPI(
    title="SAATHI API",
    version="1.0.0",
    description=(
        "Smart AI-Assisted Trauma and Holistic Intervention — decision-support prototype (SIH26094, MoSJE). "
        "NOT a diagnostic system. All data in the demo environment is synthetic."
    ),
)

app.add_middleware(
    CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"], allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Cache-Control"] = "no-store"  # sensitive responses must not be cached
    return resp


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    errors = [{"field": ".".join(str(p) for p in e["loc"] if p != "body"), "message": e["msg"]} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": "Validation failed", "errors": errors})


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)  # no request bodies are logged
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


for r in (auth, beneficiaries, cases, assessments, followups, interventions, analytics, admin, me):
    app.include_router(r.router, prefix="/api")


@app.get("/api/health", tags=["system"])
def health():
    with engine.connect() as c:
        c.execute(text("SELECT 1"))
    from .engine import ml
    return {"status": "ok", "ml_model_available": ml.load_model() is not None}
