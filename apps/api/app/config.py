from functools import lru_cache
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/nextfocus"
    jwt_secret: str = "change-this-secret-before-deployment"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    refresh_token_days: int = 30
    cors_origins: str = "http://localhost:8000,http://localhost:3000"
    app_env: str = "development"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def async_database_url(self) -> str:
        url = self.database_url.strip()
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://"):]
        if url.startswith("postgresql://"):
            url = "postgresql+asyncpg://" + url[len("postgresql://"):]

        parts = urlsplit(url)
        query = [(key, value) for key, value in parse_qsl(parts.query) if key not in {"sslmode", "channel_binding"}]
        return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))

    @property
    def database_ssl_required(self) -> bool:
        url = self.database_url.lower()
        return "sslmode=require" in url or ".neon.tech" in url


@lru_cache
def get_settings() -> Settings:
    return Settings()
