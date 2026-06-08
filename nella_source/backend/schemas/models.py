"""
Pydantic schemas for API request/response models.
"""
from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel, Field, validator


# Document schemas
class DocumentUploadResponse(BaseModel):
    id: int
    filename: str
    file_type: str
    file_size: int
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class DocumentResponse(BaseModel):
    id: int
    filename: str
    original_path: str
    extracted_path: Optional[str]
    file_type: str
    file_size: int
    status: str
    thumbnail_path: Optional[str] = None
    rag_indexed: bool = False
    rag_chunk_count: int = 0
    rag_indexed_at: Optional[datetime] = None
    page_count: Optional[int]
    word_count: Optional[int]
    error_message: Optional[str]
    extractor: Optional[str] = "openDataLoader"
    started_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


# Training Dataset schemas
class GenerateSFTDataRequest(BaseModel):
    document_id: int
    num_pairs: int = Field(default=10, ge=1, le=500)
    dataset_name: str = Field(default="generated_dataset")
    train_ratio: float = Field(default=0.9, ge=0.5, le=0.99)
    llm_provider: Optional[str] = None
    system_prompt: Optional[str] = None
    user_prompt_template: Optional[str] = None  # {text}, {num_pairs} 치환자 사용

    @validator("dataset_name")
    def validate_name(cls, v):
        import re
        # 특수문자·공백만 언더스코어로 대체 — 한글 등 유니코드 단어 문자는 유지
        sanitized = re.sub(r"[^\w-]", "_", v, flags=re.UNICODE)
        sanitized = re.sub(r"_+", "_", sanitized).strip("_")
        if not sanitized:
            sanitized = "dataset"
        return sanitized

    @validator("train_ratio")
    def clamp_train_ratio(cls, v):
        return max(0.5, min(0.99, v))


class GenerateReasoningDataRequest(BaseModel):
    """Shared request for CoT/ToT/GoT generation."""
    document_id: int
    num_pairs: int = Field(default=10, ge=1, le=500)
    dataset_name: str = Field(default="reasoning_dataset")
    train_ratio: float = Field(default=0.9, ge=0.5, le=0.99)
    llm_provider: Optional[str] = None
    system_prompt: Optional[str] = None
    user_prompt_template: Optional[str] = None

    @validator("dataset_name")
    def validate_name(cls, v):
        import re
        sanitized = re.sub(r"[^\w-]", "_", v, flags=re.UNICODE)
        sanitized = re.sub(r"_+", "_", sanitized).strip("_")
        if not sanitized:
            sanitized = "dataset"
        return sanitized

    @validator("train_ratio")
    def clamp_train_ratio(cls, v):
        return max(0.5, min(0.99, v))


class GenerateDPODataRequest(BaseModel):
    document_id: int
    num_pairs: int = Field(default=10, ge=1, le=500)  # 422 방지: SFT와 동일한 상한
    dataset_name: str = Field(default="dpo_dataset")
    train_ratio: float = Field(default=0.9, ge=0.5, le=0.99)
    system_prompt: Optional[str] = None
    user_prompt_template: Optional[str] = None

    @validator("train_ratio")
    def clamp_train_ratio(cls, v):
        return max(0.5, min(0.99, v))


class DatasetResponse(BaseModel):
    id: int
    name: str
    document_id: Optional[int]
    data_type: str
    train_path: Optional[str]
    test_path: Optional[str]
    train_count: int
    test_count: int
    train_ratio: float
    llm_provider: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# Model registry schemas
class ModelInfo(BaseModel):
    hf_model_id: str
    name: str
    description: str
    task_type: str
    size_category: str
    parameter_count: str
    download_size_gb: Optional[float]
    supports_vision: bool
    is_downloaded: bool = False
    local_path: Optional[str] = None
    tags: list[str] = []


class DownloadModelRequest(BaseModel):
    model_id: str


class ModelRecordResponse(BaseModel):
    id: int
    hf_model_id: str
    name: str
    description: Optional[str]
    task_type: Optional[str]
    size_category: Optional[str]
    parameter_count: Optional[str]
    local_path: Optional[str]
    is_downloaded: bool
    download_size_gb: Optional[float]
    supports_vision: bool
    created_at: datetime

    class Config:
        from_attributes = True


# Training Job schemas
class StartSFTRequest(BaseModel):
    name: str = Field(default="Training Job")
    dataset_id: Optional[int] = None             # legacy single-dataset field
    dataset_ids: list[int] = Field(default=[])  # multiple datasets (merged before training)
    model_id: str  # HF model ID

    @validator("dataset_ids", pre=True, always=True)
    def coerce_dataset_ids(cls, v, values):
        if v:
            return v
        legacy = values.get("dataset_id")
        return [legacy] if legacy else []
    method: str = Field(default="lora", pattern="^(full|lora|qlora)$")

    # Hyperparameters
    num_train_epochs: int = Field(default=3, ge=1, le=100)
    learning_rate: float = Field(default=2e-4, gt=0, lt=1)
    batch_size: int = Field(default=4, ge=1, le=64)
    max_seq_length: int = Field(default=2048, ge=128, le=8192)
    lora_r: int = Field(default=16, ge=4, le=256)
    lora_alpha: int = Field(default=32, ge=4, le=512)
    lora_dropout: float = Field(default=0.05, ge=0, lt=1)
    gradient_accumulation_steps: int = Field(default=4, ge=1, le=64)
    max_steps: int = Field(default=-1)  # -1 = use epochs


