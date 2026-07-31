"""
Database setup and models using SQLAlchemy async.
SQLite for development, easily upgradeable to PostgreSQL.
"""
import enum
import json
from datetime import datetime
from typing import Optional, Any

from sqlalchemy import (
    Column, String, Integer, Float, Boolean, Text, DateTime,
    Enum as SAEnum, ForeignKey, JSON, event
)
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, relationship
from sqlalchemy.sql import func

from backend.config import settings


# Engine
# Use WAL journal mode for better concurrency between connections
# (allows reads while writes are in progress)
from sqlalchemy import event as sa_event

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    connect_args={"check_same_thread": False},
)


@sa_event.listens_for(engine.sync_engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    # DELETE mode: every commit writes directly to the main DB file — no WAL residue on restart.
    # WAL gave us concurrent-read benefits but caused data loss when the process was killed
    # before the WAL was checkpointed.
    cursor.execute("PRAGMA journal_mode=DELETE")
    cursor.execute("PRAGMA synchronous=FULL")   # fsync every commit — slow but durable
    cursor.execute("PRAGMA busy_timeout=5000")  # wait up to 5s when DB is locked
    cursor.close()

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


# Enums
class DocumentStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class JobStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TrainingMethod(str, enum.Enum):
    SFT = "sft"
    LORA = "lora"
    QLORA = "qlora"
    DPO = "dpo"
    PPO = "ppo"


# Models
class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    filename = Column(String(255), nullable=False)
    original_path = Column(String(1024), nullable=False)
    extracted_path = Column(String(1024), nullable=True)
    file_type = Column(String(50), nullable=False)
    file_size = Column(Integer, nullable=False)
    status = Column(SAEnum(DocumentStatus), default=DocumentStatus.PENDING)
    error_message = Column(Text, nullable=True)
    extractor = Column(String(50), nullable=True, default="openDataLoader")
    page_count = Column(Integer, nullable=True)
    word_count = Column(Integer, nullable=True)
    char_count = Column(Integer, nullable=True)
    thumbnail_path = Column(String(1024), nullable=True)
    rag_indexed = Column(Boolean, default=False)
    rag_chunk_count = Column(Integer, default=0)
    rag_indexed_at = Column(DateTime, nullable=True)
    started_at = Column(DateTime, nullable=True)  # 텍스트 추출 시작 시각
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    # Relationships
    training_datasets = relationship("TrainingDataset", back_populates="document")


class TrainingDataset(Base):
    __tablename__ = "training_datasets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    data_type = Column(String(50), nullable=False)  # sft, dpo, custom
    train_path = Column(String(1024), nullable=True)
    test_path = Column(String(1024), nullable=True)
    train_count = Column(Integer, default=0)
    test_count = Column(Integer, default=0)
    train_ratio = Column(Float, default=0.9)
    llm_provider = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=func.now())

    # Relationships
    document = relationship("Document", back_populates="training_datasets")
    training_jobs = relationship("TrainingJob", back_populates="dataset")


class ModelRecord(Base):
    __tablename__ = "model_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    hf_model_id = Column(String(255), nullable=False, unique=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    task_type = Column(String(100), nullable=True)
    size_category = Column(String(50), nullable=True)  # tiny, small, medium
    parameter_count = Column(String(50), nullable=True)
    local_path = Column(String(1024), nullable=True)
    is_downloaded = Column(Boolean, default=False)
    download_size_gb = Column(Float, nullable=True)
    supports_vision = Column(Boolean, default=False)
    created_at = Column(DateTime, default=func.now())

    # Relationships
    training_jobs = relationship("TrainingJob", back_populates="base_model")


