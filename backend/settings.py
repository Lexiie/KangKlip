from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Store environment configuration for the backend.
    NOSANA_API_BASE: str = "https://dashboard.k8s.prd.nos.ci/api"
    NOSANA_API_KEY: str
    NOSANA_WORKER_IMAGE: str
    NOSANA_MARKET: str
    NOSANA_GPU_MODEL: str = "3080"
    REDIS_URL: str
    R2_ENDPOINT: str
    R2_BUCKET: str
    R2_ACCESS_KEY_ID: str
    R2_SECRET_ACCESS_KEY: str
    CALLBACK_BASE_URL: str


def get_settings() -> Settings:
    # Load and validate required settings from the environment.
    return Settings()
