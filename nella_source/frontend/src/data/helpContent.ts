interface HelpSection {
  title: string;
  items: string[];
}

interface HelpEntry {
  pageTitle: string;
  summary: string;
  sections: HelpSection[];
}

export const helpContent: Record<string, HelpEntry> = {
  documents: {
    pageTitle: "문서 업로드",
    summary: "PDF·DOCX·HWP 문서를 업로드하고 텍스트(및 이미지)를 추출합니다. 추출된 텍스트는 다음 단계 '학습데이터 생성'에 사용됩니다.",
    sections: [
      {
        title: "지원 형식",
        items: [
          "<b>PDF</b> / <b>DOCX</b> / <b>HWP</b> 업로드 지원",
          "여러 파일을 동시 업로드 시 대기열에서 순차 처리됩니다",
        ],
      },
      {
        title: "텍스트 추출 방식",
        items: [
          "<b>openDataLoader</b> (기본) — PDF·DOCX·HWP 통합 처리, 이미지 추출 지원",
          "<b>MarkItDown</b> — 마크다운 변환에 최적화",
          "<b>PyPDF</b> — PDF 전용 텍스트 추출",
          "<b>Docling</b> — GPU/MPS 가속, 표·이미지 인식 우수",
        ],
      },
      {
        title: "사용 방법",
        items: [
          "추출 방식과 '이미지도 추출' 옵션을 선택한 뒤 파일을 업로드합니다",
          "처리 상태와 진행률은 실시간 표시됩니다",
        ],
      },
      {
        title: "주의사항",
        items: [
          "스캔 PDF는 추출기에 따라 결과 품질이 달라질 수 있습니다",
          "파일 크기가 큰 문서는 처리 시간이 길어질 수 있습니다",
        ],
      },
    ],
  },

  dataGeneration: {
    pageTitle: "학습데이터 생성",
    summary: "추출된 문서 또는 업로드한 JSONL을 기반으로 LLM이 학습용 질문-답변 데이터를 자동 생성합니다.",
    sections: [
      {
        title: "데이터 유형",
        items: [
          "<b>QA (SFT)</b> — 일반 질문/답변 쌍",
          "<b>CoT</b> (Chain-of-Thought) — 단계별 추론 과정 포함",
          "<b>ToT</b> (Tree-of-Thought) — 분기 탐색형 추론 데이터",
          "<b>GoT</b> (Graph-of-Thought) — 그래프 구조 추론 데이터",
          "<b>DPO</b> — 선호/비선호 응답 쌍 (선호도 학습용)",
        ],
      },
      {
        title: "생성 옵션",
        items: [
          "원본 소스: <b>문서 선택</b> 또는 <b>JSONL 업로드</b>",
          "생성 쌍 수와 훈련:테스트 분할 비율 지정",
          "LLM 공급자 선택: 기본값 · OpenAI · Anthropic · Ollama",
          "시스템/사용자 프롬프트를 직접 편집해 생성 스타일을 제어할 수 있습니다",
        ],
      },
      {
        title: "결과 확인",
        items: [
          "생성 진행률은 실시간 표시됩니다",
          "완료 후 미리보기 모달에서 훈련/테스트 샘플 상위 10건을 확인할 수 있습니다",
          "다음 단계 '데이터 검증'에서 품질 평가 후 훈련에 사용할 것을 권장합니다",
        ],
      },
    ],
  },

  dataValidation: {
    pageTitle: "학습데이터 검증",
    summary: "생성된 학습데이터를 규칙 기반 또는 LLM 기반으로 평가하여, 저품질 샘플을 걸러냅니다.",
    sections: [
      {
        title: "LLM 기반 검증",
        items: [
          "LLM(OpenAI · Anthropic · Ollama)을 평가자로 사용",
          "전체 데이터 또는 대표 샘플만 평가하도록 선택 가능",
          "다음 5개 기준을 점수화: <b>정확성 · 관련성 · 명확성 · 완성도 · 다양성</b>",
          "발견된 문제는 심각도(높음/중간/낮음)와 함께 표시됩니다",
        ],
      },
      {
        title: "규칙 기반 검증",
        items: [
          "답변 길이 범위, 중복, 저품질 항목을 자동 필터링",
          "조건 미달 항목 제거 옵션 제공",
          "빠르고 비용 부담 없음",
        ],
      },

      {
        title: "사용 방법",
        items: [
          "데이터 유형(QA/DPO)과 데이터셋을 선택합니다",
          "평가 방식과 옵션을 설정한 뒤 '평가 시작'을 누릅니다",
          "진행 중 '중단' 버튼으로 언제든 중지할 수 있습니다",
        ],
      },
      {
        title: "결과와 다음 단계",
        items: [
          "총점(10점 만점)과 기준별 점수가 레이더/막대 차트로 시각화됩니다",
          "고품질 기준을 통과한 데이터 비율을 한눈에 확인",
          "'검증 데이터셋'이 자동 생성되어 훈련 단계에서 선택 가능",
          "검증 이력은 언제든 다시 조회할 수 있습니다",
        ],
      },
    ],
  },

  modelSelection: {
    pageTitle: "기반모델 선택",
    summary: "파인튜닝의 출발점이 될 사전학습 모델을 HuggingFace에서 검색·다운로드합니다.",
    sections: [
      {
        title: "두 가지 모델 소스",
        items: [
          "<b>큐레이션 모델</b> — NELLA가 사전 검증한 추천 모델 (크기·정렬 필터 제공)",
          "<b>HuggingFace 최신 모델</b> — Hub에서 인기/좋아요/최신순으로 검색",
        ],
      },
      {
        title: "필터·정렬 옵션",
        items: [
          "크기: 소형(&lt;2B) · 중소형(2~7B) · 중형(7~13B)",
          "정렬: 인기순 · 좋아요순 · 최신순 · 오래된순 · 크기 오름/내림차순",
        ],
      },
      {
        title: "다운로드",
        items: [
          "다운로드 진행률은 우측 하단 패널에 실시간 표시됩니다",
          "다운로드 중 '취소' 가능",
          "완료된 모델은 상단 '내 모델' 목록에서 채팅 테스트하거나 삭제할 수 있습니다",
        ],
      },
      {
        title: "라이선스 동의가 필요한 모델",
        items: [
          "Llama, Gemma 계열은 HuggingFace에서 라이선스 동의가 선행되어야 합니다",
          "설정에 <code>HF_TOKEN=hf_...</code> 등록 후 사용 가능",
        ],
      },
    ],
  },

  modelValidation: {
    pageTitle: "모델 검증",
    summary: "후보 베이스 모델의 내부 반응을 분석해, 파인튜닝 전에 유망한 모델을 예측·선정합니다. (Beta)",
    sections: [
      {
        title: "예측 방식 두 가지",
        items: [
          "<b>방식 A — 최종 점수 기반</b>: 현재 점수 측정 + 개선율 예측하여 정밀하지만 시간이 걸립니다.",
          "<b>방식 B — 개선율 기반</b>: 개선율(%)만 예측하여 빠릅니다.",
        ],
      },
      {
        title: "사용 흐름",
        items: [
          "평가용 SFT 데이터셋을 선택합니다 (다중 선택 시 자동 병합)",
          "비교할 후보 모델을 체크하거나 HuggingFace 모델 ID를 직접 추가합니다",
          "검증 샘플 수와 LLM 평가자(방식 A)를 지정한 뒤 '검증 시작'을 누릅니다",
        ],
      },
      {
        title: "다음 단계",
        items: [
          "1순위 모델이 '최적 선택'으로 표시됩니다",
          "선택된 모델로 '모델 훈련' 단계에서 바로 파인튜닝을 진행할 수 있습니다",
        ],
      },
    ],
  },

  training: {
    pageTitle: "모델 훈련",
    summary: "선택한 기반모델과 학습데이터로 파인튜닝을 실행합니다. 수동 설정과 AutoResearch(하이퍼파라미터 자동 탐색) 모드를 지원합니다.",
    sections: [
      {
        title: "훈련 도구",
        items: [
          "<b>TRL</b> — HuggingFace 공식 라이브러리, 가장 안정적",
          "<b>Axolotl</b> — YAML 설정 기반, 옵션이 다양",
          "<b>Unsloth</b> — 2~4배 빠른 학습, 메모리 효율적",
        ],
      },
      {
        title: "훈련 단계",
        items: [
          "<b>SFT</b> — 지도 파인튜닝 (질문-답변 학습)",
          "<b>DPO</b> — 선호도 기반 최적화",
        ],
      },
      {
        title: "학습 방식",
        items: [
          "<b>LoRA</b> — 어댑터만 학습, 빠르고 메모리 효율적 (권장)",
          "<b>QLoRA</b> — 4비트 양자화 + LoRA, 최소 VRAM 사용",
          "<b>Full FT</b> — 전체 파라미터 학습, 큰 VRAM 필요",
        ],
      },
      {
        title: "사용 방법",
        items: [
          "데이터셋(다중 선택 시 자동 병합)·기반모델·하이퍼파라미터를 설정합니다",
          "필요하면 자동 생성된 명령어를 복사해 외부에서 직접 실행할 수도 있습니다",
          "'훈련 시작' 또는 'AutoResearch 시작'을 클릭합니다",
          "loss 곡선과 로그를 실시간 모니터링하며 '중단' 가능",
        ],
      },
      {
        title: "AutoResearch",
        items: [
          "최대 시도 횟수, 시도당 스텝, 최종 에폭을 지정",
          "여러 하이퍼파라미터 조합을 자동 탐색해 최적 설정을 산출합니다",
        ],
      },
    ],
  },

  trainingResults: {
    pageTitle: "훈련결과 보기",
    summary: "완료된 훈련 작업의 메트릭과 산출물을 관리합니다. LoRA 어댑터 병합, 모델 다운로드, 채팅 테스트로 바로 연결됩니다.",
    sections: [
      {
        title: "상태 필터",
        items: [
          "전체 · 완료 · 취소 · 실패 탭으로 작업을 분류해 볼 수 있습니다",
        ],
      },
      {
        title: "확인 가능한 정보",
        items: [
          "최종/최적 손실값과 학습 곡선 그래프",
          "훈련 설정 (에폭 · 학습률 · 배치 크기 · LoRA R/Alpha 등)",
          "AutoResearch 시도별 결과 테이블 (trial별 loss · step · 소요 시간)",
          "저장된 체크포인트 경로",
        ],
      },
      {
        title: "주요 작업",
        items: [
          "<b>모델/어댑터 다운로드</b> — LoRA 어댑터 또는 완성 모델 파일 다운로드",
          "<b>LoRA 병합</b> — 기반모델 + 어댑터를 단일 모델로 병합 (진행률 SSE 표시)",
          "<b>LoRA 사용 가이드</b> — 외부에서 어댑터를 로드하는 Python 코드 샘플 제공",
          "<b>채팅 테스트</b> — '대화 테스트' 페이지로 바로 이동",
        ],
      },
    ],
  },

  evaluation: {
    pageTitle: "모델 평가",
    summary: "파인튜닝된 모델의 성능을 정량 지표(BLEU·ROUGE·Perplexity·LLM Judge)와 표준 벤치마크로 측정합니다.",
    sections: [
      {
        title: "기본 평가",
        items: [
          "완료된 훈련 작업을 선택합니다",
          "테스트 데이터을 지정합니다",
          "<b>LLM 심사</b> 옵션을 켜면 답변 품질을 LLM이 추가 채점합니다",
          "평가 시작 후 진행률이 실시간 표시되며 '중지'할 수 있습니다",
        ],
      },
      {
        title: "지표 설명",
        items: [
          "<b>BLEU</b> — 정답과 모델 출력의 n-gram 일치도",
          "<b>ROUGE-1/2/L</b> — 정답 대비 모델 출력의 재현율 (요약 품질 평가에 사용)",
          "<b>Perplexity</b> — 모델의 언어 예측 불확실성 (낮을수록 좋음)",
          "<b>LLM Judge</b> — LLM이 응답 품질을 직접 채점",
        ],
      },
      {
        title: "벤치마크 평가",
        items: [
          "로컬에 저장된 모델 + 다중 선택한 벤치마크로 표준 점수를 산출합니다",
          "지원 벤치마크: <b>MMLU · ARC-Easy/Challenge · HellaSwag · TruthfulQA · GSM8K · WinoGrande · Ko-MMLU · KLUE</b>",
          "결과는 막대·레이더 차트와 점수 테이블로 표시되며 이전 기록과 비교 가능",
        ],
      },
    ],
  },

  chat: {
    pageTitle: "대화 테스트",
    summary: "훈련된 로컬 모델 또는 외부 API 모델과 실시간으로 대화하며 응답 품질을 검증합니다. RAG(문서 검색 기반 응답)를 함께 활용할 수 있습니다.",
    sections: [
      {
        title: "대화 방식",
        items: [
          "<b>로컬 모델</b> — 다운로드된 모델 또는 훈련 완료 모델 선택, 경로 직접 입력도 가능",
          "<b>OpenAI</b> — GPT-4o · GPT-4o-mini · GPT-4-turbo · GPT-3.5-turbo",
          "<b>Anthropic</b> — Claude Sonnet · Haiku · Opus 계열",
          "<b>Ollama</b> — 로컬 Ollama 서버를 통한 추론",
        ],
      },
      {
        title: "RAG 모드",
        items: [
          "토글을 켜면 업로드된 문서가 VectorDB에서 검색되어 응답 컨텍스트로 사용됩니다",
          "사실 기반 질의에서 환각(hallucination)을 줄이는 데 효과적",
        ],
      },
      {
        title: "사용 방법",
        items: [
          "대화 방식과 모델을 선택합니다 (로컬 모델은 초기 로딩에 시간이 걸릴 수 있음)",
          "'준비 완료' 상태가 되면 메시지를 입력해 대화를 시작합니다",
          "기반모델과 파인튜닝 모델을 번갈아 선택해 응답 차이를 비교할 수 있습니다",
        ],
      },
    ],
  },

  llmSettings: {
    pageTitle: "LLM 설정",
    summary: "학습데이터 생성·검증·평가에 사용할 외부 LLM 공급자와 API 키, 기본 모델을 설정합니다.",
    sections: [
      {
        title: "지원 공급자",
        items: [
          "<b>OpenAI</b> — GPT-4o · GPT-4o-mini 등",
          "<b>Anthropic</b> — Claude Sonnet · Haiku · Opus 계열",
          "<b>Ollama</b> — 로컬 LLM (Llama · Mistral 등)",
        ],
      },
      {
        title: "설정 방법",
        items: [
          "API 키는 이 페이지 또는 <code>.env</code> 파일에서 등록합니다",
          "공급자와 모델을 선택하고 '저장'을 누르면 즉시 적용됩니다",
          "Ollama 사용 시 로컬 Ollama 서버가 실행 중이어야 합니다",
        ],
      },
      {
        title: "용도별 권장",
        items: [
          "데이터 생성: 비용 효율적인 GPT-4o-mini 또는 Claude Haiku 권장",
          "데이터 검증·LLM Judge: 정밀도가 중요하므로 GPT-4o 또는 Claude Sonnet 권장",
        ],
      },
    ],
  },
};