class StartDPORequest(BaseModel):
    name: str = Field(default="DPO Training Job")
    dataset_id: Optional[int] = None
    dataset_ids: list[int] = Field(default=[])

    @validator("dataset_ids", pre=True, always=True)
    def coerce_dataset_ids(cls, v, values):
        if v:
            return v
        legacy = values.get("dataset_id")
        return [legacy] if legacy else []

    model_id: str
    learning_rate: float = Field(default=5e-7, gt=0)
    num_train_epochs: int = Field(default=1, ge=1, le=10)
    beta: float = Field(default=0.1, gt=0, lt=1)
    use_lora: bool = True
    max_steps: int = Field(default=-1)


class StartAutoResearchRequest(BaseModel):
    name: str = Field(default="AutoResearch Job")
    dataset_id: Optional[int] = None
    dataset_ids: list[int] = Field(default=[])

    @validator("dataset_ids", pre=True, always=True)
    def coerce_dataset_ids(cls, v, values):
        if v:
            return v
        legacy = values.get("dataset_id")
        return [legacy] if legacy else []

    model_id: str
    method: str = Field(default="lora", pattern="^(full|lora|qlora)$")
    max_trials: int = Field(default=5, ge=2, le=20)
    steps_per_trial: int = Field(default=50, ge=10, le=500)
    final_epochs: int = Field(default=3, ge=1, le=100)


class TrainingJobResponse(BaseModel):
    id: int
    name: str
    dataset_id: int
    base_model_id: int
    method: str
    status: str
    config: Optional[dict]
    output_dir: Optional[str]
    best_checkpoint: Optional[str]
    final_loss: Optional[float]
    training_metrics: Optional[list]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    error_message: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# Evaluation schemas
class RunEvaluationRequest(BaseModel):
    training_job_id: int
    use_llm_judge: bool = False
    sample_limit: int = Field(default=100, ge=1, le=1000)
    dataset_id: Optional[int] = None  # override test dataset


class EvaluationResponse(BaseModel):
    id: int
    training_job_id: Optional[int] = None
    model_path: str
    bleu_score: Optional[float]
    rouge1_score: Optional[float]
    rouge2_score: Optional[float]
    rougeL_score: Optional[float]
    perplexity: Optional[float]
    llm_judge_score: Optional[float]
    sample_count: Optional[int]
    metrics_detail: Optional[dict]
    created_at: datetime

    class Config:
        from_attributes = True


# Chat schemas
class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant|system)$")
    content: str


class ChatRequest(BaseModel):
    model_path: str = ""          # 로컬 모델 경로 (local 모드)
    provider: Optional[str] = None  # "local" | "openai" | "anthropic" | "ollama"
    provider_model: Optional[str] = None  # 외부 LLM 모델명 override
    messages: list[ChatMessage]
    max_new_tokens: int = Field(default=512, ge=1, le=4096)
    temperature: float = Field(default=0.7, ge=0, le=2)
    stream: bool = False
    use_rag: bool = False
    rag_document_ids: list[int] = Field(default=[])
    rag_top_k: Optional[int] = Field(default=None, ge=1, le=20)


class RagSource(BaseModel):
    document_id: int
    filename: str
    chunk_index: int
    score: float
    content: str


class ChatResponse(BaseModel):
    response: str
    model_path: str
    tokens_generated: Optional[int] = None
    sources: list[RagSource] = Field(default_factory=list)


class AgentChatRequest(BaseModel):
    """MCP-enabled agent chat request — LLM can call tools to read system state."""
    provider: str = "openai"             # "openai" | "anthropic"
    provider_model: Optional[str] = None
    messages: list[ChatMessage]
    current_page: str = "/"             # Frontend route, e.g. "/training-results"
    max_tokens: int = Field(default=2048, ge=1, le=4096)
    temperature: float = Field(default=0.7, ge=0, le=2)
    plan_mode: bool = False              # True: 계획 수립만
    step_mode: bool = False              # True: 한 단계씩 실행 후 확인 요청
    persona: Optional[str] = None        # 사용자 정의 페르소나 (시스템 프롬프트에 추가)


class ToolCallDetail(BaseModel):
    name: str
    args: dict = {}
    result: str = ""   # JSON string


class AgentChatResponse(BaseModel):
    response: str
    tools_used: list[str] = []
    tool_call_details: list[ToolCallDetail] = []
    navigate_to: Optional[str] = None
    is_plan: bool = False                # 초기 계획 — 승인/취소 버튼 표시
    is_step_confirm: bool = False        # 단계 완료 후 다음 단계 확인 — 계속/중단 버튼 표시
    suppress_chat_response: bool = False # 도구/화면 진행만 반영하고 채팅 말풍선은 만들지 않음
    is_training_wait: bool = False       # 훈련/AutoResearch 진행 중 — 프론트엔드 자동 폴링용
    training_wait_job_id: Optional[int] = None   # 폴링 대상 job_id
    training_wait_tool: Optional[str] = None     # wait_for_training_job 또는 wait_for_autoresearch
    is_download_wait: bool = False       # 모델 다운로드 진행 중 — 완료 후 자동 plan 요청용
    download_wait_model_ids: list[str] = []      # 폴링 대상 model_id 목록


class CompareModelsRequest(BaseModel):
    base_model_path: str
    finetuned_model_path: str
    messages: list[ChatMessage]
    max_new_tokens: int = Field(default=512, ge=1, le=4096)


# Generic responses
class StatusResponse(BaseModel):
    status: str
    message: str
    data: Optional[Any] = None


class PipelineRequest(BaseModel):
    document_id: int
    model_id: str
    training_method: str = Field(default="lora")
    num_qa_pairs: int = Field(default=50, ge=5, le=500)
    epochs: int = Field(default=3, ge=1, le=50)
    max_steps: int = Field(default=-1)
    use_autoresearch: bool = False