class TrainingJob(Base):
    __tablename__ = "training_jobs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    dataset_id = Column(Integer, ForeignKey("training_datasets.id"), nullable=False)
    base_model_id = Column(Integer, ForeignKey("model_records.id"), nullable=False)
    method = Column(SAEnum(TrainingMethod), nullable=False)
    status = Column(SAEnum(JobStatus), default=JobStatus.PENDING)

    # Training config (JSON)
    config = Column(JSON, nullable=True)

    # Results
    output_dir = Column(String(1024), nullable=True)
    best_checkpoint = Column(String(1024), nullable=True)
    final_loss = Column(Float, nullable=True)
    training_metrics = Column(JSON, nullable=True)  # list of {step, loss, eval_loss}

    # Timing
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=func.now())

    # Relationships
    dataset = relationship("TrainingDataset", back_populates="training_jobs")
    base_model = relationship("ModelRecord", back_populates="training_jobs")
    evaluation_results = relationship("EvaluationResult", back_populates="training_job", cascade="all, delete-orphan")


class EvaluationResult(Base):
    __tablename__ = "evaluation_results"

    id = Column(Integer, primary_key=True, autoincrement=True)
    training_job_id = Column(Integer, ForeignKey("training_jobs.id"), nullable=True)
    autoresearch_job_id = Column(Integer, nullable=True)
    model_path = Column(String(1024), nullable=False)
    bleu_score = Column(Float, nullable=True)
    rouge1_score = Column(Float, nullable=True)
    rouge2_score = Column(Float, nullable=True)
    rougeL_score = Column(Float, nullable=True)
    perplexity = Column(Float, nullable=True)
    llm_judge_score = Column(Float, nullable=True)
    sample_count = Column(Integer, nullable=True)
    metrics_detail = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=func.now())

    # Relationships
    training_job = relationship("TrainingJob", back_populates="evaluation_results")


class AutoResearchJob(Base):
    __tablename__ = "autoresearch_jobs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    dataset_id = Column(Integer, ForeignKey("training_datasets.id"), nullable=False)
    base_model_id = Column(Integer, ForeignKey("model_records.id"), nullable=False)
    status = Column(SAEnum(JobStatus), default=JobStatus.PENDING)
    max_trials = Column(Integer, default=5)
    steps_per_trial = Column(Integer, default=50)
    method = Column(String(20), default="lora")
    best_config = Column(JSON, nullable=True)
    best_loss = Column(Float, nullable=True)
    trial_results = Column(JSON, nullable=True)  # list of trial results
    final_training_metrics = Column(JSON, nullable=True)  # final full-training loss curve
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class BenchmarkRun(Base):
    """One row per (model × run) — tasks within a run share results dict keyed by task id."""
    __tablename__ = "benchmark_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    group_id = Column(String(64), nullable=False, index=True)  # ties N rows from one user request together
    model_hf_id = Column(String(255), nullable=False)
    model_name = Column(String(255), nullable=False)
    tasks = Column(JSON, nullable=False)            # ["mmlu", "arc_challenge", ...]
    results = Column(JSON, nullable=True)           # {"mmlu": 0.51, "arc_challenge": 0.32}
    status = Column(SAEnum(JobStatus), default=JobStatus.PENDING)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=func.now())


class AgentChatMessage(Base):
    __tablename__ = "agent_chat_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(100), nullable=False, default="default")
    role = Column(String(20), nullable=False)   # "user" | "assistant"
    content = Column(Text, nullable=False)
    msg_metadata = Column(JSON, nullable=True)   # toolCalls, isPlan, isStepConfirm, navigateTo, elapsedMs
    created_at = Column(DateTime, default=func.now())


class RagCollection(Base):
    __tablename__ = "rag_collections"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False, unique=True)
    description = Column(Text, nullable=True, default="")
    chroma_name = Column(String(200), nullable=False, unique=True)  # actual Chroma collection name
    chunk_count = Column(Integer, default=0)
    embedding_model = Column(String(200), nullable=True)
    # Background indexing progress
    status = Column(String(20), default="idle", nullable=False)  # idle|pending|indexing|completed|failed
    progress_stage = Column(String(300), nullable=True)  # short current-activity label
    progress_current = Column(Integer, default=0)
    progress_total = Column(Integer, default=0)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    documents = relationship("RagCollectionDocument", back_populates="collection", cascade="all, delete-orphan")


