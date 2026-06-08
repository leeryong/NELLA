import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAgentPolling } from "../hooks/useAgentPolling";
import { useAgentToolResult } from "../hooks/useAgentToolResult";
import { Database, RefreshCw, Eye, ClipboardCheck, Loader2, CheckCircle, Clock, Trash2, AlertCircle, ChevronDown, ChevronUp, RotateCcw, MessageSquare, FileJson, X, ListOrdered, StopCircle, AlertTriangle } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

const OWNED_PATH = "/data";
const AGENT_PAGE_START_EVENT = "nella-agent-page-start";
const SS_AGENT_ACTIVE_PAGE = "nella.agent.activePage";
import { documentsApi, trainingDataApi, Document, Dataset } from "../services/api";
import { formatDate } from "../lib/utils";
import PageHelp from "../components/PageHelp";
import { emitPipelineEvent } from "../pipelineEvent";

// ── 기본 프롬프트 상수 ─────────────────────────────────
const DEFAULT_SFT_SYSTEM = `당신은 언어 모델 훈련을 위한 고품질 질문-답변 쌍을 생성하는 전문가입니다.
제공된 텍스트의 다양한 측면을 다루는 다양하고 유익한 Q&A 쌍을 생성하세요.
"question", "answer", "context" 키를 가진 유효한 JSON 배열만 반환하세요.
답변은 정확하고 완전하며, 제공된 텍스트에만 기반해야 합니다.
중요: 질문과 답변은 반드시 입력 텍스트와 동일한 언어로 작성하세요. 한국어 텍스트이면 한국어로, 영어 텍스트이면 영어로 작성하세요.`;

const DEFAULT_SFT_USER = `다음 텍스트에서 {num_pairs}개의 다양한 질문-답변 쌍을 생성하세요.
질문은 사실 확인형, 분석형, 이해력 평가형 등 다양하게 구성하세요.

텍스트:
{text}

다음 형식의 JSON 배열로 반환하세요:
[
  {"question": "...", "answer": "...", "context": "..."},
  ...
]`;

const DEFAULT_COT_SYSTEM = `당신은 Chain-of-Thought(CoT) 학습 데이터를 생성하는 전문가입니다.
각 질문에 대해 정답으로 이어지는 명확한 단계별 추론(reasoning)을 작성하세요.
추론은 반드시 제공된 텍스트에만 근거해야 하며, 논리적이고 명시적이어야 합니다.
"question", "reasoning", "answer", "context" 키를 가진 JSON 배열만 반환하세요.
중요: 모든 필드는 입력 텍스트와 동일한 언어로 작성하세요.`;

const DEFAULT_COT_USER = `다음 텍스트에서 {num_pairs}개의 Chain-of-Thought 추론 예시를 생성하세요.
각 예시: 질문, 단계별 명시적 추론 체인, 최종 답변을 포함합니다.

텍스트:
{text}

다음 형식의 JSON 배열로 반환하세요:
[
  {
    "question": "...",
    "reasoning": "1단계: ...\\n2단계: ...\\n3단계: ...",
    "answer": "최종 간결한 답",
    "context": "관련된 텍스트 일부"
  },
  ...
]`;

const DEFAULT_TOT_SYSTEM = `당신은 Tree-of-Thought(ToT) 학습 데이터를 생성하는 전문가입니다.
각 질문에 대해 2~3개의 후보 추론 경로를 탐색하고, 각 경로를 평가(score)한 후 가장 좋은 경로를 선택(selected=true)하세요.
추론은 반드시 제공된 텍스트에만 근거해야 합니다.
"question", "reasoning"(paths 배열을 가진 객체), "answer", "context" 키를 가진 JSON 배열만 반환하세요.
각 path: {"id": int, "steps": [str], "score": 0~1 사이의 float, "selected": bool}. 정확히 하나의 path만 selected=true.
중요: 모든 필드는 입력 텍스트와 동일한 언어로 작성하세요.`;

const DEFAULT_TOT_USER = `다음 텍스트에서 {num_pairs}개의 Tree-of-Thought 추론 예시를 생성하세요.
각 예시: 질문, 2~3개 후보 경로(점수 포함, 최선 1개 선택), 최종 답변을 포함합니다.

텍스트:
{text}

다음 형식의 JSON 배열로 반환하세요:
[
  {
    "question": "...",
    "reasoning": {
      "paths": [
        {"id": 1, "steps": ["...", "..."], "score": 0.4, "selected": false},
        {"id": 2, "steps": ["...", "..."], "score": 0.9, "selected": true}
      ]
    },
    "answer": "선택된 경로에서 도출된 최종 답",
    "context": "관련된 텍스트 일부"
  },
  ...
]`;

const DEFAULT_GOT_SYSTEM = `당신은 Graph-of-Thought(GoT) 학습 데이터를 생성하는 전문가입니다.
각 질문에 대해 추론을 상호 연결된 사고 노드의 그래프로 분해하고, 노드들이 합쳐져 최종 답변에 도달하도록 구성하세요.
추론은 반드시 제공된 텍스트에만 근거해야 합니다.
"question", "reasoning"(nodes/edges를 가진 객체), "answer", "context" 키를 가진 JSON 배열만 반환하세요.
nodes: [{"id": str, "content": str}], edges: [{"from": str, "to": str, "relation": str}].
중요: 모든 필드는 입력 텍스트와 동일한 언어로 작성하세요.`;

