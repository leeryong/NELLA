# LLMOps Platform

An agent-based LLMOps platform that allows non-experts to fine-tune LLMs using their documents.
Inspired by karpathy/autoresearch for autonomous training optimization.

## Features

- **Document Processing**: PDF, DOCX, XLSX, PPTX, HWP support via MarkItDown
- **Training Data Generation**: Automatic Q&A pairs and DPO preference pairs via LLM
- **Model Registry**: Browse and download HuggingFace models (Qwen2.5, TinyLlama, Phi-3, Gemma, etc.)
- **SFT Training**: Full, LoRA, and QLoRA fine-tuning using TRL
- **DPO Training**: Direct Preference Optimization for alignment
- **AutoResearch Agent**: Autonomous hyperparameter optimization (try N configs, pick best)
- **Evaluation**: BLEU, ROUGE, perplexity, LLM-as-judge
- **Chat Interface**: Test fine-tuned models via browser
- **Real-time Monitoring**: WebSocket-based live training loss charts

## 빠른 시작 — Docker Compose (권장)

`docker compose up` 한 줄로 백엔드(Cython 컴파일된 GPU 이미지) + 프론트엔드(nginx) 가 함께 기동됩니다.

### 사전 준비 (OS 별 1회만)

#### Linux (Ubuntu / Debian 등 — 권장)
1. NVIDIA 드라이버 설치 (`nvidia-smi` 가 동작해야 함)
2. Docker Engine + Docker Compose v2 설치
3. NVIDIA Container Toolkit 설치:
   ```bash
   curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
   curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
     | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
     | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
   sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
   sudo nvidia-ctk runtime configure --runtime=docker
   sudo systemctl restart docker
   ```
4. 동작 확인: `docker run --rm --gpus all nvidia/cuda:12.4.1-runtime-ubuntu22.04 nvidia-smi`

#### Windows 10/11 (WSL2)
1. Windows 11 또는 최근 Windows 10 + WSL2 활성화
2. NVIDIA Studio/Game Ready 드라이버 설치 (Windows 본체)
3. Docker Desktop 설치 + Settings → Resources → WSL Integration 활성
4. WSL2 안에서 위 Linux 동작 확인 명령 실행

#### macOS
NVIDIA GPU 패스스루는 Docker on macOS 에서 지원되지 않습니다.
파인튜닝/로컬 추론은 **불가**하며, 외부 LLM API(OpenAI, Anthropic) 모드로만 사용 가능합니다.
이 경우에도 모든 기능이 동작하는 것은 아니므로 Linux/WSL2 환경을 권장합니다.

### 실행 (1 단계)

```bash
docker compose up -d --build
```

접속:
- 프론트엔드: http://localhost:3001
- 백엔드 API 문서: http://localhost:8010/docs

### API 키 입력

처음 접속한 뒤 **NELLA 우측 [설정] 화면**에서 본인 API 키를 입력하세요:
- `OPENAI_API_KEY` 또는 `ANTHROPIC_API_KEY` (둘 중 하나는 필수)
- `HF_TOKEN` (gated 모델 사용 시)

입력한 키는 `./data/.env` (호스트 측 마운트된 영속 볼륨) 에 저장되어 컨테이너 재시작 후에도 유지됩니다.

### 상태 확인 / 종료

```bash
docker compose ps                  # 컨테이너 상태
docker compose logs -f backend     # 백엔드 로그 추적
docker compose down                # 종료 (볼륨 보존)
docker compose down -v             # 종료 + 데이터까지 삭제 (주의)
```

### 데이터 보존

- 호스트의 `./data/` → 컨테이너 `/app/data/` 로 마운트되어 문서·데이터셋·학습 모델·로그가 영속 저장됩니다.
- 이미지 재빌드해도 데이터는 안전합니다.

### 자주 묻는 문제

- **`could not select device driver "nvidia"` 에러** → NVIDIA Container Toolkit 미설치/미설정. 위 "사전 준비" 다시 확인.
- **컨테이너는 뜨는데 GPU 미인식** → `docker compose exec backend nvidia-smi` 로 확인. 안 보이면 호스트 드라이버/툴킷 점검.
- **모델 다운로드 실패** → `.env` 의 `HF_TOKEN` 누락. 일부 모델(Llama, Gemma 등)은 HuggingFace 사용 동의 + 토큰 필요.
- **OpenAI/Anthropic 호출 실패** → `.env` 의 키 확인.

---

## Pipeline Walkthrough