class RagCollectionDocument(Base):
    __tablename__ = "rag_collection_documents"

    collection_id = Column(Integer, ForeignKey("rag_collections.id", ondelete="CASCADE"), primary_key=True)
    document_id = Column(Integer, ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True)
    chunk_count = Column(Integer, default=0)
    indexed_at = Column(DateTime, nullable=True)

    collection = relationship("RagCollection", back_populates="documents")


# Database dependency
async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db():
    """Initialize database tables."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # 컬럼 마이그레이션 (기존 DB에 없는 컬럼 추가)
        try:
            await conn.execute(
                __import__("sqlalchemy").text(
                    "ALTER TABLE training_datasets ADD COLUMN llm_provider VARCHAR(100)"
                )
            )
        except Exception:
            pass  # 이미 존재하면 무시
        try:
            await conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE documents ADD COLUMN extractor VARCHAR(50) DEFAULT 'openDataLoader'"
            ))
        except Exception:
            pass
        try:
            await conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE documents ADD COLUMN started_at DATETIME"
            ))
        except Exception:
            pass
        try:
            await conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE documents ADD COLUMN thumbnail_path VARCHAR(1024)"
            ))
        except Exception:
            pass
        try:
            await conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE documents ADD COLUMN rag_indexed BOOLEAN DEFAULT 0"
            ))
        except Exception:
            pass
        try:
            await conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE documents ADD COLUMN rag_chunk_count INTEGER DEFAULT 0"
            ))
        except Exception:
            pass
        try:
            await conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE documents ADD COLUMN rag_indexed_at DATETIME"
            ))
        except Exception:
            pass
        try:
            await conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE documents ADD COLUMN char_count INTEGER"
            ))
        except Exception:
            pass
        try:
            await conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE autoresearch_jobs ADD COLUMN method VARCHAR(20) DEFAULT 'lora'"
            ))
        except Exception:
            pass
        try:
            await conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE autoresearch_jobs ADD COLUMN error_message TEXT"
            ))
        except Exception:
            pass
        try:
            await conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE autoresearch_jobs ADD COLUMN final_training_metrics JSON"
            ))
        except Exception:
            pass
        # 서버 재시작 시 'running' 상태로 stuck된 AR 잡을 'failed'로 정리
        try:
            await conn.execute(__import__("sqlalchemy").text(
                "UPDATE autoresearch_jobs SET status='failed', error_message='서버 재시작으로 중단됨' WHERE status='running'"
            ))
        except Exception:
            pass
        # ChromaDB로 이전: 기존 SQLite rag_chunks 테이블 제거 (벡터는 이제 Chroma에서만 관리)
        try:
            await conn.execute(__import__("sqlalchemy").text("DROP TABLE IF EXISTS rag_chunks"))
        except Exception:
            pass
        # RagCollection 진행 상태 컬럼 (기존 DB에 없으면 추가)
        for _ddl in (
            "ALTER TABLE rag_collections ADD COLUMN status VARCHAR(20) DEFAULT 'idle' NOT NULL",
            "ALTER TABLE rag_collections ADD COLUMN progress_stage VARCHAR(300)",
            "ALTER TABLE rag_collections ADD COLUMN progress_current INTEGER DEFAULT 0",
            "ALTER TABLE rag_collections ADD COLUMN progress_total INTEGER DEFAULT 0",
        ):
            try:
                await conn.execute(__import__("sqlalchemy").text(_ddl))
            except Exception:
                pass
        # 서버 재시작 시 'indexing/pending' 잡을 'failed'로 정리
        try:
            await conn.execute(__import__("sqlalchemy").text(
                "UPDATE rag_collections SET status='failed', progress_stage='서버 재시작으로 중단됨' "
                "WHERE status IN ('indexing', 'pending')"
            ))
        except Exception:
            pass
        # 새 임베딩 모델(BGE-M3)로 재인덱싱 필요 — 모든 문서의 rag_indexed 플래그 리셋
        try:
            await conn.execute(__import__("sqlalchemy").text(
                "UPDATE documents SET rag_indexed=0, rag_chunk_count=0, rag_indexed_at=NULL "
                "WHERE rag_indexed=1"
            ))
        except Exception:
            pass
