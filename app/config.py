from typing import Optional
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    ollama_base_url: str = "http://localhost:11434"
    default_model: str = "qwen3:8b"
    app_name: str = "Ollama LangChain/LangGraph Wrapper"
    debug: bool = True
    you_api_key: Optional[str] = None

    class Config:
        env_file = ".env"

settings = Settings()
