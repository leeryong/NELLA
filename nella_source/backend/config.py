"""
Configuration management for LLMOps platform.
Uses pydantic-settings for env var loading with validation.
"""
import os
from pathlib import Path
from typing import Literal, Optional
from pydantic import Field, validator
from pydantic_settings import BaseSettings


BASE_DIR = Path(__file__).parent.parent


class Settings(BaseSettings):
    # App
    APP_NAME: str = "NTIS LLM-Develop Agent"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False
    SECRET_KEY: str = "change-me-in-production-please"

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    WORKERS: int = 1

    # Database
    DATABASE_URL: str = f"sqlite+aiosqlite:///{BASE_DIR}/data/llmops.db"

    # Storage paths
    DATA_DIR: Path = BASE_DIR / "data"
    DOCUMENTS_DIR: Path = BASE_DIR / "data" / "documents"
    EXTRACTED_DIR: Path = BASE_DIR / "data" / "extracted"
    TRAINING_DATA_DIR: Path = BASE_DIR / "data" / "training_data"
    TEST_DATA_DIR: Path = BASE_DIR / "data" / "test_data"
    MODELS_DIR: Path = BASE_DIR / "data" / "models"
    VECTORDB_DIR: Path = BASE_DIR / "data" / "vectordb"

    # LLM Provider
    LLM_PROVIDER: Literal["openai", "anthropic", "ollama"] = "openai"

    # OpenAI
    OPENAI_API_KEY: Optional[str] = None
    OPENAI_MODEL: str = "gpt-4o-mini"
    OPENAI_BASE_URL: Optional[str] = None

    # Anthropic
    ANTHROPIC_API_KEY: Optional[str] = None
    ANTHROPIC_MODEL: str = "claude-sonnet-4-6"

    # Ollama
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "llama3.2"

    # HuggingFace
    HF_TOKEN: Optional[str] = None
    HF_CACHE_DIR: Optional[Path] = None

    # Fine-tuning tool: "trl" | "axolotl"
    FINETUNING_TOOL: str = "trl"

    # Training defaults
    DEFAULT_TRAIN_RATIO: float = 0.9
    DEFAULT_EPOCHS: int = 3
    DEFAULT_LEARNING_RATE: float = 2e-4
    DEFAULT_BATCH_SIZE: int = 4
    DEFAULT_MAX_SEQ_LENGTH: int = 2048
    DEFAULT_LORA_RANK: int = 16
    DEFAULT_LORA_ALPHA: int = 32
    DEFAULT_LORA_DROPOUT: float = 0.05

    # AutoResearch
    AUTORESEARCH_MAX_TRIALS: int = 5
    AUTORESEARCH_STEPS_PER_TRIAL: int = 50

    # RAG
    RAG_ENABLED: bool = True
    RAG_DEFAULT_EXTRACTOR: str = "openDataLoader"
    RAG_CHUNK_SIZE: int = 900
    RAG_CHUNK_OVERLAP: int = 150
    RAG_TOP_K: int = 4
    RAG_EMBEDDING_MODEL: str = "BAAI/bge-m3"
    RAG_CHROMA_DIR: Path = BASE_DIR / "data" / "chroma"
    RAG_COLLECTION_NAME: str = "nella_documents"

    # Redis (for Celery)
    REDIS_URL: str = "redis://localhost:6379/0"

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:5173"]

    class Config:
        env_file = BASE_DIR / ".env"
        # utf-8-sig, not utf-8: Notepad and PowerShell's Set-Content write UTF-8
        # *with* a BOM, and a BOM makes the first key parse as "﻿OPENAI_API_KEY",
        # which trips case_sensitive/extra-forbidden and kills startup with a
        # cryptic "Extra inputs are not permitted". utf-8-sig strips a BOM when
        # present and reads plain UTF-8 unchanged.
        env_file_encoding = "utf-8-sig"
        case_sensitive = True

    def model_post_init(self, __context) -> None:
        """Create required directories."""
        for dir_path in [
            self.DATA_DIR,
            self.DOCUMENTS_DIR,
            self.EXTRACTED_DIR,
            self.TRAINING_DATA_DIR,
            self.TEST_DATA_DIR,
            self.MODELS_DIR,
            self.VECTORDB_DIR,
            self.RAG_CHROMA_DIR,
        ]:
            dir_path.mkdir(parents=True, exist_ok=True)

        if self.HF_CACHE_DIR:
            self.HF_CACHE_DIR.mkdir(parents=True, exist_ok=True)


# Singleton instance
settings = Settings()
