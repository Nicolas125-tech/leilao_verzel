from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_JWT_SECRET = "leilao_verzel_jwt_secret_dev_key_super_seguro_2026"
DEV_HMAC_SECRET = "leilao_verzel_hmac_chain_secret_dev_key_super_seguro_2026"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    ENVIRONMENT: str = "development"
    JWT_SECRET_KEY: str = DEV_JWT_SECRET
    HMAC_SECRET_KEY: str = DEV_HMAC_SECRET

    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "postgres"
    POSTGRES_DB: str = "leilao_verzel"
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/leilao_verzel"
    DATABASE_URL_SYNC: str = "postgresql+psycopg2://postgres:postgres@localhost:5432/leilao_verzel"

    PORT: int = 8000
    HOST: str = "0.0.0.0"
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    CLEVELAND_ART_API_BASE_URL: str = "https://openaccess-api.clevelandart.org/api/artworks/"
    CLEVELAND_TIMEOUT_SECONDS: int = 4

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    def validate_production_secrets(self) -> None:
        if self.ENVIRONMENT.strip().lower() != "production":
            return
        if self.JWT_SECRET_KEY == DEV_JWT_SECRET or not self.JWT_SECRET_KEY.strip():
            raise RuntimeError(
                "JWT_SECRET_KEY de desenvolvimento não pode ser usada em produção."
            )
        if self.HMAC_SECRET_KEY == DEV_HMAC_SECRET or len(self.HMAC_SECRET_KEY.strip()) < 32:
            raise RuntimeError(
                "HMAC_SECRET_KEY inválida em produção: configure uma chave fora do banco com pelo menos 32 caracteres."
            )


settings = Settings()