### Step 1: Upload Document
Upload PDF, DOCX, HWP, or other documents. The system automatically:
- Converts HWP to PDF (via libreoffice)
- Extracts text using Microsoft MarkItDown
- Counts words and estimates pages

### Step 2: Generate Training Data
Use the LLM to automatically generate Q&A pairs or DPO preference pairs from your document.
- SFT format: instruction/output pairs for supervised fine-tuning
- DPO format: prompt/chosen/rejected pairs for preference optimization
- Custom upload: upload your own JSONL training data

### Step 3: Download Model
Browse curated models from HuggingFace:
- **Tiny (<2B)**: Qwen2.5-0.5B, SmolLM2-360M, TinyLlama-1.1B
- **Small (2-7B)**: Qwen2.5-3B, Phi-3-mini, Gemma-2-2B
- **Medium (7-13B)**: Qwen2.5-7B, Mistral-7B

### Step 4: Train
Configure and start training:
- **SFT LoRA**: Most common, efficient, recommended
- **SFT QLoRA**: For GPU memory-constrained environments
- **DPO**: Align model with human preferences
- **AutoResearch**: Let the system find the best hyperparameters automatically

### Step 5: Evaluate
Evaluate on held-out test data:
- BLEU, ROUGE-1/2/L scores
- Perplexity
- Optional LLM-as-judge scoring

### Step 6: Chat
Test your fine-tuned model in the browser chat interface.

## Architecture

```
llmops/
├── backend/
│   ├── main.py                 # FastAPI app
│   ├── config.py               # Settings via env vars
│   ├── database.py             # SQLAlchemy + SQLite
│   ├── agents/
│   │   ├── orchestrator.py     # Full pipeline coordinator
│   │   ├── document_agent.py   # Document processing
│   │   ├── data_gen_agent.py   # Training data generation
│   │   ├── training_agent.py   # Training orchestration
│   │   ├── eval_agent.py       # Evaluation
│   │   └── autoresearch_agent.py  # Autonomous optimization
│   ├── services/
│   │   ├── document_processor.py  # MarkItDown + HWP
│   │   ├── llm_service.py         # OpenAI/Claude/Ollama
│   │   ├── hf_registry.py         # HuggingFace models
│   │   ├── sft_trainer.py         # TRL SFT training
│   │   ├── rl_trainer.py          # DPO/PPO training
│   │   ├── evaluator.py           # BLEU/ROUGE/PPL
│   │   └── inference.py           # Model inference
│   ├── api/                    # FastAPI routers
│   └── schemas/                # Pydantic models
├── frontend/
│   └── src/
│       ├── pages/              # React pages
│       ├── components/         # Reusable components
│       └── services/api.ts     # API client
├── data/
│   ├── documents/              # Uploaded documents
│   ├── extracted/              # Extracted text
│   ├── training_data/          # Generated datasets
│   └── models/                 # Downloaded models
└── tests/
    ├── integration_test.py     # Full pipeline test
    ├── test_document_processing.py
    ├── test_data_generation.py
    └── test_training.py
```

## AutoResearch Agent

The AutoResearch agent (inspired by karpathy/autoresearch) automatically finds the best training configuration:

1. **Generate trial configs**: Default + variations (different LR, LoRA rank, batch size)
2. **Run quick trials**: Train for N steps per config, record eval loss
3. **Select best**: Pick config with lowest evaluation loss
4. **Full training**: Train with best config for full epochs

```python
# Example: start AutoResearch via API
POST /api/training/autoresearch
{
  "dataset_id": 1,
  "model_id": "Qwen/Qwen2.5-0.5B-Instruct",
  "method": "lora",
  "max_trials": 5,
  "steps_per_trial": 50,
  "final_epochs": 3
}
```

## Docker

```bash
# Build and run everything
docker-compose up --build

# Backend only
docker build -f Dockerfile.backend -t llmops-backend .
docker run -p 8000:8000 -v ./data:/app/data llmops-backend
```

## LLM Providers

Configure in `.env`:

```bash
# OpenAI (default)
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...

# Anthropic
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Local Ollama (no API key needed)
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
```

## HWP File Support

To process Korean HWP files, install libreoffice:
```bash
# macOS
brew install --cask libreoffice

# Ubuntu
sudo apt-get install libreoffice

# Or use hwp2pdf
pip install hwp2pdf
```

## Requirements

- Python 3.10+
- 8GB+ RAM (more for larger models)
- GPU recommended for training (can use CPU for small models with max_steps)
- For QLoRA: GPU with 8GB+ VRAM
- For LoRA with 7B models: GPU with 16GB+ VRAM