const DEFAULT_GOT_USER = `다음 텍스트에서 {num_pairs}개의 Graph-of-Thought 추론 예시를 생성하세요.
각 예시: 질문, 추론 노드 그래프(노드+방향성 엣지), 그래프에서 종합된 최종 답변을 포함합니다.

텍스트:
{text}

다음 형식의 JSON 배열로 반환하세요:
[
  {
    "question": "...",
    "reasoning": {
      "nodes": [
        {"id": "n1", "content": "텍스트의 전제"},
        {"id": "n2", "content": "유도된 추론"},
        {"id": "n3", "content": "결합된 결론"}
      ],
      "edges": [
        {"from": "n1", "to": "n2", "relation": "함의"},
        {"from": "n2", "to": "n3", "relation": "뒷받침"}
      ]
    },
    "answer": "최종 답",
    "context": "관련된 텍스트 일부"
  },
  ...
]`;

const DEFAULT_DPO_SYSTEM = `당신은 인간 피드백 기반 강화학습(RLHF)을 위한 선호도 쌍을 생성하는 전문가입니다.
각 질문에 대해 선택된(선호/정확한) 응답과 거부된(열등/부정확한) 응답을 각각 하나씩 생성하세요.
유효한 JSON 배열만 반환하세요.
중요: prompt, chosen, rejected는 반드시 입력 텍스트와 동일한 언어로 작성하세요. 한국어 텍스트이면 한국어로, 영어 텍스트이면 영어로 작성하세요.`;

const DEFAULT_DPO_USER = `DPO 훈련을 위해 다음 텍스트에서 {num_pairs}개의 선호도 쌍을 생성하세요.

텍스트:
{text}

JSON 배열로 반환하세요:
[
  {
    "prompt": "텍스트에 관한 질문",
    "chosen": "고품질의 정확하고 상세한 답변",
    "rejected": "품질이 낮거나 모호하거나 부정확한 답변"
  },
  ...
]`;

// 데이터 유형별 기본 프롬프트 매핑
const DEFAULT_PROMPTS: Record<string, { system: string; user: string }> = {
  sft: { system: DEFAULT_SFT_SYSTEM, user: DEFAULT_SFT_USER },
  cot: { system: DEFAULT_COT_SYSTEM, user: DEFAULT_COT_USER },
  tot: { system: DEFAULT_TOT_SYSTEM, user: DEFAULT_TOT_USER },
  got: { system: DEFAULT_GOT_SYSTEM, user: DEFAULT_GOT_USER },
  dpo: { system: DEFAULT_DPO_SYSTEM, user: DEFAULT_DPO_USER },
};

// 데이터 유형 라벨 & 배지 색상
const DATA_TYPE_LABEL: Record<string, string> = {
  sft: "QA",
  cot: "CoT",
  tot: "ToT",
  got: "GoT",
  dpo: "DPO",
  sft_alpaca: "QA",
  sft_messages: "QA",
  qa: "QA",
};

const DATA_TYPE_BADGE: Record<string, string> = {
  sft: "bg-blue-50 text-blue-600",
  cot: "bg-emerald-50 text-emerald-600",
  tot: "bg-amber-50 text-amber-600",
  got: "bg-rose-50 text-rose-600",
  dpo: "bg-purple-50 text-purple-600",
};

const dataTypeLabel = (t: string) => DATA_TYPE_LABEL[t] ?? t.toUpperCase();
const dataTypeBadge = (t: string) => DATA_TYPE_BADGE[t] ?? "bg-gray-50 text-gray-600";

interface GenProgress {
  message: string;
  percent: number;
  done: boolean;
  error?: boolean;
}

// ── Progress Bar 컴포넌트 ─────────────────────────────
const ProgressBar: React.FC<{ progress: GenProgress }> = ({ progress }) => (
  <div className="mt-2 space-y-1">
    <div className="flex items-center justify-between text-xs">
      <span className={`flex items-center gap-1.5 ${progress.error ? "text-red-600" : "text-blue-600"}`}>
        {progress.error
          ? <AlertCircle className="w-3 h-3 flex-shrink-0" />
          : <svg className="w-3 h-3 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
            </svg>
        }
        {progress.message}
      </span>
      <span className="text-gray-400 font-mono tabular-nums">{progress.percent}%</span>
    </div>
    <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
      <div
        className={`h-2 rounded-full transition-all duration-500 ease-out ${progress.error ? "bg-red-400" : ""}`}
        style={{
          width: `${progress.percent}%`,
          ...(progress.error ? {} : {
            background: "linear-gradient(90deg, #3b82f6 0%, #6366f1 50%, #3b82f6 100%)",
            backgroundSize: "200% 100%",
            animation: "shimmer 1.5s linear infinite",
          }),
        }}
      />
    </div>
    <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
  </div>
);

