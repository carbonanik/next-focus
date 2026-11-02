from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from .config import get_settings
from .database import engine
from .models import Base
from .routers import auth, data


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.app_env == "production" and settings.jwt_secret == "change-this-secret-before-deployment":
        raise RuntimeError("JWT_SECRET must be set before starting the production API.")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


settings = get_settings()
allowed_origins = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
app = FastAPI(
    title="NextFocus API",
    version="1.0.0",
    description="Authenticated task, goal, habit, plan, and journal API for NextFocus.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response


app.add_middleware(SecurityHeadersMiddleware)
app.include_router(auth.router)
app.include_router(data.router)


@app.get("/health", tags=["system"])
async def health():
    return {"status": "ok", "service": "nextfocus-api"}