// ── 메인 컴포넌트 ─────────────────────────────────────
const DataGeneration: React.FC = () => {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [activeIds, setActiveIds] = useState<Set<number>>(new Set());
  const [form, setForm] = useState({
    document_id: "",
    num_pairs: 10,
    dataset_name: "",
    train_ratio: 0.9,
    data_type: "sft",
    llm_provider: "",
  });
  const [generating, setGenerating] = useState(false);
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [progressMap, setProgressMap] = useState<Record<number, GenProgress>>({});
  const [error, setError] = useState<string | null>(null);
  const [previewModal, setPreviewModal] = useState<{
    id: number;
    name: string;
    trainCount: number;
    testCount: number;
    trainSamples: unknown[];
    testSamples: unknown[];
    activeSplit: "train" | "test";
    loading?: boolean;
    error?: string;
  } | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Dataset | null>(null);
  const [dataSource, setDataSource] = useState<"document" | "jsonl">("document");
  const [agentPreparing, setAgentPreparing] = useState<{ label: string; ts: number } | null>(null);
  const esRefs = useRef<Record<number, EventSource>>({});
  const previewCacheRef = useRef<Record<number, { trainSamples: unknown[]; testSamples: unknown[] }>>({});

  // 프롬프트 편집기
  const [showPrompt, setShowPrompt] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [userPromptTemplate, setUserPromptTemplate] = useState("");

  const defaultSystem = (DEFAULT_PROMPTS[form.data_type] ?? DEFAULT_PROMPTS.sft).system;
  const defaultUser = (DEFAULT_PROMPTS[form.data_type] ?? DEFAULT_PROMPTS.sft).user;
  const isPromptCustomized = systemPrompt.trim() !== "" || userPromptTemplate.trim() !== "";

  const resetPrompts = () => { setSystemPrompt(""); setUserPromptTemplate(""); };

  // ── SSE 연결 (진행 상황 스트리밍) ─────────────────
  const subscribeProgress = (id: number) => {
    if (esRefs.current[id]) return; // 이미 구독 중
    setGeneratingId(id);
    setProgressMap((prev) => ({
      ...prev,
      [id]: prev[id] ?? { message: "생성 준비 중...", percent: 0, done: false },
    }));
    const es = new EventSource(`/api/training-data/${id}/progress`);
    esRefs.current[id] = es;
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.heartbeat) return;
        setProgressMap((prev) => ({
          ...prev,
          [id]: { message: data.message ?? "", percent: data.percent ?? 0, done: !!data.done, error: !!data.error },
        }));
        if (data.done) {
          if (data.error) {
            emitPipelineEvent({ kind: "failed", label: "⚙️ 학습데이터 생성 실패", detail: data.message ?? "" });
          } else {
            emitPipelineEvent({ kind: "complete", label: "⚙️ 학습데이터 생성 완료", detail: `데이터셋 #${id}` });
          }
          es.close();
          delete esRefs.current[id];
          setGeneratingId((prev) => (prev === id ? null : prev));
          load();
        }
      } catch { /* ignore */ }
    };
    es.onerror = () => {
      es.close();
      delete esRefs.current[id];
      setGeneratingId((prev) => (prev === id ? null : prev));
      load();
    };
  };

  const load = async () => {
    const [docs, ds, active] = await Promise.all([
      documentsApi.list(0, 1000),
      trainingDataApi.list(),
      trainingDataApi.activeIds(),
    ]);
    setDocuments((docs.data ?? []).filter((d) => d.status === "completed"));
    setDatasets(ds.data ?? []);
    const ids = active.data.active_ids as number[];
    setActiveIds(new Set(ids));
    // 폴링에서 새로 active된 ID도 SSE 구독 (초기 마운트 이후에 시작된 생성 포함)
    ids.forEach((id) => {
      if (!esRefs.current[id]) subscribeProgress(id);
    });
    return ids;
  };

  const stableLoad = useCallback(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const isActive = useLocation().pathname === OWNED_PATH;
  useAgentPolling(stableLoad, { idle: 3_000, active: 2_500, immediate: false, enabled: isActive });
  useAgentToolResult(
    [
      "generate_sft_data", "generate_dpo_data",
      "generate_cot_data", "generate_tot_data", "generate_got_data",
      "get_dataset_status",
      "delete_dataset", "cancel_dataset", "delete_all_datasets",
      "preview_dataset", "filter_dataset", "wait_for_dataset",
      "search_training_data",
    ],
    (detail) => {
      // 에이전트가 학습데이터 생성 도구를 호출하면 폼을 그 인자로 채워
      // 사용자가 NELLA가 어떤 파라미터로 작업하고 있는지 즉시 확인할 수 있도록 한다.
      const genKindMap: Record<string, string> = {
        generate_sft_data: "sft",
        generate_cot_data: "cot",
        generate_tot_data: "tot",
        generate_got_data: "got",
        generate_dpo_data: "dpo",
      };
      if (detail.name && genKindMap[detail.name]) {
        const args = (detail.args ?? {}) as Record<string, unknown>;
        const result = (detail.result ?? {}) as Record<string, unknown>;
        const docIdRaw = args.document_id;
        const docId = docIdRaw != null ? String(docIdRaw) : "";
        // 응답에 dataset_name이 있으면 그것을 우선 (자동 생성된 최종 이름),
        // 없으면 인자의 dataset_name, 모두 없으면 빈 문자열(form 갱신 시 자동 생성 로직이 작동)
        const dsName =
          (typeof result.dataset_name === "string" && result.dataset_name) ||
          (typeof args.dataset_name === "string" && args.dataset_name) ||
          "";
        setForm((prev) => ({
          ...prev,
          document_id: docId || prev.document_id,
          num_pairs: typeof args.num_pairs === "number" ? args.num_pairs : prev.num_pairs,
          train_ratio: typeof args.train_ratio === "number" ? args.train_ratio : prev.train_ratio,
          data_type: genKindMap[detail.name!] ?? prev.data_type,
          dataset_name: dsName || prev.dataset_name,
          llm_provider: typeof args.llm_provider === "string" ? args.llm_provider : prev.llm_provider,
        }));
        // 커스텀 프롬프트도 에이전트가 지정했으면 표시
        if (typeof args.system_prompt === "string" && args.system_prompt) {
          setSystemPrompt(args.system_prompt);
        }
        if (typeof args.user_prompt_template === "string" && args.user_prompt_template) {
          setUserPromptTemplate(args.user_prompt_template);
        }
      }
      void load();
    },
    isActive,
  );

  useEffect(() => {
    if (!isActive) return;
    const startPreparing = (detail: { page?: string; label?: string; ts?: number }) => {
      if (detail.page !== OWNED_PATH) return;
      setAgentPreparing({
        label: detail.label || "학습데이터 생성",
        ts: detail.ts || Date.now(),
      });
      void load();
    };
    const handleAgentPageStart = (event: Event) => {
      startPreparing((event as CustomEvent<{ page?: string; label?: string; ts?: number }>).detail ?? {});
    };
    window.addEventListener(AGENT_PAGE_START_EVENT, handleAgentPageStart);
    try {
      const stored = window.sessionStorage.getItem(SS_AGENT_ACTIVE_PAGE);
      if (stored) {
        const parsed = JSON.parse(stored) as { page?: string; label?: string; ts?: number };
        if (parsed.page === OWNED_PATH && parsed.ts && Date.now() - parsed.ts < 60_000) {
          startPreparing(parsed);
        }
      }
    } catch { /* ignore */ }
    return () => window.removeEventListener(AGENT_PAGE_START_EVENT, handleAgentPageStart);
  }, [isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!agentPreparing) return;
    const hasVisibleWork = generatingId != null || activeIds.size > 0 || Object.values(progressMap).some((p) => !p.done);
    if (hasVisibleWork) setAgentPreparing(null);
  }, [agentPreparing, generatingId, activeIds, progressMap]);

  // 초기 로드 — 진행 중 작업 있으면 SSE 재연결 (모든 활성 ID 구독)
  useEffect(() => {
    load().then((ids) => {
      ids.forEach((id) => subscribeProgress(id));
    });
    return () => {
      Object.values(esRefs.current).forEach((es) => es.close());
      esRefs.current = {};
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 미완료 항목 있으면 5초마다 자동 갱신 — 페이지가 활성일 때만
  useEffect(() => {
    if (!isActive) return;
    // Only poll if there's an actively-generating dataset (in active-ids), not just any train_count=0 ghost record
    const hasPending = datasets.some((ds) => ds.train_count === 0 && activeIds.has(ds.id)) || activeIds.size > 0;
    if (!hasPending) return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [isActive, datasets, activeIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 데이터셋 이름 자동 생성: "{파일명(확장자 제외)}_{유형}_학습데이터" ───────
  const toSafeName = (filename: string, dataType: string = form.data_type): string => {
    const stem = filename.replace(/\.[^/.]+$/, "");
    const kind = DATA_TYPE_LABEL[dataType] ?? "QA";
    return `${stem}_${kind}_학습데이터`;
  };

  // 사용자가 직접 수정하지 않은 자동 생성 이름인지 판정
  // (구버전 호환: "_학습데이터"만 붙은 형태도 자동으로 간주)
  const isAutoName = (name: string, filename: string): boolean => {
    const stem = filename.replace(/\.[^/.]+$/, "");
    if (name === `${stem}_학습데이터`) return true; // legacy
    const knownLabels = Object.values(DATA_TYPE_LABEL);
    return knownLabels.some((k) => name === `${stem}_${k}_학습데이터`);
  };

  // ── 문서 선택 → 이름 자동 완성 ───────────────────
  const handleDocumentChange = (docId: string) => {
    const doc = documents.find((d) => String(d.id) === docId);
    const autoName = doc ? toSafeName(doc.filename) : "";
    setForm({ ...form, document_id: docId, dataset_name: autoName });
  };

  // ── 데이터 유형 변경 → 자동 이름 갱신(사용자가 수정 안 한 경우만) ─────
  const handleDataTypeChange = (newType: string) => {
    const doc = documents.find((d) => String(d.id) === form.document_id);
    let newName = form.dataset_name;
    if (doc && (newName === "" || isAutoName(newName, doc.filename))) {
      newName = toSafeName(doc.filename, newType);
    }
    setForm({ ...form, data_type: newType, dataset_name: newName });
    resetPrompts();
  };

  // ── 생성 시작 ─────────────────────────────────────
  const handleGenerate = async () => {
    if (!form.document_id) return;
    setGenerating(true);
    setError(null);
    try {
      const doc = documents.find((d) => String(d.id) === form.document_id);
      emitPipelineEvent({ kind: "start", label: "⚙️ 학습데이터 생성 시작", detail: `${form.data_type.toUpperCase()} ${form.num_pairs}쌍 — ${doc?.filename ?? ""}` });
      const name = form.dataset_name.trim() || (doc ? toSafeName(doc.filename) : `dataset_${Date.now()}`);
      const safeNumPairs = Math.max(1, form.num_pairs);
      const safeTrainRatio = Math.max(0.5, Math.min(0.99, form.train_ratio));

      // 커스텀 프롬프트가 없으면 한국어 기본 프롬프트를 사용 (백엔드 영어 기본값 방지)
      const finalSystem = systemPrompt.trim() || defaultSystem;
      const finalUser = userPromptTemplate.trim() || defaultUser;

      const commonPayload = {
        document_id: Number(form.document_id),
        num_pairs: safeNumPairs,
        dataset_name: name,
        train_ratio: safeTrainRatio,
        llm_provider: form.llm_provider || undefined,
        system_prompt: finalSystem,
        user_prompt_template: finalUser,
      };

      let ds;
      if (form.data_type === "sft") {
        ds = await trainingDataApi.generateSFT(commonPayload);
      } else if (form.data_type === "cot") {
        ds = await trainingDataApi.generateCoT(commonPayload);
      } else if (form.data_type === "tot") {
        ds = await trainingDataApi.generateToT(commonPayload);
      } else if (form.data_type === "got") {
        ds = await trainingDataApi.generateGoT(commonPayload);
      } else {
        // DPO: llm_provider 미지원 (백엔드 스키마와 일관성 유지)
        const { llm_provider, ...dpoPayload } = commonPayload;
        ds = await trainingDataApi.generateDPO(dpoPayload);
      }
      await load();
      subscribeProgress(ds.data.id);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: unknown } } };
      setError(err.response?.data?.detail ? JSON.stringify(err.response.data.detail) : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploading(true);
    try {
      await trainingDataApi.upload(uploadFile, uploadFile.name.replace(".jsonl", ""), 0.9);
      setUploadFile(null);
      load();
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setUploading(false);
    }
  };

  const handlePreviewOpen = async (ds: typeof datasets[0]) => {
    setPreviewModal({
      id: ds.id,
      name: ds.name,
      trainCount: ds.train_count,
      testCount: ds.test_count,
      trainSamples: previewCacheRef.current[ds.id]?.trainSamples ?? [],
      testSamples: previewCacheRef.current[ds.id]?.testSamples ?? [],
      activeSplit: "train",
      loading: !previewCacheRef.current[ds.id],
    });
    if (previewCacheRef.current[ds.id]) return;
    try {
      const res = await trainingDataApi.previewBoth(ds.id, 10, 1500);
      const samples = {
        trainSamples: res.data.train_samples ?? [],
        testSamples: res.data.test_samples ?? [],
      };
      previewCacheRef.current[ds.id] = samples;
      setPreviewModal((current) => current?.id === ds.id ? {
        ...current,
        ...samples,
        loading: false,
      } : current);
    } catch (e) {
      console.error(e);
      setPreviewModal((current) => current?.id === ds.id ? {
        ...current,
        loading: false,
        error: "미리보기를 불러올 수 없습니다.",
      } : current);
    }
  };

  const handleCancelGeneration = async (id: number) => {
    if (esRefs.current[id]) {
      esRefs.current[id].close();
      delete esRefs.current[id];
    }
    if (generatingId === id) { setGeneratingId(null); setGenerating(false); }
    setProgressMap((prev) => { const n = { ...prev }; delete n[id]; return n; });
    await trainingDataApi.cancel(id).catch(() => {});
    load();
  };

  const handleDelete = async (id: number) => {
    if (esRefs.current[id]) {
      esRefs.current[id].close();
      delete esRefs.current[id];
    }
    if (generatingId === id) { setGeneratingId(null); setGenerating(false); }
    setProgressMap((prev) => { const n = { ...prev }; delete n[id]; return n; });
    if (previewModal?.id === id) setPreviewModal(null);
    delete previewCacheRef.current[id];
    // Optimistic update — UI에서 즉시 제거. 백엔드 요청은 백그라운드로 보내고, 실패 시에만 복원.
    setDatasets((prev) => prev.filter((d) => d.id !== id));
    void trainingDataApi.delete(id).catch((e) => {
      setError(`삭제 실패: ${String(e)}`);
      load();
    });
  };

  const handleDeleteAll = async () => {
    Object.values(esRefs.current).forEach((es) => es.close());
    esRefs.current = {};
    setGeneratingId(null);
    setProgressMap({});
    setPreviewModal(null);
    setConfirmDeleteAll(false);
    // Optimistic update — 즉시 목록 비우기. 백엔드 요청은 백그라운드.
    setDatasets([]);
    void trainingDataApi.deleteAll().catch((e) => {
      setError(`삭제 실패: ${String(e)}`);
      load();
    });
  };

  const activeSamples = previewModal
    ? (previewModal.activeSplit === "train" ? previewModal.trainSamples : previewModal.testSamples)
    : [];

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">

      {/* ── 미리보기 모달 ── */}
      {previewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setPreviewModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col mx-4" onClick={(e) => e.stopPropagation()}>
            {/* 헤더 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <p className="text-sm font-bold text-gray-900">{previewModal.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">학습데이터 미리보기 (상위 10개 샘플)</p>
              </div>
              <button onClick={() => setPreviewModal(null)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            {/* 탭 */}
            <div className="flex gap-2 px-5 pt-3 pb-0">
              <button
                onClick={() => setPreviewModal((p) => p ? { ...p, activeSplit: "train" } : null)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${previewModal.activeSplit === "train" ? "bg-blue-100 text-blue-700" : "text-gray-400 hover:bg-gray-100"}`}
              >
                훈련 ({previewModal.trainCount}개)
              </button>
              <button
                onClick={() => setPreviewModal((p) => p ? { ...p, activeSplit: "test" } : null)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${previewModal.activeSplit === "test" ? "bg-emerald-100 text-emerald-700" : "text-gray-400 hover:bg-gray-100"}`}
              >
                테스트 ({previewModal.testCount}개)
              </button>
            </div>
            {/* 샘플 목록 */}
            <div className="overflow-y-auto flex-1 px-5 py-3 space-y-2">
              {previewModal.loading ? (
                <div className="flex items-center justify-center gap-2 text-xs text-blue-600 py-8">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  샘플을 불러오는 중...
                </div>
              ) : previewModal.error ? (
                <p className="text-xs text-red-500 text-center py-6">{previewModal.error}</p>
              ) : activeSamples.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-6">샘플 없음</p>
              ) : (
                activeSamples.map((s, i) => (
                  <pre key={i} className="text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-auto max-h-48 leading-relaxed whitespace-pre-wrap break-all">
                    {JSON.stringify(s, null, 2)}
                  </pre>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="w-7 h-7 rounded-md bg-blue-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">2</span>
          <Database className="w-5 h-5 text-blue-600 flex-shrink-0" />
          <div>
            <div className="flex items-center gap-1"><h1 className="text-xl font-bold text-gray-900">학습데이터 생성</h1><PageHelp pageKey="dataGeneration" /></div>
            <p className="text-xs text-gray-500">AI로 질문-답변 학습 데이터를 자동 생성</p>
          </div>
        </div>
        <button onClick={load} className="p-2 hover:bg-gray-100 rounded-lg">
          <RefreshCw className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      {agentPreparing && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-3 flex items-center gap-3">
          <Loader2 className="w-4 h-4 text-blue-600 animate-spin flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-blue-800">NELLA가 {agentPreparing.label} 단계를 시작하고 있습니다.</p>
            <p className="text-xs text-blue-600 mt-0.5">데이터셋이 생성되면 이 화면에 진행률이 자동으로 표시됩니다.</p>
          </div>
        </div>
      )}

      {/* ── 데이터 소스 통합 카드 ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        {/* 소스 선택 탭 */}
        <div>
          <label className="text-xs font-medium text-gray-600">데이터 소스</label>
          <div className="mt-1.5 flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
            <button
              onClick={() => setDataSource("document")}
              className={`flex-1 py-2 transition-colors ${
                dataSource === "document" ? "bg-blue-600 text-white" : "text-gray-500 hover:bg-gray-50"
              }`}
            >
              📄 추출된 문서에서 생성
            </button>
            <button
              onClick={() => setDataSource("jsonl")}
              className={`flex-1 py-2 border-l border-gray-200 transition-colors ${
                dataSource === "jsonl" ? "bg-purple-600 text-white" : "text-gray-500 hover:bg-gray-50"
              }`}
            >
              📤 JSONL 파일 업로드
            </button>
          </div>
        </div>

        {/* 문서에서 생성 */}
        {dataSource === "document" && (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-600">추출 완료된 문서</label>
              <select
                value={form.document_id}
                onChange={(e) => handleDocumentChange(e.target.value)}
                className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">문서 선택...</option>
                {documents.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.filename}
                    {d.word_count ? ` (${d.word_count.toLocaleString()}단어)` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">데이터 유형</label>
              <select
                value={form.data_type}
                onChange={(e) => handleDataTypeChange(e.target.value)}
                className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
              >
                <option value="sft">QA — 단순 질문/답변</option>
                <option value="cot">CoT — Chain-of-Thought (단계 추론)</option>
                <option value="tot">ToT — Tree-of-Thought (다중 경로)</option>
                <option value="got">GoT — Graph-of-Thought (그래프 추론)</option>
                <option value="dpo">DPO — 선호도 쌍</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600">생성 쌍 수</label>
                <input
                  type="number" value={form.num_pairs} min={1}
                  onChange={(e) => setForm({ ...form, num_pairs: Number(e.target.value) })}
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">
                  훈련:테스트 비율
                  <span className="ml-1.5 text-gray-400 font-normal">
                    ({Math.round(form.train_ratio * 100)}:{Math.round((1 - form.train_ratio) * 100)})
                  </span>
                </label>
                <input
                  type="number" value={form.train_ratio} min={0.5} max={0.99} step={0.05}
                  onChange={(e) => setForm({ ...form, train_ratio: Number(e.target.value) })}
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">
                데이터셋 이름
                <span className="ml-1 text-gray-400 font-normal">(자동 완성, 수정 가능)</span>
              </label>
              <input
                type="text"
                value={form.dataset_name}
                placeholder="문서 선택 시 자동 입력"
                onChange={(e) => setForm({ ...form, dataset_name: e.target.value })}
                className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">LLM 제공자</label>
              <select
                value={form.llm_provider}
                onChange={(e) => setForm({ ...form, llm_provider: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">기본값</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="ollama">Ollama</option>
                <option value="mock">Mock (테스트)</option>
              </select>
            </div>
            {/* 프롬프트 편집기 */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setShowPrompt((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 text-xs font-medium text-gray-600 transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-gray-400" />
                  LLM 프롬프트 설정
                  {isPromptCustomized && (
                    <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-medium">수정됨</span>
                  )}
                </span>
                {showPrompt ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
              </button>
              {showPrompt && (
                <div className="p-3 space-y-3 bg-white">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500">
                      비워두면 기본 프롬프트 사용. <code className="bg-gray-100 px-1 rounded">{"{text}"}</code> · <code className="bg-gray-100 px-1 rounded">{"{num_pairs}"}</code> 치환자 사용 가능.
                    </p>
                    {isPromptCustomized && (
                      <button
                        onClick={resetPrompts}
                        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
                      >
                        <RotateCcw className="w-3 h-3" />초기화
                      </button>
                    )}
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">
                      시스템 프롬프트
                      <span className="text-gray-400 font-normal ml-1">(역할 지시)</span>
                    </label>
                    <textarea
                      value={systemPrompt || defaultSystem}
                      onChange={(e) => setSystemPrompt(e.target.value === defaultSystem ? "" : e.target.value)}
                      rows={4}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono resize-y focus:ring-1 focus:ring-blue-400 focus:outline-none leading-relaxed"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">
                      사용자 프롬프트 템플릿
                      <span className="text-gray-400 font-normal ml-1">(문서 텍스트·개수 지시)</span>
                    </label>
                    <textarea
                      value={userPromptTemplate || defaultUser}
                      onChange={(e) => setUserPromptTemplate(e.target.value === defaultUser ? "" : e.target.value)}
                      rows={8}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono resize-y focus:ring-1 focus:ring-blue-400 focus:outline-none leading-relaxed"
                    />
                  </div>
                </div>
              )}
            </div>
            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
            {generating && generatingId ? (
              <div className="flex gap-2">
                <div className="flex-1 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium flex items-center justify-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin"/>생성 중...
                </div>
                <button
                  onClick={() => handleCancelGeneration(generatingId)}
                  className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 flex items-center gap-1.5"
                >
                  <StopCircle className="w-3.5 h-3.5"/>중단
                </button>
              </div>
            ) : (
              <button
                onClick={handleGenerate}
                disabled={generating || !form.document_id}
                className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                학습데이터 생성
              </button>
            )}
          </div>
        )}

        {/* JSONL 업로드 */}
        {dataSource === "jsonl" && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">SFT 또는 DPO 형식의 JSONL 파일을 직접 업로드합니다 (한 줄에 JSON 객체 1개)</p>
            <label className="flex items-center gap-3 cursor-pointer border-2 border-dashed border-gray-200 rounded-lg px-4 py-4 hover:border-purple-300 hover:bg-purple-50/20 transition-colors">
              <FileJson className="w-5 h-5 text-gray-400 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm text-gray-600 truncate">{uploadFile ? uploadFile.name : "JSONL 파일 선택..."}</p>
                {uploadFile && <p className="text-xs text-gray-400">{(uploadFile.size / 1024).toFixed(1)} KB</p>}
              </div>
              <input
                type="file"
                accept=".jsonl"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                className="hidden"
              />
            </label>
            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
            {uploadFile ? (
              <div className="flex gap-2">
                <button
                  onClick={() => setUploadFile(null)}
                  className="px-3 py-2 border border-gray-200 text-gray-500 rounded-lg text-sm hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {uploading ? "업로드 중..." : "데이터셋 업로드"}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* ── 처리 대기열: 대기 중인 것만 ── */}
      {(() => {
        const queuedDatasets = datasets.filter((ds) => {
          const progress = progressMap[ds.id];
          if (progress?.done) return false;
          const isActive = generatingId === ds.id || activeIds.has(ds.id) || !!progress;
          return isActive && (!progress || progress.message.includes("대기 중"));
        });
        if (queuedDatasets.length === 0) return null;
        return (
          <div className="bg-white rounded-xl border border-yellow-200">
            <div className="px-5 py-3 border-b border-yellow-100 flex items-center gap-2">
              <ListOrdered className="w-4 h-4 text-yellow-600" />
              <h2 className="text-sm font-semibold text-yellow-800">처리 대기열 ({queuedDatasets.length}개)</h2>
              <span className="text-xs text-yellow-600 ml-1">— 현재 처리 완료 후 순서대로 진행됩니다</span>
            </div>
            <div className="divide-y divide-yellow-50">
              {queuedDatasets.map((ds, idx) => {
                const progress = progressMap[ds.id];
                return (
                  <div key={ds.id} className="px-5 py-2.5 flex items-center gap-3 bg-yellow-50/40">
                    <span className="text-xs font-bold text-yellow-500 w-5 text-center">{idx + 1}</span>
                    <Database className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs font-medium text-gray-700 truncate">{ds.name}</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${dataTypeBadge(ds.data_type)}`}>{dataTypeLabel(ds.data_type)}</span>
                      </div>
                      {progress && (
                        <p className="mt-0.5 text-xs text-amber-600 flex items-center gap-1">
                          <Clock className="w-3 h-3 flex-shrink-0" />{progress.message}
                        </p>
                      )}
                    </div>
                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded font-medium flex-shrink-0">
                      <Clock className="w-3 h-3" />대기 중
                    </span>
                    <button onClick={() => handleDelete(ds.id)} className="p-1.5 hover:bg-yellow-200 rounded flex-shrink-0" title="취소 및 삭제">
                      <X className="w-3.5 h-3.5 text-yellow-600" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── 데이터셋 목록 (생성 중 포함) ── */}
      {(() => {
        const isQueued = (ds: Dataset) => {
          const progress = progressMap[ds.id];
          if (progress?.done) return false;
          const isActive = generatingId === ds.id || activeIds.has(ds.id) || !!progress;
          return isActive && (!progress || progress.message.includes("대기 중"));
        };
        const listDatasets = datasets.filter((ds) => !isQueued(ds));
        return (
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">데이터셋 목록 ({listDatasets.length})</h2>
          <div className="flex items-center gap-2">
            {datasets.length > 0 && (
              confirmDeleteAll ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-red-600 font-medium">{datasets.length}개 모두 삭제?</span>
                  <button
                    onClick={handleDeleteAll}
                    className="px-2 py-0.5 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded transition-colors"
                  >
                    확인
                  </button>
                  <button
                    onClick={() => setConfirmDeleteAll(false)}
                    className="px-2 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded transition-colors"
                  >
                    취소
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDeleteAll(true)}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-50 rounded-lg border border-red-200 hover:border-red-300 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />전체 삭제
                </button>
              )
            )}
          </div>
        </div>

        {listDatasets.length === 0 ? (
          <div className="p-8 text-center">
            <Database className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <p className="text-gray-400 text-sm">생성된 데이터셋 없음</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {listDatasets.map((ds) => {
              const progress = progressMap[ds.id];
              const isActive = !progress?.done && (generatingId === ds.id || activeIds.has(ds.id) || !!progress);
              const isRunning = isActive && !!progress && !progress.message.includes("대기 중");
              const isDone = !isActive && ds.train_count > 0;

              return (
                <div key={ds.id} className={isRunning ? "bg-blue-50/20" : ""}>
                  <div className="flex items-start gap-3 px-5 py-3 hover:bg-gray-50">
                    <Database className={`w-5 h-5 flex-shrink-0 mt-0.5 ${isRunning ? "text-blue-400" : "text-purple-400"}`} />
                    <div className="flex-1 min-w-0">
                      {/* 이름 + 타입 배지 */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-gray-800 truncate">{ds.name}</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${dataTypeBadge(ds.data_type)}`}>
                          {dataTypeLabel(ds.data_type)}
                        </span>
                      </div>
                      {/* 통계 */}
                      {isDone && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          훈련 {ds.train_count}개 · 테스트 {ds.test_count}개
                          {ds.llm_provider && (
                            <span className="ml-1.5 px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs font-mono">
                              {ds.llm_provider}
                            </span>
                          )}
                          {" · "}{formatDate(ds.created_at)}
                        </p>
                      )}
                      {isRunning && (
                        <p className="text-xs text-gray-400 mt-0.5">{formatDate(ds.created_at)}</p>
                      )}
                      {/* 파일 경로 */}
                      {isDone && (ds.train_path || ds.test_path) && (
                        <div className="mt-1.5 space-y-0.5">
                          {ds.train_path && (
                            <p className="flex items-center gap-1.5 text-xs text-blue-600 font-mono">
                              <FileJson className="w-3 h-3 flex-shrink-0" />
                              <span className="truncate" title={ds.train_path}>
                                {ds.train_path.split("/").slice(-2).join("/")}
                              </span>
                              <span className="text-gray-400 flex-shrink-0">({ds.train_count}개)</span>
                            </p>
                          )}
                          {ds.test_path && (
                            <p className="flex items-center gap-1.5 text-xs text-emerald-600 font-mono">
                              <FileJson className="w-3 h-3 flex-shrink-0" />
                              <span className="truncate" title={ds.test_path}>
                                {ds.test_path.split("/").slice(-2).join("/")}
                              </span>
                              <span className="text-gray-400 flex-shrink-0">({ds.test_count}개)</span>
                            </p>
                          )}
                        </div>
                      )}
                      {/* 생성 중 진행 바 */}
                      {isRunning && progress && !progress.done && (
                        <ProgressBar progress={progress} />
                      )}
                      {/* 에러 */}
                      {progress?.error && (
                        <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />{progress.message}
                        </p>
                      )}
                    </div>

                    {/* 오른쪽 액션 */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {isRunning && (
                        <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded font-medium">
                          <Loader2 className="w-3 h-3 animate-spin" />생성 중
                        </span>
                      )}
                      {isDone && (
                        <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-green-50 text-green-600 rounded font-medium">
                          <CheckCircle className="w-3 h-3" />완료
                        </span>
                      )}

                      {/* 미리보기 */}
                      <button
                        onClick={() => isDone && handlePreviewOpen(ds)}
                        disabled={!isDone}
                        className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        title={isDone ? "샘플 미리보기" : "생성 완료 후 사용 가능"}
                      >
                        <Eye className="w-3.5 h-3.5" />
                        미리보기
                      </button>

                      {/* 데이터 검증 */}
                      <button
                        onClick={() => navigate("/data-validation")}
                        disabled={!isDone}
                        className="p-1.5 rounded hover:bg-blue-100 disabled:opacity-30 disabled:cursor-not-allowed"
                        title={isDone ? "학습데이터 검증" : "생성 완료 후 사용 가능"}
                      >
                        <ClipboardCheck className="w-4 h-4 text-blue-400" />
                      </button>

                      {/* 생성 중 중단 버튼 */}
                      {isRunning && (
                        <button
                          onClick={() => handleCancelGeneration(ds.id)}
                          className="p-1.5 rounded hover:bg-red-100 text-red-400 hover:text-red-600"
                          title="생성 중단"
                        >
                          <StopCircle className="w-4 h-4" />
                        </button>
                      )}
                      {/* 삭제 */}
                      <button
                        onClick={() => setConfirmDelete(ds)}
                        className="p-1.5 rounded hover:bg-red-100 text-gray-400 hover:text-red-500"
                        title="삭제"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
        );
      })()}

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-5 h-5 text-red-500"/>
              <h3 className="text-base font-semibold text-gray-900">데이터셋 삭제</h3>
            </div>
            <p className="text-sm text-gray-600 mb-2">
              <span className="font-medium">{confirmDelete.name}</span> 데이터셋을 삭제하시겠습니까?
            </p>
            <p className="text-xs text-gray-400 mb-6">생성 중이면 취소 후 삭제됩니다. 되돌릴 수 없습니다.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">취소</button>
              <button
                onClick={() => { const id = confirmDelete.id; setConfirmDelete(null); handleDelete(id); }}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700"
              >삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DataGeneration;
