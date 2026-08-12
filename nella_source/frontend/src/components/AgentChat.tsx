/**
 * AgentChat — MCP-enabled right-side persistent chat panel.
 * - 좌측 드래그 핸들로 패널 폭 조절
 * - 상단: 에이전트 터미널 (도구 호출 / 결과 실시간 표시)
 * - 하단: 사용자 대화창
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bot, User, Send, Loader, ChevronRight, RotateCcw, Terminal, GripVertical, CheckCircle, XCircle, Square, Trash2, RefreshCw, Paperclip, X as XIcon, ExternalLink, Copy, Check, FileText, Settings, ChevronUp, ChevronDown } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { chatApi, api, trainingApi, modelsApi, documentsApi, agentMessagesApi, settingsApi } from "../services/api";
import { emitDocumentUploadEvent, emitPipelineEvent, subscribePipelineEvents, subscribeLlmSettingsChanged, emitLlmSettingsChanged } from "../pipelineEvent";
import { useProviderModels } from "../hooks/useProviderModels";
import imgWorking    from "../assets/Figures/states/working.png";
import imgResting    from "../assets/Figures/states/resting.png";
import imgDozing     from "../assets/Figures/states/dozing.png";
import imgMakingData from "../assets/Figures/states/making_data.png";
import imgTraining   from "../assets/Figures/states/training.png";
import imgEvaluating from "../assets/Figures/states/evaluating.png";
import imgMonitoring from "../assets/Figures/states/monitoring.png";
import imgChatting   from "../assets/Figures/states/chatting.png";
import imgThinking   from "../assets/Figures/states/thinking.png";
import imgStruggling from "../assets/Figures/states/struggling.png";
import imgHappy      from "../assets/Figures/states/happy.png";
import imgCelebrating from "../assets/Figures/states/celebrating.png";

const STATE_IMAGES: Record<string, string> = {
  working: imgWorking, resting: imgResting, dozing: imgDozing,
  making_data: imgMakingData, training: imgTraining, evaluating: imgEvaluating,
  monitoring: imgMonitoring, chatting: imgChatting, thinking: imgThinking,
  struggling: imgStruggling, happy: imgHappy, celebrating: imgCelebrating,
};

type ProviderMode = "anthropic" | "openai" | "ollama" | "local";

// 도구 → 자동 이동 페이지
const TOOL_PAGE_MAP: Record<string, string> = {
  generate_sft_data:    "/data",
  generate_dpo_data:    "/data",
  wait_for_dataset:     "/data",
  filter_dataset:       "/data-validation",
  validate_training_data: "/data-validation",
  download_model:       "/models",
  download_compatible_models: "/models",
  run_model_validation: "/model-validation",
  start_training_job:   "/training",
  wait_for_training_job: "/training-results",
  wait_for_training: "/training-results",
  start_autoresearch:   "/training",
  wait_for_autoresearch: "/training-results",
  run_evaluation:       "/evaluation",
  wait_for_evaluation:  "/evaluation",
  test_model_chat:      "/chat",
};

interface ToolCallDetail {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

interface TerminalEntry {
  type: "call" | "result" | "nav" | "info" | "error" | "event" | "boot" | "skill" | "monitor";
  text: string;
  ts: Date;
  step?: number;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  ts: Date;
  elapsedMs?: number;       // 처리 소요시간 (ms)
  toolCalls?: ToolCallDetail[];
  isPlan?: boolean;
  isStepConfirm?: boolean;
  approved?: boolean;
  navigateTo?: string;      // 이 메시지와 연관된 페이지 (즉시 이동에 사용)
  isTrainingWait?: boolean; // 훈련 진행 중 — 폴링 대기 상태
  trainingWaitJobId?: number;
  trainingWaitTool?: string; // wait_for_training_job 또는 wait_for_autoresearch
  isDownloadWait?: boolean;  // 모델 다운로드 진행 중 — 완료 후 자동 plan 요청
  downloadWaitModelIds?: string[];
}

interface BackgroundWaitState {
  kind: "download" | "training";
  label: string;
  startedAt: number;
  jobId?: number;
  waitTool?: string;
}

interface ProviderInfo {
  openai: boolean;
  anthropic: boolean;
  ollama: boolean;
  default: string;
  openai_model: string;
  anthropic_model: string;
  ollama_model: string;
}

const PROVIDER_LABELS: Record<ProviderMode, string> = {
  anthropic: "Claude",
  openai: "OpenAI",
  ollama: "Ollama",
  local: "로컬",
};


const PAGE_LABELS: Record<string, string> = {
  "/": "대시보드", "/documents": "문서 업로드", "/data": "학습데이터 생성",
  "/data-validation": "데이터 검증", "/models": "기반모델 선택",
  "/model-validation": "모델 검증", "/training": "모델 훈련",
  "/training-results": "훈련결과", "/evaluation": "평가",
  "/chat": "대화 테스트", "/llm-settings": "LLM 설정", "/settings": "시스템 설정",
};

const STEP_PAGE_MAP: Record<number, string> = {
  1: "/documents",
  2: "/data",
  3: "/data-validation",
  4: "/models",
  5: "/model-validation",
  6: "/training",
  7: "/training-results",
  8: "/evaluation",
  9: "/chat",
};

const STEP_CONFIG: Record<number, { icon: string; name: string; color: string; bgColor: string }> = {
  1: { icon: "📄", name: "문서 업로드",     color: "text-orange-300",  bgColor: "bg-orange-900/30" },
  2: { icon: "⚙️", name: "학습데이터 생성", color: "text-yellow-300",  bgColor: "bg-yellow-900/30" },
  3: { icon: "🛡️", name: "데이터 검증",    color: "text-lime-300",    bgColor: "bg-lime-900/30" },
  4: { icon: "🖥️", name: "기반모델 선택",  color: "text-emerald-300", bgColor: "bg-emerald-900/30" },
  5: { icon: "🧪", name: "모델 검증",      color: "text-teal-300",    bgColor: "bg-teal-900/30" },
  6: { icon: "🏋️", name: "모델 훈련",     color: "text-sky-300",     bgColor: "bg-sky-900/30" },
  7: { icon: "🏆", name: "훈련결과",       color: "text-blue-300",    bgColor: "bg-blue-900/30" },
  8: { icon: "📊", name: "모델 평가",      color: "text-violet-300",  bgColor: "bg-violet-900/30" },
  9: { icon: "💬", name: "대화 테스트",    color: "text-pink-300",    bgColor: "bg-pink-900/30" },
};

const TOOL_STEP_MAP: Record<string, number> = {
  // 1단계 — 문서 업로드
  list_documents: 1, find_document: 1, get_document_status: 1, get_document_text: 1,
  reprocess_document: 1, wait_for_document: 1, delete_document: 1, delete_all_documents: 1,
  // 2단계 — 학습데이터 생성
  generate_sft_data: 2, generate_dpo_data: 2, get_datasets: 2, get_dataset_status: 2,
  cancel_dataset: 2, delete_dataset: 2, delete_all_datasets: 2, wait_for_dataset: 2,
  // 3단계 — 데이터 검증
  preview_dataset: 3, filter_dataset: 3, validate_training_data: 3, search_training_data: 3,
  // 4단계 — 기반모델 선택
  get_models: 4, download_model: 4, download_compatible_models: 4, wait_for_model_download: 4,
  cancel_model_download: 4, delete_model: 4,
  // 5단계 — 모델 검증
  run_model_validation: 5, test_llm_connection: 5,
  // 6단계 — 모델 훈련
  start_training_job: 6, start_autoresearch: 6,
  cancel_training_job: 6, cancel_autoresearch: 6,
  // 7단계 — 훈련결과
  get_training_job_status: 7, wait_for_training_job: 7, wait_for_training: 7,
  wait_for_autoresearch: 7, merge_adapter: 7, wait_for_merge: 7,
  delete_training_job: 7, delete_all_training_jobs: 7,
  delete_autoresearch_job: 7, delete_all_autoresearch_jobs: 7,
  // 8단계 — 모델 평가
  run_evaluation: 8, wait_for_evaluation: 8, get_evaluation_report: 8,
  cancel_evaluation: 8, delete_evaluation: 8, delete_all_evaluations: 8,
  // 9단계 — 대화 테스트
  test_model_chat: 9,
};

const STEP_TOOL_COUNTS: Record<number, number> = { 1:8, 2:8, 3:4, 4:6, 5:2, 6:4, 7:10, 8:6, 9:1 };

const TOOL_ICONS: Record<string, string> = {
  get_pipeline_status: "🗺️", get_autoresearch_job_status: "🔬",
  get_system_overview: "📊", get_training_jobs: "🏋️", get_datasets: "📂",
  get_models: "🤖", get_evaluation_results: "📈", search_training_data: "🔍",
  start_training_job: "🚀", get_training_job_status: "⏳", test_model_chat: "💬",
  test_llm_connection: "🔌", navigate_to_page: "🧭",
  list_documents: "📄", find_document: "🔎", generate_sft_data: "⚙️", generate_dpo_data: "⚙️",
  preview_dataset: "👁️", filter_dataset: "🧹", validate_training_data: "🛡️", wait_for_training_job: "⌛",
  run_model_validation: "🧪",
  run_evaluation: "📏", get_evaluation_report: "📋", get_system_info: "🖥️",
  download_model: "⬇️", download_compatible_models: "🧠", start_autoresearch: "🔬", wait_for_autoresearch: "⌛",
  wait_for_training: "⌛",
};

const LOADING_STAGES = [
  "📡 파이프라인 현황 스캔",
  "⚙️  스킬 로딩 중",
  "🔧 도구 실행 중",
  "📊 결과 분석 중",
];

const DEFAULT_WIDTH = 340;
const MIN_WIDTH = 260;
const MAX_WIDTH = 680;
const DEFAULT_TERMINAL_H = 200;
const MIN_TERMINAL_H = 60;
const MIN_CHAT_H = 160;
const DEFAULT_INPUT_H = 180;
const MIN_INPUT_H = 80;
const MIN_MSGS_H = 80;

const LS_MESSAGES  = "nela_chat_messages";
const LS_TERMINAL  = "nela_chat_terminal";
const LS_WIDTH     = "nela_panel_width";
const LS_TERM_H    = "nela_terminal_h";
const LS_INPUT_H   = "nela_chat_input_h";
const LS_TERM_OPEN = "nela_terminal_open";
const SS_AGENT_ACTIVE_PAGE = "nella.agent.activePage";
const SS_AGENT_PENDING_DOWNLOADS = "nella.agent.pendingDownloads";
const SS_AGENT_WATCH_DOWNLOADS = "nella.agent.watchDownloads";
const SS_AGENT_WATCH_TRAINING = "nella.agent.watchTraining";
const AGENT_DOWNLOAD_STARTED_EVENT = "nella-agent-download-started";
const AGENT_DOWNLOAD_COMPLETED_EVENT = "nella-agent-download-completed";

const CHAT_SESSION = "default";

function announceAgentPageStart(page: string, label: string) {
  const payload = { page, label, ts: Date.now() };
  window.sessionStorage.setItem(SS_AGENT_ACTIVE_PAGE, JSON.stringify(payload));
  window.dispatchEvent(new CustomEvent("nella-agent-page-start", { detail: payload }));
}

function rememberAgentDownloads(name: string, args: Record<string, unknown>, result: Record<string, unknown>) {
  const downloads: Array<{ model_id: string; name?: string; ts: number }> = [];
  if (name === "download_model" && (result.status === "downloading" || result.status === "started")) {
    const modelId = String(result.model_id ?? args.model_id ?? "");
    if (modelId) downloads.push({ model_id: modelId, name: modelId.split("/").pop(), ts: Date.now() });
  }
  if (name === "download_compatible_models" && Array.isArray(result.downloads)) {
    for (const item of result.downloads as Array<Record<string, unknown>>) {
      const modelId = String(item.model_id ?? "");
      if (modelId) downloads.push({ model_id: modelId, name: String(item.name ?? modelId.split("/").pop()), ts: Date.now() });
    }
  }
  if (downloads.length === 0) return;
  try {
    const existing = JSON.parse(window.sessionStorage.getItem(SS_AGENT_PENDING_DOWNLOADS) || "[]") as Array<{ model_id: string; name?: string; ts: number }>;
    const byId = new Map(existing.map((item) => [item.model_id, item]));
    downloads.forEach((item) => byId.set(item.model_id, item));
    window.sessionStorage.setItem(SS_AGENT_PENDING_DOWNLOADS, JSON.stringify(Array.from(byId.values())));
  } catch {
    window.sessionStorage.setItem(SS_AGENT_PENDING_DOWNLOADS, JSON.stringify(downloads));
  }
  try {
    const existing = JSON.parse(window.sessionStorage.getItem(SS_AGENT_WATCH_DOWNLOADS) || "[]") as Array<{ model_id: string; name?: string; ts: number }>;
    const byId = new Map(existing.map((item) => [item.model_id, item]));
    downloads.forEach((item) => byId.set(item.model_id, item));
    window.sessionStorage.setItem(SS_AGENT_WATCH_DOWNLOADS, JSON.stringify(Array.from(byId.values())));
  } catch {
    window.sessionStorage.setItem(SS_AGENT_WATCH_DOWNLOADS, JSON.stringify(downloads));
  }
  for (const item of downloads) {
    window.dispatchEvent(new CustomEvent(AGENT_DOWNLOAD_STARTED_EVENT, { detail: item }));
  }
}

function loadTerminal(): TerminalEntry[] {
  try {
    const raw = localStorage.getItem(LS_TERMINAL);
    if (!raw) return [];
    return (JSON.parse(raw) as Array<TerminalEntry & { ts: string }>).map(e => ({
      ...e, ts: new Date(e.ts),
    }));
  } catch { return []; }
}

interface AgentChatProps {
  collapsed: boolean;
  onToggle: () => void;
}

const AgentChat: React.FC<AgentChatProps> = ({ collapsed, onToggle }) => {
  const location = useLocation();
  const navigate = useNavigate();

  // Panel width (drag-to-resize)
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const v = localStorage.getItem(LS_WIDTH);
    return v ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Number(v))) : DEFAULT_WIDTH;
  });
  const isResizingPanel = useRef(false);

  // Terminal / chat vertical split
  const [terminalH, setTerminalH] = useState<number>(() => {
    const v = localStorage.getItem(LS_TERM_H);
    return v ? Math.max(MIN_TERMINAL_H, Number(v)) : DEFAULT_TERMINAL_H;
  });
  const isResizingTerminal = useRef(false);

  // Chat input area height (split bar between messages and input)
  const [chatInputH, setChatInputH] = useState<number>(() => {
    const v = localStorage.getItem(LS_INPUT_H);
    return v ? Math.max(MIN_INPUT_H, Number(v)) : DEFAULT_INPUT_H;
  });
  const isResizingInput = useRef(false);

  const panelRef = useRef<HTMLDivElement>(null);

  // Provider / model
  const [providerInfo, setProviderInfo] = useState<ProviderInfo | null>(null);
  const [mode, setMode] = useState<ProviderMode>("anthropic");
  // Live model list for the selected provider (see constants/models.ts).
  const { models: presetModels } = useProviderModels(mode);
  const [providerModel, setProviderModel] = useState("");
  const [localModels, setLocalModels] = useState<Array<{ path: string; name: string }>>([]);
  const [localModelPath, setLocalModelPath] = useState("");
  const [localModelName, setLocalModelName] = useState("");
  const [modelReady, setModelReady] = useState(false);
  const [loadingModel, setLoadingModel] = useState(false);

  // Chat & terminal state — messages loaded from backend DB, terminal starts fresh each session
  const [messages, setMessages] = useState<Message[]>([]);
  const lastSyncedIdRef = useRef<number>(0);  // highest DB id we've already loaded
  const resetInProgressRef = useRef(false);
  const resetVersionRef = useRef(0);
  const [terminalLogs, setTerminalLogs] = useState<TerminalEntry[]>([]);
  // 도구 호출에서 본 dataset id → name 매핑. get_datasets / generate_*_data 결과로 채워진다.
  const datasetNameByIdRef = useRef<Record<number, string>>({});
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendingElapsed, setSendingElapsed] = useState(0);
  const [backgroundWait, setBackgroundWait] = useState<BackgroundWaitState | null>(null);
  const [loadingStageIdx, setLoadingStageIdx] = useState(0);
  const sendingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const downloadPlanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completedAgentDownloadsRef = useRef<Array<{ model_id: string; name?: string }>>([]);
  const sendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  // 자율 실행 모드: 계획 확인 버튼을 누르지 않아도 단계별 실행을 계속 진행
  const [autoExec, setAutoExec] = useState(false);
  // 설정 모달
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [persona, setPersona] = useState(() =>
    localStorage.getItem("nella_persona") ??
    "당신은 NELLA(Nifty-Enhanced LLMOps Agent)입니다. 로컬 LLM 파인튜닝 플랫폼의 전문 AI 어시스턴트로, 사용자가 문서 업로드부터 학습데이터 생성, 모델 다운로드, 파인튜닝, 평가, 대화 테스트까지 전 과정을 안내합니다. 항상 한국어로 답변하고, 전문적이지만 친근한 말투로 소통하세요."
  );
  const [confirmReset, setConfirmReset] = useState(false);
  // 터미널 열기/닫기
  const [terminalOpen, setTerminalOpen] = useState(() => localStorage.getItem(LS_TERM_OPEN) !== "false");

  // ── Document viewer modal ──
  const [docViewer, setDocViewer] = useState<{ docId: number; filename: string } | null>(null);

  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);

  const openDocViewer = useCallback((docId: number, filename: string) => {
    setDocViewer({ docId, filename });
  }, []);

  // ── File upload state ──
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadedDoc, setUploadedDoc] = useState<{ id: number; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recentPipelineEventsRef = useRef<Record<string, number>>({});

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingFile(true);
    setUploadedDoc(null);
    emitPipelineEvent({ kind: "start", label: "📄 문서 업로드", detail: file.name });
    emitDocumentUploadEvent({
      phase: "start",
      filename: file.name,
      fileSize: file.size,
      uploadPercent: 0,
      extractor: "openDataLoader",
    });
    // 채팅에 파일 첨부 시작 메시지 표시
    const uploadStartMsg: Message = {
      role: "user",
      content: `📎 **${file.name}** (${(file.size / 1024 / 1024).toFixed(1)}MB) — 문서 업로드 및 텍스트 추출 중...`,
      ts: new Date(),
    };
    // "업로드 중" 메시지를 로컬 + DB에 즉시 저장 → 다른 브라우저에서도 즉시 보임
    setMessages(prev => [...prev, uploadStartMsg]);
    let dbMsgId: number | null = null;
    agentMessagesApi.add({
      session_id: CHAT_SESSION,
      role: "user",
      content: uploadStartMsg.content,
      metadata: null,
    }).then(res => {
      dbMsgId = res.data.id ?? null;
      lastSyncedIdRef.current = Math.max(lastSyncedIdRef.current, res.data.id ?? 0);
    }).catch(() => {});
    // 문서 업로드 페이지로 이동해 추출 진행상황 표시
    navigate("/documents");
    try {
      // OpenDataLoader를 기본 추출기로 사용
      const { data: uploaded } = await documentsApi.upload(file, "openDataLoader", false, (pct) => {
        emitDocumentUploadEvent({
          phase: "progress",
          filename: file.name,
          fileSize: file.size,
          uploadPercent: pct,
          extractor: "openDataLoader",
        });
      });
      emitPipelineEvent({ kind: "start", label: "📄 텍스트 추출 중", detail: file.name });
      emitDocumentUploadEvent({
        phase: "uploaded",
        filename: file.name,
        fileSize: file.size,
        uploadPercent: 100,
        docId: uploaded.id,
        extractor: "openDataLoader",
      });
      let doc = uploaded;
      for (let i = 0; i < 90; i++) {
        if (doc.status === "completed") break;
        if (doc.status === "failed") throw new Error("처리 실패");
        await new Promise((r) => setTimeout(r, 3000));
        doc = (await documentsApi.get(uploaded.id)).data;
      }
      setUploadedDoc(null);
      const thumbUrl = (doc as { thumbnail_path?: string }).thumbnail_path
        ? `/api/documents/${doc.id}/thumbnail`
        : null;
      const thumbMd = thumbUrl ? `\n\n![thumbnail](${thumbUrl})` : "";
      const completedContent = `📎 **${file.name}** — 업로드 완료 ✅ (${doc.page_count ?? "?"}페이지, ${(doc.word_count ?? 0).toLocaleString()}단어)${thumbMd}\n\n[📄 문서 보기](/doc-view?id=${doc.id}&name=${encodeURIComponent(file.name)})\n\n아래 요청을 전송합니다.`;
      // 로컬 상태 업데이트
      setMessages(prev => prev.map((m, i) =>
        i === prev.length - 1 && m.content.includes("업로드 및 텍스트 추출 중")
          ? { ...m, content: completedContent }
          : m
      ));
      // DB 메시지도 완료 내용으로 업데이트
      if (dbMsgId) {
        agentMessagesApi.update(dbMsgId, completedContent).catch(() => {});
      }
      emitPipelineEvent({ kind: "complete", label: "📄 문서 처리 완료", detail: file.name });
      emitDocumentUploadEvent({
        phase: "complete",
        filename: file.name,
        fileSize: file.size,
        docId: doc.id,
        extractor: "openDataLoader",
      });
      const autoPrompt = `문서 ID ${doc.id} ("${file.name}")를 업로드했습니다. 이 문서로 SFT 학습데이터를 20개 생성해 주세요. 원문 텍스트의 언어(한국어면 한국어, 영어면 영어)로 생성해 주세요. Claude 모델을 사용해 주세요.`;
      setInput((prev) => prev ? prev : autoPrompt);
    } catch {
      const failedContent = `📎 **${file.name}** — 업로드 실패 ❌`;
      setMessages(prev => prev.map((m, i) =>
        i === prev.length - 1 && m.content.includes("업로드 및 텍스트 추출 중")
          ? { ...m, content: failedContent }
          : m
      ));
      if (dbMsgId) agentMessagesApi.update(dbMsgId, failedContent).catch(() => {});
      emitPipelineEvent({ kind: "failed", label: "📄 문서 처리 실패", detail: file.name });
      emitDocumentUploadEvent({
        phase: "failed",
        filename: file.name,
        fileSize: file.size,
        extractor: "openDataLoader",
      });
    } finally {
      setUploadingFile(false);
    }
  };

  const messagesEndRef   = useRef<HTMLDivElement>(null);
  const terminalEndRef   = useRef<HTMLDivElement>(null);
  const inputRef         = useRef<HTMLTextAreaElement>(null);
  const chatBodyRef      = useRef<HTMLDivElement>(null);
  const isAtBottomRef    = useRef(true);

  const handleChatScroll = useCallback(() => {
    const el = chatBodyRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);
  const abortRef = useRef<AbortController | null>(null);
  const currentPage = location.pathname;

  const logFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingLogsRef = useRef<TerminalEntry[]>([]);

  const addTerminalLog = useCallback((type: TerminalEntry["type"], text: string, step?: number) => {
    const entry: TerminalEntry = { type, text, ts: new Date(), step };
    setTerminalLogs(prev => [...prev, entry]);
    pendingLogsRef.current.push(entry);
    // Batch-flush to backend every 2 s
    if (!logFlushRef.current) {
      logFlushRef.current = setTimeout(() => {
        logFlushRef.current = null;
        const batch = pendingLogsRef.current.splice(0);
        if (batch.length === 0) return;
        api.post("/chat/terminal-log", batch.map(e => ({
          ts: e.ts.toISOString(),
          type: e.type,
          text: e.text,
        }))).catch(() => {/* 로그 전송 실패 무시 */});
      }, 2000);
    }
  }, []);

  // Save a message to backend DB and update local state
  const pushMessage = useCallback((msg: Message) => {
    const { role, content, toolCalls, isPlan, isStepConfirm, navigateTo, elapsedMs, approved } = msg;
    const metadata: Record<string, unknown> = {};
    if (toolCalls) metadata.toolCalls = toolCalls;
    if (isPlan) metadata.isPlan = isPlan;
    if (isStepConfirm) metadata.isStepConfirm = isStepConfirm;
    if (navigateTo) metadata.navigateTo = navigateTo;
    if (elapsedMs) metadata.elapsedMs = elapsedMs;
    if (approved !== undefined) metadata.approved = approved;
    agentMessagesApi.add({
      session_id: CHAT_SESSION,
      role,
      content,
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
    }).then(res => {
      lastSyncedIdRef.current = Math.max(lastSyncedIdRef.current, res.data.id ?? 0);
    }).catch(() => {});
    setMessages(prev => [...prev, msg]);
  }, []);

  // ── Load messages from backend on mount ───────────────────────────────────
  useEffect(() => {
    const version = resetVersionRef.current;
    agentMessagesApi.get(CHAT_SESSION).then(res => {
      if (resetInProgressRef.current || version !== resetVersionRef.current) return;
      const loaded: Message[] = res.data.map(r => ({
        role: r.role as "user" | "assistant",
        content: r.content,
        ts: new Date(r.created_at),
        ...(r.metadata ?? {}),
      }));
      if (loaded.length > 0) {
        setMessages(loaded);
        lastSyncedIdRef.current = res.data[res.data.length - 1].id;
      }
    }).catch(() => {});
  }, []);

  // ── Poll backend every 2 s to sync messages from other sessions ───────────
  useEffect(() => {
    const interval = setInterval(async () => {
      if (resetInProgressRef.current) return;
      const version = resetVersionRef.current;
      try {
        const res = await agentMessagesApi.get(CHAT_SESSION);
        if (resetInProgressRef.current || version !== resetVersionRef.current) return;
        if (res.data.length === 0) {
          // 백엔드가 일시적으로 빈 배열을 반환하더라도 클라이언트 로컬 메시지
          // (방금 입력한 사용자 메시지 등 add API가 아직 완료 안 된 메시지)는 절대 지우지 않는다.
          // 명시적 reset은 별도 핸들러(/clear, 휴지통 버튼)가 setMessages([])를 직접 호출하므로 여기서는 무시한다.
          return;
        }
        const maxId = res.data[res.data.length - 1].id;

        // Update content of existing messages that changed (e.g. "uploading" → "completed")
        setMessages(prev => {
          const dbById: Record<number, typeof res.data[0]> = {};
          res.data.forEach(r => { dbById[r.id] = r; });
          return prev.map((m, i) => {
            // Match by position if no id. role이 다르면 사용자 입력 직후 add API가 아직 완료되지 않아
            // 인덱스가 어긋난 상태이므로 절대 덮어쓰지 않는다 — 사용자 메시지가 보존된다.
            const dbRow = res.data[i];
            if (dbRow && dbRow.role === m.role && m.content !== dbRow.content) {
              return { ...m, content: dbRow.content, ...(dbRow.metadata ?? {}) };
            }
            return m;
          });
        });

        if (maxId <= lastSyncedIdRef.current) return;
        const newRows = res.data.filter(r => r.id > lastSyncedIdRef.current);
        if (newRows.length === 0) return;
        lastSyncedIdRef.current = maxId;
        const newMsgs: Message[] = newRows.map(r => ({
          role: r.role as "user" | "assistant",
          content: r.content,
          ts: new Date(r.created_at),
          ...(r.metadata ?? {}),
        }));
        setMessages(prev => [...prev, ...newMsgs]);
      } catch { /* network error — silently skip */ }
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Keep only the last 200 terminal entries to avoid quota issues
    const slice = terminalLogs.slice(-200);
    try { localStorage.setItem(LS_TERMINAL, JSON.stringify(slice)); } catch { /* quota */ }
  }, [terminalLogs]);

  useEffect(() => {
    localStorage.setItem(LS_WIDTH, String(panelWidth));
  }, [panelWidth]);

  useEffect(() => {
    localStorage.setItem(LS_TERM_H, String(terminalH));
  }, [terminalH]);

  useEffect(() => {
    localStorage.setItem(LS_INPUT_H, String(chatInputH));
  }, [chatInputH]);

  useEffect(() => {
    localStorage.setItem("nella_persona", persona);
  }, [persona]);

  useEffect(() => {
    localStorage.setItem(LS_TERM_OPEN, String(terminalOpen));
  }, [terminalOpen]);

  // ── Setup ─────────────────────────────────────────────────────────────────
  const setupDone = useRef(false);
  const setupRunRef = useRef(0);
  useEffect(() => {
    if (setupDone.current) return;
    setupDone.current = true;
    fetchSetup();
  }, []);

  const fetchSetup = async () => {
    const runId = ++setupRunRef.current;
    addTerminalLog("boot", "🔌 NELLA Agent 초기화 중...");
    addTerminalLog("boot", "⚡ 시스템 프로바이더 연결 확인 중...");

    const skillLoading = (async () => {
      addTerminalLog("boot", "📦 파이프라인 스킬 로딩 중 (9단계)...");
      await new Promise(r => setTimeout(r, 20));
      for (let step = 1; step <= 9; step++) {
        if (setupRunRef.current !== runId) return;
        const cfg = STEP_CONFIG[step];
        const count = STEP_TOOL_COUNTS[step];
        addTerminalLog("skill", `${cfg.icon} [${step}단계] ${cfg.name} — ${count}개 도구`, step);
        await new Promise(r => setTimeout(r, 20));
      }
    })();

    // provider info는 필수 — 실패 시 재시도 안내
    let p: ProviderInfo;
    try {
      const pRes = await api.get<ProviderInfo>("/settings/available-providers");
      p = pRes.data;
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? "네트워크 오류";
      addTerminalLog("error", `초기화 실패: 백엔드 연결 불가 (${msg}) — 서버 실행 후 ↺ 재연결`);
      return;
    }
    if (setupRunRef.current !== runId) return;

    setProviderInfo(p);
    const best: ProviderMode = p.anthropic ? "anthropic" : p.openai ? "openai" : "local";
    const initModel = best === "anthropic" ? p.anthropic_model : best === "openai" ? p.openai_model : "";
    setMode(best);
    setProviderModel(initModel);
    if (best !== "local") setModelReady(true);

    await skillLoading;
    if (setupRunRef.current === runId) {
      const totalTools = Object.values(STEP_TOOL_COUNTS).reduce((a, b) => a + b, 0);
      addTerminalLog("boot", `✅ ${totalTools}개 도구 로드 완료 — ${PROVIDER_LABELS[best]}(${initModel}) 연결됨`);
      addTerminalLog("monitor", "📡 파이프라인 9단계 실시간 모니터링 중...");
    }

    // 모델 목록은 선택적 — 부팅 로그 표시를 막지 않도록 뒤에서 갱신
    (async () => {
      try {
        const [mRes, trRes] = await Promise.all([
          modelsApi.listDownloaded(),
          trainingApi.listTrainedModels(),
        ]);
        if (setupRunRef.current !== runId) return;
        const locals: Array<{ path: string; name: string }> = [];
        for (const m of mRes.data) if (m.local_path) locals.push({ path: m.local_path, name: m.name });
        for (const t of trRes.data) {
          const path = (t as { merged_dir?: string }).merged_dir || (t as { output_dir?: string }).output_dir;
          if (path && t.status === "completed") locals.push({ path, name: t.name });
        }
        setLocalModels(locals);
      } catch { /* 모델 목록 로드 실패는 무시 */ }
    })();
  };

  // LLM 설정 저장 시 공급자 정보를 다시 읽어 헤더의 모델명을 갱신합니다.
  // (부팅 setup()에서만 읽으면 저장 후에도 예전 모델명이 그대로 남습니다.)
  useEffect(() => {
    return subscribeLlmSettingsChanged(async () => {
      try {
        const { data: p } = await api.get<ProviderInfo>("/settings/available-providers");
        setProviderInfo(p);
        // 사용자가 고른 공급자는 유지하고, 그 공급자의 모델명만 새로 반영합니다.
        const next =
          mode === "openai" ? p.openai_model
          : mode === "anthropic" ? p.anthropic_model
          : mode === "ollama" ? p.ollama_model
          : "";
        if (next) setProviderModel(next);
      } catch { /* 갱신 실패는 무시 — 다음 부팅에서 반영됩니다 */ }
    });
  }, [mode]);

  useEffect(() => {
    if (!sending && !backgroundWait) { setLoadingStageIdx(0); return; }
    const t = setInterval(() => setLoadingStageIdx(i => (i + 1) % LOADING_STAGES.length), 2200);
    return () => clearInterval(t);
  }, [sending, backgroundWait]);

  // 파이프라인 이벤트 수신 — 각 페이지에서 발행한 액션을 터미널에 표시
  useEffect(() => {
    return subscribePipelineEvents((evt) => {
      const key = `${evt.kind}:${evt.label}:${evt.detail ?? ""}`;
      const now = Date.now();
      if (now - (recentPipelineEventsRef.current[key] ?? 0) < 30_000) return;
      recentPipelineEventsRef.current[key] = now;
      const icon = evt.kind === "start" ? "▷" : evt.kind === "complete" ? "✓" : evt.kind === "failed" ? "✗" : "◼";
      const text = evt.detail ? `${evt.label}  ${evt.detail}` : evt.label;
      addTerminalLog("event", `${icon} ${text}`);
    });
  }, [addTerminalLog]);

  useEffect(() => {
    if (!collapsed && isAtBottomRef.current)
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, collapsed]);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [terminalLogs]);

  // ── Panel width drag ──────────────────────────────────────────────────────
  const startPanelResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidth;
    isResizingPanel.current = true;

    const onMove = (ev: MouseEvent) => {
      if (!isResizingPanel.current) return;
      const newW = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startW - (ev.clientX - startX)));
      setPanelWidth(newW);
    };
    const onUp = () => {
      isResizingPanel.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [panelWidth]);

  // ── Terminal height drag ──────────────────────────────────────────────────
  const startTerminalResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = terminalH;
    isResizingTerminal.current = true;

    const onMove = (ev: MouseEvent) => {
      if (!isResizingTerminal.current) return;
      const panelH = panelRef.current?.clientHeight ?? 600;
      const newH = Math.max(MIN_TERMINAL_H, Math.min(panelH - MIN_CHAT_H - 8, startH + (ev.clientY - startY)));
      setTerminalH(newH);
    };
    const onUp = () => {
      isResizingTerminal.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [terminalH]);

  // ── Chat input height drag ────────────────────────────────────────────────
  const startInputResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = chatInputH;
    isResizingInput.current = true;

    const onMove = (ev: MouseEvent) => {
      if (!isResizingInput.current) return;
      const panelH = panelRef.current?.clientHeight ?? 600;
      // drag up → input taller; drag down → input shorter
      const newH = Math.max(MIN_INPUT_H, Math.min(panelH - MIN_MSGS_H - terminalH - 40, startH - (ev.clientY - startY)));
      setChatInputH(newH);
    };
    const onUp = () => {
      isResizingInput.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [chatInputH, terminalH]);

  // ── Provider ──────────────────────────────────────────────────────────────
  const handleModeChange = (newMode: ProviderMode) => {
    if (!providerInfo) return;
    setMode(newMode); setError(null); setModelReady(false);
    setLocalModelPath(""); setLocalModelName("");
    if (newMode === "openai") { setProviderModel(providerInfo.openai_model); setModelReady(true); }
    else if (newMode === "anthropic") { setProviderModel(providerInfo.anthropic_model); setModelReady(true); }
    else if (newMode === "ollama") { setProviderModel(providerInfo.ollama_model); setModelReady(true); }
    addTerminalLog("info", `프로바이더 변경: ${PROVIDER_LABELS[newMode]}`);
  };

  // 어시스턴트에서 모델을 바꾸면 LLM 설정 화면과 같은 값을 쓰도록 서버에 저장하고
  // 알립니다. (예전에는 이 select가 로컬 state만 바꿔서 두 화면이 따로 놀았습니다.)
  const persistProviderModel = useCallback(async (value: string) => {
    if (!value || mode === "local") return;
    const field =
      mode === "openai" ? "openai_model"
      : mode === "anthropic" ? "anthropic_model"
      : "ollama_model";
    try {
      await settingsApi.update({ [field]: value });
      emitLlmSettingsChanged();
    } catch {
      addTerminalLog("error", `모델 설정 저장 실패: ${value}`);
    }
  }, [mode, addTerminalLog]);

  const loadLocalModel = async (path: string, name: string) => {
    if (!path) return;
    setLoadingModel(true); setError(null); setModelReady(false);
    addTerminalLog("info", `로컬 모델 로딩: ${name}`);
    try {
      await chatApi.loadModel(path);
      setLocalModelPath(path); setLocalModelName(name); setModelReady(true);
      addTerminalLog("info", `✓ 모델 로드 완료: ${name}`);
    } catch {
      setError("모델 로드 실패"); addTerminalLog("error", `모델 로드 실패: ${path}`);
    } finally { setLoadingModel(false); }
  };

  // ── Send message ──────────────────────────────────────────────────────────
  const isAgentMode = mode === "anthropic" || mode === "openai";

  // Detect pending states on last assistant message
  const lastMsg = messages[messages.length - 1];
  const hasPendingPlan =
    !sending &&
    lastMsg?.role === "assistant" &&
    lastMsg.isPlan === true &&
    lastMsg.approved === undefined;
  const hasPendingStep =
    !sending &&
    lastMsg?.role === "assistant" &&
    lastMsg.isStepConfirm === true &&
    lastMsg.approved === undefined;
  const hasPendingTrainingWait =
    !sending &&
    lastMsg?.role === "assistant" &&
    lastMsg.isTrainingWait === true;
  const hasPendingDownloadWait =
    !sending &&
    lastMsg?.role === "assistant" &&
    lastMsg.isDownloadWait === true;
  const hasAnyPending = hasPendingPlan || hasPendingStep;

  const characterState = useMemo(() => {
    if (error) return "struggling";
    if (!sending) {
      const lm = messages[messages.length - 1];
      if (lm?.role === "assistant") {
        if (lm.content?.includes("🏁") || lm.content?.includes("모든 단계 완료")) return "celebrating";
        if (lm.isStepConfirm && lm.approved === true) return "happy";
        if (lm.isPlan && lm.approved === undefined) return "thinking";
      }
      return messages.length === 0 ? "resting" : "resting";
    }
    if (sendingElapsed > 90) return "dozing";
    const lastCall = [...terminalLogs].reverse().find(l => l.type === "call" && l.step);
    if (lastCall?.step === 2) return "making_data";
    if (lastCall?.step === 6 || lastCall?.step === 7) return "training";
    if (lastCall?.step === 8) return "evaluating";
    if (lastCall?.step === 9) return "chatting";
    if (lastCall?.step && [1,3,4,5].includes(lastCall.step)) return "thinking";
    const lastLog = terminalLogs[terminalLogs.length - 1];
    if (lastLog?.type === "boot" || lastLog?.type === "skill" || lastLog?.type === "monitor") return "monitoring";
    return "working";
  }, [sending, sendingElapsed, error, messages, terminalLogs]);

  /**
   * Core send — drives all message flows.
   * @param overrideText  Skip input box, send this text directly.
   * @param planMode      Ask backend for plan only (no execution).
   * @param stepMode      Ask backend to execute exactly one step.
   * @param markApproved  Mark the last pending message as approved before sending.
   * @param markCancelled Mark the last pending message as cancelled (no API call).
   */
  const sendMessage = useCallback(async (
    overrideText?: string,
    planMode = false,
    stepMode = false,
    markApproved = false,
    markCancelled = false,
  ) => {
    // Cancel path — just update state, no API call
    if (markCancelled) {
      setMessages(prev => prev.map((m, i) =>
        i === prev.length - 1 && (m.isPlan || m.isStepConfirm)
          ? { ...m, approved: false } : m
      ));
      addTerminalLog("info", "❌ 취소됨");
      return;
    }

    const text = (overrideText ?? input).trim();
    if (!text || sending) return;
    if (!overrideText) setInput("");
    setError(null);

    // Mark last pending message as approved
    if (markApproved) {
      setMessages(prev => prev.map((m, i) =>
        i === prev.length - 1 && (m.isPlan || m.isStepConfirm)
          ? { ...m, approved: true } : m
      ));
    }

    const userMsg: Message = { role: "user", content: text, ts: new Date() };
    pushMessage(userMsg);
    setSending(true);
    setSendingElapsed(0);
    sendingTimerRef.current = setInterval(() => setSendingElapsed(s => s + 1), 1000);
    const _sendStart = Date.now();
    abortRef.current = new AbortController();
    // Notify pages that agent is now active → start aggressive polling
    window.dispatchEvent(new CustomEvent("agent-active", { detail: { active: true } }));

    const modeLabel = planMode ? "📋 계획 수립" : stepMode ? "▶ 단계 실행" : "💬";
    addTerminalLog("info", `${modeLabel}: "${text.slice(0, 60)}${text.length > 60 ? "…" : ""}"`);

    try {
      const history = [...messages, userMsg];
      const apiMessages = history.map(m => ({ role: m.role, content: m.content }));

      if (isAgentMode) {
        const res = await chatApi.agent({
          provider: mode,
          provider_model: providerModel || undefined,
          messages: apiMessages,
          current_page: currentPage,
          max_tokens: 2048,
          plan_mode: planMode,
          step_mode: stepMode,
          persona: persona.trim() || undefined,
        }, abortRef.current?.signal);

        // Terminal logs
        const details = res.data.tool_call_details ?? [];
        const resultNavTargets: string[] = [];

        // 데이터셋 인자 사람이 읽기 쉽게: id 또는 [ids] → "(이름1, 이름2)" 부가표시
        const formatDatasetIds = (ids: number[]): string => {
          if (ids.length === 0) return "";
          const labelled = ids.map((id) => {
            const nm = datasetNameByIdRef.current[id];
            return nm ? `#${id} ${nm}` : `#${id}`;
          });
          return labelled.join(", ");
        };
        const datasetArgSummary = (args: Record<string, unknown>): string => {
          const arrIds = Array.isArray(args.dataset_ids)
            ? (args.dataset_ids as unknown[]).map((x) => Number(x)).filter((n) => Number.isFinite(n))
            : [];
          const singleId = typeof args.dataset_id === "number" ? args.dataset_id
            : (typeof args.dataset_id === "string" && args.dataset_id ? Number(args.dataset_id) : NaN);
          const ids: number[] = arrIds.length > 0 ? arrIds : (Number.isFinite(singleId) ? [singleId as number] : []);
          if (ids.length === 0) return "";
          return ids.length > 1
            ? `📂 데이터셋 ${ids.length}개 병합: ${formatDatasetIds(ids)}`
            : `📂 데이터셋 ${formatDatasetIds(ids)}`;
        };

        for (const tc of details) {
          const icon = TOOL_ICONS[tc.name] ?? "🔧";
          const argsStr = Object.keys(tc.args).length ? " " + JSON.stringify(tc.args) : "";
          addTerminalLog("call", `${icon} ${tc.name}${argsStr}`, TOOL_STEP_MAP[tc.name]);
          // 훈련·검증 등 데이터셋 사용 도구는 별도 라인으로 선택된 데이터셋을 표시.
          if (["start_training_job", "start_autoresearch", "run_model_validation",
               "run_evaluation", "validate_training_data", "filter_dataset", "preview_dataset"].includes(tc.name)) {
            const summary = datasetArgSummary(tc.args);
            if (summary) addTerminalLog("info", summary, TOOL_STEP_MAP[tc.name]);
          }
          try {
            const parsed = JSON.parse(tc.result);
            rememberAgentDownloads(tc.name, tc.args, parsed);
            // 데이터셋 id↔name 매핑 캐시 업데이트
            if (tc.name === "get_datasets" && Array.isArray(parsed?.datasets)) {
              for (const d of parsed.datasets) {
                if (d?.id != null && d?.name) datasetNameByIdRef.current[Number(d.id)] = String(d.name);
              }
            } else if (typeof parsed?.dataset_id === "number" && typeof parsed?.dataset_name === "string") {
              datasetNameByIdRef.current[parsed.dataset_id] = parsed.dataset_name;
            } else if (Array.isArray(parsed?.dataset_ids) && Array.isArray(parsed?.dataset_names)) {
              parsed.dataset_ids.forEach((id: unknown, i: number) => {
                const nm = parsed.dataset_names?.[i];
                if (typeof id === "number" && typeof nm === "string") {
                  datasetNameByIdRef.current[id] = nm;
                }
              });
            }
            if (typeof parsed.__navigate__ === "string" && parsed.__navigate__) {
              resultNavTargets.push(parsed.__navigate__);
            }
            window.sessionStorage.setItem("nella.agent.lastToolResult", JSON.stringify({
              name: tc.name,
              args: tc.args,
              result: parsed,
              ts: Date.now(),
            }));
            window.dispatchEvent(new CustomEvent("nella-agent-tool-result", {
              detail: { name: tc.name, args: tc.args, result: parsed },
            }));
            const preview = JSON.stringify(parsed, null, 2);
            addTerminalLog("result", preview.length > 400 ? preview.slice(0, 400) + "\n…" : preview);
          } catch {
            addTerminalLog("result", tc.result.slice(0, 300));
          }
        }
        // Auto-navigate: prefer explicit backend/result navigation, then the last tool page.
        const toolAutoNav = details.map(tc => TOOL_PAGE_MAP[tc.name]).filter(Boolean).pop();
        const resultAutoNav = resultNavTargets.filter(Boolean).pop();
        const navTarget = res.data.navigate_to || resultAutoNav || toolAutoNav || null;

        if (navTarget) addTerminalLog("nav", `🧭 페이지 이동: ${navTarget}`);
        if (res.data.is_plan)         addTerminalLog("info", "📋 계획 완성 — 승인 대기 중");
        if (res.data.is_step_confirm) addTerminalLog("info", "✅ 단계 완료 — 다음 단계 확인 대기 중");

        if (res.data.is_training_wait && res.data.training_wait_job_id) {
          const jobId = res.data.training_wait_job_id;
          const label = `${res.data.training_wait_tool === "wait_for_autoresearch" ? "AutoResearch" : "모델 훈련"} #${jobId}`;
          setBackgroundWait({
            kind: "training",
            label,
            startedAt: Date.now(),
            jobId,
            waitTool: res.data.training_wait_tool || "wait_for_training",
          });
          window.sessionStorage.setItem(SS_AGENT_WATCH_TRAINING, JSON.stringify({
            kind: "training",
            label,
            startedAt: Date.now(),
            jobId,
            waitTool: res.data.training_wait_tool || "wait_for_training",
          }));
          addTerminalLog("event", "스킬 탐색 중... 모델 훈련 진행률을 추적합니다", 6);
          addTerminalLog("event", "결과 분석 중... 훈련 완료 후 7단계 계획을 제안합니다", 6);
        } else if (res.data.suppress_chat_response) {
          const downloadTools = details
            .filter((tc) => tc.name === "download_model" || tc.name === "download_compatible_models" || tc.name === "wait_for_model_download")
            .map((tc) => tc.name);
          if (downloadTools.length > 0) {
            let label = "모델 다운로드";
            for (const tc of details) {
              try {
                const parsed = JSON.parse(tc.result);
                if (tc.name === "download_model") {
                  label = String(parsed.model_id ?? tc.args.model_id ?? label);
                } else if (tc.name === "download_compatible_models" && Array.isArray(parsed.downloads)) {
                  const count = parsed.downloads.length;
                  label = count > 0 ? `모델 ${count}개 다운로드` : label;
                }
              } catch {
                /* ignore */
              }
            }
            setBackgroundWait({ kind: "download", label, startedAt: Date.now() });
            addTerminalLog("event", "스킬 로딩중... 모델 다운로드 진행률을 추적합니다", 4);
            addTerminalLog("event", "결과 탐색 중... 다운로드 완료 후 다음 단계 계획을 제안합니다", 4);
          }
        } else {
          pushMessage({
            role: "assistant",
            content: res.data.response,
            ts: new Date(),
            elapsedMs: Date.now() - _sendStart,
            toolCalls: details,
            isPlan: res.data.is_plan,
            isStepConfirm: res.data.is_step_confirm,
            isTrainingWait: res.data.is_training_wait,
            trainingWaitJobId: res.data.training_wait_job_id ?? undefined,
            trainingWaitTool: res.data.training_wait_tool ?? undefined,
            isDownloadWait: res.data.is_download_wait,
            downloadWaitModelIds: res.data.download_wait_model_ids,
            navigateTo: navTarget || undefined,
          });
        }

        if (navTarget) {
          navigate(navTarget);
          window.dispatchEvent(new CustomEvent("agent-navigate"));
        }
      } else {
        const res = await chatApi.complete({
          model_path: mode === "local" ? localModelPath : "",
          provider: mode === "local" ? "local" : mode,
          provider_model: mode === "ollama" ? providerModel : undefined,
          messages: [{ role: "system", content: "You are a helpful AI assistant." }, ...apiMessages],
          max_new_tokens: 512,
          temperature: 0.7,
        });
        pushMessage({ role: "assistant", content: res.data.response, ts: new Date(), elapsedMs: Date.now() - _sendStart });
      }
    } catch (e: unknown) {
      if (e instanceof Error && (e.name === "AbortError" || e.name === "CanceledError" || e.message === "canceled")) {
        addTerminalLog("info", "⛔ 요청이 중단되었습니다");
      } else {
        const msg = e instanceof Error ? e.message : "응답 오류";
        setError(msg);
        addTerminalLog("error", `오류: ${msg}`);
      }
    } finally {
      abortRef.current = null;
      setSending(false);
      if (sendingTimerRef.current) { clearInterval(sendingTimerRef.current); sendingTimerRef.current = null; }
      setSendingElapsed(0);
      // Notify pages that agent is done → back to idle polling
      window.dispatchEvent(new CustomEvent("agent-active", { detail: { active: false } }));
      // One final refresh so pages pick up the last changes
      window.dispatchEvent(new CustomEvent("agent-navigate"));
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, sending, messages, mode, providerModel, localModelPath, currentPage, isAgentMode, navigate, addTerminalLog, pushMessage]);

  useEffect(() => {
    const scheduleNextPlan = () => {
      if (downloadPlanTimerRef.current) window.clearTimeout(downloadPlanTimerRef.current);
      downloadPlanTimerRef.current = window.setTimeout(async () => {
        try {
          const active = await modelsApi.activeDownloads();
          if ((active.data ?? []).length > 0) {
            scheduleNextPlan();
            return;
          }
        } catch {
          scheduleNextPlan();
          return;
        }
        if (sendingRef.current) {
          scheduleNextPlan();
          return;
        }
        const completed = completedAgentDownloadsRef.current.splice(0);
        if (completed.length === 0) return;
        setBackgroundWait(null);
        const modelList = completed
          .map((item) => item.model_id)
          .filter(Boolean)
          .filter((id, idx, arr) => arr.indexOf(id) === idx);
        addTerminalLog("event", `⬇️ 모델 다운로드 완료 — 다음 단계 계획 요청`);
        pushMessage({
          role: "assistant",
          ts: new Date(),
          isPlan: true,
          navigateTo: "/model-validation",
          content: [
            "📋 **실행 계획**",
            "",
            "**목표**: 다운로드된 기반 모델을 검증하고 훈련에 사용할 최적 모델을 선정",
            "",
            "**현재 상태**:",
            "- 4단계 기반모델 다운로드 완료",
            `- 다운로드 모델: ${modelList.join(", ") || "다운로드된 모델"}`,
            "",
            "**단계별 계획** (각 항목 = 왼쪽 메뉴 한 페이지):",
            "| 단계 | 페이지 | 작업 내용 | 사용 도구 |",
            "|------|--------|-----------|-----------|",
            "| 5 | /model-validation | 다운로드된 후보 모델을 실제 데이터 기준으로 검증하고 최종 모델 선정 | `run_model_validation` |",
            "",
            "**주요 파라미터**:",
            `- candidate_model_ids: ${modelList.join(", ") || "다운로드된 모델"}`,
            "- selection_target: best validated base model",
            "",
            "승인하시면 5단계 모델 검증부터 진행하겠습니다.",
          ].join("\n"),
        });
      }, 2500);
    };

    const markCompleted = (modelId: string, name?: string) => {
      if (!completedAgentDownloadsRef.current.some((item) => item.model_id === modelId)) {
        completedAgentDownloadsRef.current.push({ model_id: modelId, name });
      }
      try {
        const watch = JSON.parse(window.sessionStorage.getItem(SS_AGENT_WATCH_DOWNLOADS) || "[]") as Array<{ model_id?: string }>;
        window.sessionStorage.setItem(
          SS_AGENT_WATCH_DOWNLOADS,
          JSON.stringify(watch.filter((item) => item.model_id !== modelId))
        );
      } catch {
        /* ignore */
      }
      let remaining = 0;
      try {
        const watch = JSON.parse(window.sessionStorage.getItem(SS_AGENT_WATCH_DOWNLOADS) || "[]") as Array<{ model_id?: string }>;
        remaining = watch.filter((item) => item.model_id).length;
      } catch {
        remaining = 0;
      }
      if (remaining === 0) {
        scheduleNextPlan();
      } else {
        setBackgroundWait((prev) => prev?.kind === "download" ? { ...prev, label: `모델 ${remaining}개 다운로드` } : prev);
      }
    };

    const onDownloadCompleted = (event: Event) => {
      const detail = (event as CustomEvent<{ model_id?: string; name?: string; agent_initiated?: boolean }>).detail;
      if (!detail?.agent_initiated || !detail.model_id) return;
      markCompleted(detail.model_id, detail.name);
    };

    const pollWatchedDownloads = () => {
      let watched: Array<{ model_id?: string; name?: string; ts?: number }> = [];
      try {
        watched = JSON.parse(window.sessionStorage.getItem(SS_AGENT_WATCH_DOWNLOADS) || "[]");
      } catch {
        watched = [];
      }
      watched = watched.filter((item) => item.model_id && item.ts && Date.now() - item.ts < 60 * 60_000);
      if (watched.length === 0) {
        window.sessionStorage.setItem(SS_AGENT_WATCH_DOWNLOADS, "[]");
        return;
      }
      window.sessionStorage.setItem(SS_AGENT_WATCH_DOWNLOADS, JSON.stringify(watched));
      for (const item of watched) {
        const modelId = item.model_id;
        if (!modelId) continue;
        void modelsApi.downloadStatus(modelId).then((res) => {
          const status = res.data.status;
          if (status === "completed") {
            addTerminalLog("event", `결과 탐색 완료: ${item.name || modelId}`, 4);
            markCompleted(modelId, item.name);
          } else if (status === "failed" || status === "cancelled") {
            try {
              const current = JSON.parse(window.sessionStorage.getItem(SS_AGENT_WATCH_DOWNLOADS) || "[]") as Array<{ model_id?: string }>;
              window.sessionStorage.setItem(SS_AGENT_WATCH_DOWNLOADS, JSON.stringify(current.filter((x) => x.model_id !== modelId)));
            } catch {
              /* ignore */
            }
            addTerminalLog("error", `모델 다운로드 ${status}: ${item.name || modelId}`, 4);
          } else if (status === "downloading" || status === "preparing") {
            addTerminalLog("monitor", `스킬 탐색 중... ${item.name || modelId} ${Math.round(res.data.percent || 0)}%`, 4);
          }
        }).catch(() => { /* ignore */ });
      }
    };

    window.addEventListener(AGENT_DOWNLOAD_COMPLETED_EVENT, onDownloadCompleted);
    pollWatchedDownloads();
    const watchTimer = window.setInterval(pollWatchedDownloads, 5000);
    return () => {
      window.removeEventListener(AGENT_DOWNLOAD_COMPLETED_EVENT, onDownloadCompleted);
      window.clearInterval(watchTimer);
      if (downloadPlanTimerRef.current) window.clearTimeout(downloadPlanTimerRef.current);
    };
  }, [addTerminalLog, pushMessage]);

  useEffect(() => {
    if (!backgroundWait) {
      try {
        const stored = JSON.parse(window.sessionStorage.getItem(SS_AGENT_WATCH_TRAINING) || "null") as BackgroundWaitState | null;
        if (stored?.kind === "training" && stored.jobId) {
          setBackgroundWait(stored);
        }
      } catch {
        /* ignore */
      }
    }
    if (!backgroundWait || backgroundWait.kind !== "training" || !backgroundWait.jobId) return;
    let cancelled = false;
    const jobId = backgroundWait.jobId;

    const pollTraining = async () => {
      if (cancelled || sendingRef.current) return;
      try {
        const [arRes, jobRes] = await Promise.all([
          trainingApi.listARJobs().catch(() => ({ data: [] })),
          trainingApi.listJobs().catch(() => ({ data: [] })),
        ]);
        const arJob = (arRes.data ?? []).find((j) => j.id === jobId);
        const trainJob = (jobRes.data ?? []).find((j) => j.id === jobId);
        const status = arJob?.status ?? trainJob?.status;
        if (!status) return;

        if (status === "completed") {
          setBackgroundWait(null);
          window.sessionStorage.removeItem(SS_AGENT_WATCH_TRAINING);
          addTerminalLog("event", `훈련 완료 감지: ${backgroundWait.label}`, 6);
          const resultIdLine = arJob
            ? `- autoresearch_job_id: ${jobId}`
            : `- training_job_id: ${jobId}`;
          const lossLine = arJob?.best_loss != null
            ? `- best_loss: ${Number(arJob.best_loss).toFixed(4)}`
            : trainJob?.final_loss != null
              ? `- final_loss: ${Number(trainJob.final_loss).toFixed(4)}`
              : "- loss: 결과 화면에서 확인";
          pushMessage({
            role: "assistant",
            ts: new Date(),
            isPlan: true,
            navigateTo: "/training-results",
            content: [
              "📋 **실행 계획**",
              "",
              "**목표**: 완료된 모델 훈련 결과를 확인하고 다음 평가 단계로 진행",
              "",
              "**현재 상태**:",
              "- 6단계 모델 훈련 완료",
              resultIdLine,
              lossLine,
              "",
              "**단계별 계획** (각 항목 = 왼쪽 메뉴 한 페이지):",
              "| 단계 | 페이지 | 작업 내용 | 사용 도구 |",
              "|------|--------|-----------|-----------|",
              "| 7 | /training-results | 훈련 결과와 산출 모델 경로를 확인하고 평가 대상 모델을 확정 | `get_autoresearch_job_status` |",
              "",
              "**주요 파라미터**:",
              resultIdLine,
              arJob ? "- evaluation_target: AutoResearch final_model" : "- evaluation_target: trained model output_dir",
              "",
              "승인하시면 7단계 훈련결과 확인부터 진행하겠습니다.",
            ].join("\n"),
          });
        } else if (status === "failed" || status === "cancelled") {
          setBackgroundWait(null);
          window.sessionStorage.removeItem(SS_AGENT_WATCH_TRAINING);
          addTerminalLog("error", `훈련 ${status}: ${backgroundWait.label}`, 6);
          const prompt = `6단계 모델 훈련이 ${status} 상태로 종료되었습니다. job_id=${jobId}. 원인과 다음 조치 계획을 사용자에게 제안하세요.`;
          void sendMessage(prompt, true, false, false);
        } else {
          addTerminalLog("monitor", `파이프라인 탐색 중... ${backgroundWait.label} (${status})`, 6);
        }
      } catch {
        /* ignore transient polling errors */
      }
    };

    void pollTraining();
    const timer = window.setInterval(pollTraining, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [backgroundWait, addTerminalLog, pushMessage, sendMessage]);

  // ── Force stop / reset ────────────────────────────────────────────────────

  /** 진행 중인 HTTP 요청을 중단하고 sending 상태 해제 */
  const forceStop = useCallback(() => {
    void chatApi.stopAgent().catch(() => {});
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
    setError(null);
    setBackgroundWait(null);
    window.sessionStorage.removeItem(SS_AGENT_WATCH_TRAINING);
    addTerminalLog("info", "⛔ 강제 중단 — 백엔드 작업 취소 요청 전송");
    window.dispatchEvent(new CustomEvent("agent-active", { detail: { active: false } }));
    window.dispatchEvent(new CustomEvent("agent-navigate"));
  }, [addTerminalLog]);

  /** 대화 이력 + 터미널 전체 삭제 (업로드 문서는 유지, 진행 중이면 먼저 중단) */
  const forceReset = useCallback(async () => {
    resetInProgressRef.current = true;
    resetVersionRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    if (logFlushRef.current) {
      clearTimeout(logFlushRef.current);
      logFlushRef.current = null;
    }
    pendingLogsRef.current = [];
    setSending(false);
    setError(null);
    setMessages([]);
    setTerminalLogs([]);
    lastSyncedIdRef.current = 0;
    localStorage.removeItem(LS_MESSAGES);
    localStorage.removeItem(LS_TERMINAL);
    addTerminalLog("info", "🗑 대화 이력이 삭제되었습니다");
    void fetchSetup();
    try {
      await agentMessagesApi.clear(CHAT_SESSION);
      lastSyncedIdRef.current = 0;
      setMessages([]);
    } catch {
      addTerminalLog("error", "대화 이력 삭제 실패");
    } finally {
      resetInProgressRef.current = false;
    }
  }, [addTerminalLog]);

  // ── Plan / Step parsing helpers ───────────────────────────────────────────

  /** 계획 테이블에서 단계 목록 파싱: | 단계 | 페이지 | 작업 내용 | 도구 | */
  const parsePlanSteps = useCallback((content: string): Array<{ num: number; page: string; name: string }> => {
    const steps: Array<{ num: number; page: string; name: string }> = [];
    let inPlanSection = false;
    let sawPlanHeader = false;
    for (const line of content.split('\n')) {
      if (/단계별\s*계획/.test(line)) {
        inPlanSection = true;
        sawPlanHeader = false;
        continue;
      }
      if (inPlanSection && sawPlanHeader && line.trim() && !line.includes("|")) {
        break;
      }
      if (!inPlanSection) continue;
      const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
      if (cells.length < 2) continue;
      if (cells.some((cell) => cell === "단계") && cells.some((cell) => cell === "페이지")) {
        sawPlanHeader = true;
        continue;
      }
      if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
      const stepMatch = cells[0].match(/^(\d+)(?:\s*단계)?$/);
      if (!stepMatch) continue;
      const pageIndex = cells.findIndex((cell) => /^\/[a-z][a-z-]*$/.test(cell));
      if (pageIndex < 0) continue;
      const page = pageIndex >= 0 ? cells[pageIndex] : "";
      const name = cells
        .filter((_, idx) => idx !== 0 && idx !== pageIndex)
        .join(" ")
        .replace(/`/g, "")
        .trim();
      steps.push({ num: parseInt(stepMatch[1]), page, name });
    }
    return steps;
  }, []);

  /** step-confirm 메시지에서 "⏭️ 다음 단계: N단계 - 이름" 파싱 */
  const parseNextStepHint = useCallback((content: string): { num: number; name: string } | null => {
    const m = content.match(/(?:⏭️\s*)?(?:\*\*)?\s*다음\s*단계\s*(?:\*\*)?[:：]?\s*(\d+)\s*단계\s*[-–—:]?\s*([^\n*✅📋⏭]+)/);
    return m ? { num: parseInt(m[1]), name: m[2].trim() } : null;
  }, []);

  const parseCompletedStep = useCallback((content: string): number | null => {
    const m = content.match(/✅\s*(?:\*\*)?\s*(\d+)\s*단계\s*완료/);
    return m ? parseInt(m[1]) : null;
  }, []);

  /** 키워드로 페이지 추측 (plan lookup 실패 시 폴백) */
  const guessPageFromHint = useCallback((hint: string): string => {
    const h = hint.toLowerCase().replace(/\s+/g, "");
    // 더 구체적인 매칭부터. "학습 데이터 생성"처럼 띄어쓴 표현도 안정적으로 처리한다.
    if (h.includes("학습데이터생성") || h.includes("데이터생성") || h.includes("generate_sft_data") || h.includes("generate_dpo_data") || h.includes("sft") || h.includes("dpo")) return "/data";
    if (h.includes("학습데이터검증") || h.includes("데이터검증") || h.includes("validate_training_data") || h.includes("필터")) return "/data-validation";
    if (h.includes("모델검증") || h.includes("model-validation") || h.includes("run_model_validation")) return "/model-validation";
    if (h.includes("훈련결과") || h.includes("training-result") || h.includes("어댑터 병합") || h.includes("merge")) return "/training-results";
    if (h.includes("모델학습") || h.includes("모델훈련") || h.includes("파인튜닝") || h.includes("fine-tun") || h.includes("autoresearch") || h.includes("훈련") || h.includes("학습")) return "/training";
    if (h.includes("기반모델") || h.includes("모델선택") || h.includes("다운로드") || h.includes("download_model")) return "/models";
    if (h.includes("평가") || h.includes("evaluation")) return "/evaluation";
    if (h.includes("대화") || h.includes("채팅") || h.includes("테스트")) return "/chat";
    if (h.includes("문서")) return "/documents";
    if (h.includes("데이터")) return "/data";
    // "모델"만 있는 모호한 경우는 마지막에 — 학습/훈련/검증/선택 모두 위에서 매칭됐어야 한다.
    if (h.includes("모델")) return "/models";
    return "";
  }, []);

  const getInitialPlanStep = useCallback((planMsg?: Message | null): { num?: number; page: string; name: string } => {
    const content = planMsg?.content ?? "";
    const steps = parsePlanSteps(content);
    const firstStep = steps[0];
    if (firstStep) {
      return firstStep;
    }

    const startHints = Array.from(content.matchAll(/(?:바로|먼저|우선)?\s*(\d+)\s*단계\s*(?:\(([^)]*)\))?\s*부터\s*(?:실행|진행|시작)/g));
    const startHint = startHints[startHints.length - 1];
    if (startHint) {
      const num = parseInt(startHint[1]);
      const hintedName = (startHint[2] ?? "").trim();
      return {
        num,
        page: STEP_PAGE_MAP[num] || guessPageFromHint(hintedName),
        name: hintedName || STEP_CONFIG[num]?.name || "",
      };
    }

    const firstTablePath = (() => {
      const m = content.match(/\|\s*(\/[a-z][a-z-]*)\s*\|/);
      return m ? m[1].trim() : "";
    })();
    const num = firstTablePath
      ? Number(Object.entries(STEP_PAGE_MAP).find(([, page]) => page === firstTablePath)?.[0])
      : undefined;
    const name = num ? STEP_CONFIG[num]?.name ?? "" : "";
    return {
      num: Number.isFinite(num) ? num : undefined,
      page: (num != null && Number.isFinite(num) ? STEP_PAGE_MAP[num] : "")
        || guessPageFromHint(name)
        || planMsg?.navigateTo
        || firstTablePath,
      name,
    };
  }, [guessPageFromHint, parsePlanSteps]);

  // ── Plan / Step action handlers ────────────────────────────────────────────

  /** 계획 승인 → 첫 단계 실행 (step_mode=true). 단계 번호는 9단계 파이프라인 고정 번호. */
  const approvePlan = useCallback((planOverride?: Message) => {
    const planMsg = planOverride ?? messages.slice().reverse().find(m => m.isPlan);
    const { num: firstStepNum, page: firstStepPage, name: firstStepName } = getInitialPlanStep(planMsg);

    const stepLabel = firstStepNum != null ? `${firstStepNum}단계` : "첫 단계";

    // 첫 단계 페이지로 즉시 이동 (실행 전에 화면 먼저)
    if (firstStepPage) {
      navigate(firstStepPage);
      addTerminalLog("nav", `🧭 ${stepLabel} 페이지 이동: ${firstStepPage}`);
      announceAgentPageStart(firstStepPage, firstStepName || stepLabel);
      window.dispatchEvent(new CustomEvent("agent-navigate"));
    }

    const label = firstStepName ? `${stepLabel} (${firstStepName})` : stepLabel;
    addTerminalLog("info", `✅ 계획 승인 → ${label} 시작`);
    sendMessage(`승인합니다. ${label}부터 실행해주세요.`, false, true, true, false);
  }, [sendMessage, addTerminalLog, messages, navigate, getInitialPlanStep]);

  /** 계획 취소 */
  const cancelPlan = useCallback(() => {
    sendMessage(undefined, false, false, false, true);
  }, [sendMessage]);

  /** 다음 단계 계속 실행 */
  const continueStep = useCallback(() => {
    const stepMsg = messages.slice().reverse().find(m => m.isStepConfirm);
    const next = parseNextStepHint(stepMsg?.content ?? "");

    // 다음 단계 페이지 이동: plan 테이블 lookup → 키워드 폴백
    const planMsg = messages.slice().reverse().find(m => m.isPlan);
    const steps = parsePlanSteps(planMsg?.content ?? "");
    const completedNum = parseCompletedStep(stepMsg?.content ?? "");
    const nextStep = next
      ? steps.find(s => s.num === next.num)
      : completedNum != null
        ? steps.find(s => s.num > completedNum)
        : null;
    const hintedPage = next ? guessPageFromHint(next.name) : "";
    const targetPage = nextStep?.page
      || (next?.num != null ? STEP_PAGE_MAP[next.num] : "")
      || hintedPage
      || stepMsg?.navigateTo
      || "";
    if (targetPage) {
      navigate(targetPage);
      addTerminalLog("nav", `🧭 ${next ? next.num + "단계" : "다음 단계"} 페이지 이동: ${targetPage}`);
      announceAgentPageStart(targetPage, next?.name || "다음 단계");
      window.dispatchEvent(new CustomEvent("agent-navigate"));
    }

    const label = next
      ? `${next.num}단계 (${next.name})`
      : nextStep
        ? `${nextStep.num}단계 (${nextStep.name || PAGE_LABELS[nextStep.page] || "다음 단계"})`
        : "다음 단계";
    addTerminalLog("info", `▶ ${label} 실행`);
    sendMessage(`계속합니다. ${label}를 실행해주세요.`, false, true, true, false);
  }, [sendMessage, addTerminalLog, messages, navigate, parsePlanSteps, parseNextStepHint, parseCompletedStep, guessPageFromHint]);

  /** 단계 실행 중단 */
  const stopStep = useCallback(() => {
    sendMessage(undefined, false, false, false, true);
  }, [sendMessage]);

  // 자율 폴링용: 최신 messages를 ref로 들고있어 useCallback이 message 변경에 재생성되지 않게 한다.
  // (의존성에 messages가 있으면 useEffect 안 timer가 매번 리셋되어 영영 발화 안 됨)
  const messagesRef = useRef<Message[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  /** 모델 다운로드 진행 확인 → wait_for_model_download 재호출 + 완료 시 계획 요청 */
  const pollDownloadStatus = useCallback(() => {
    const waitMsg = messagesRef.current.slice().reverse().find(m => m.isDownloadWait);
    if (!waitMsg) return;
    const ids = waitMsg.downloadWaitModelIds || [];
    if (ids.length === 0) return;
    addTerminalLog("info", `🔄 모델 다운로드 상태 재확인 (${ids.length}개)`, 4);
    const checkLines = ids.map((id) => `- wait_for_model_download("${id}")`).join("\n");
    const prompt =
      `다음 모델의 다운로드 상태를 확인해주세요:\n${checkLines}\n\n` +
      `모두 status=completed면 📋 실행 계획 형식으로 **다음 단계 계획만** 작성해 사용자 승인을 요청해주세요 ` +
      `(실행 도구는 호출 금지, 이미 _final 학습 데이터셋이 있으면 그 final_dataset_id 사용). ` +
      `아직 진행 중이면 다시 wait_for_model_download만 호출하고 status를 그대로 반환해주세요.`;
    sendMessage(prompt, true, false, false, false);
  }, [sendMessage, addTerminalLog]);

  /** 훈련 진행 상태 다시 확인 → wait_for_training 재호출 메시지 전송 (SFT/AR 자동 판별) */
  const pollTrainingStatus = useCallback(() => {
    const waitMsg = messagesRef.current.slice().reverse().find(m => m.isTrainingWait);
    if (!waitMsg) return;
    const jobId = waitMsg.trainingWaitJobId;
    if (!jobId) return;
    addTerminalLog("info", `🔄 wait_for_training(${jobId}) 재확인`, 6);
    sendMessage(
      `wait_for_training(${jobId})로 훈련 상태를 다시 확인해주세요. ` +
      `status=completed면 6단계 훈련 완료 사실과 7단계 훈련결과 요약을 함께 보여주고, ` +
      `곧바로 "⏭️ 다음 단계: 8단계 평가" 계획을 제안해주세요. ` +
      `status=running/pending/started이면 절대 "✅ 6단계 완료"나 7/8단계 제안을 출력하지 말고, 진행 중 상태만 반환해주세요.`,
      false, true, false, false
    );
  }, [sendMessage, addTerminalLog]);

  // 자율 실행 모드: 계획이 나오면 1단계를 자동 승인하고 해당 화면으로 이동.
  // 에러가 있으면 자동 진행을 멈춘다 — 무한 재시도를 막기 위해.
  useEffect(() => {
    if (!autoExec || !hasPendingPlan || sending || error) return;
    const timer = setTimeout(() => approvePlan(), 800);
    return () => clearTimeout(timer);
  }, [autoExec, hasPendingPlan, sending, error, approvePlan]);

  // 자율 실행 모드: 단계 확인이 오면 다음 단계 화면으로 이동한 뒤 자동 실행.
  // 에러가 있으면 자동 진행을 멈춘다 — Network Error 등이 발생했을 때 800ms 간격으로
  // 무한 재시도하는 것을 막는다. 사용자가 에러를 보고 수동으로 재시도해야 한다.
  useEffect(() => {
    if (!autoExec || !hasPendingStep || sending || error) return;
    const timer = setTimeout(() => continueStep(), 150);
    return () => clearTimeout(timer);
  }, [autoExec, hasPendingStep, sending, error, continueStep]);

  // 학습 데이터 생성·모델 검증과 동일한 단일 HTTP 응답 패턴 — 자동 폴링 없음.
  // wait_for_training이 백엔드에서 완료까지 블록하므로 프론트가 추가로 폴링할 필요 없음.
  // (다운로드 wait은 별도 라이프사이클이지만 동일하게 LLM agent loop 안에서 처리됨)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (sending) return;
      if (isAgentMode) {
        sendMessage(undefined, true);  // 항상 plan_mode로 시작 (자율 모드도 계획 먼저)
      } else {
        sendMessage();
      }
    }
  };

  const handleSend = () => {
    if (sending) return;
    if (isAgentMode) {
      sendMessage(undefined, true);  // 항상 plan_mode로 시작
    } else {
      sendMessage();
    }
  };

  const enabledModes: ProviderMode[] = [
    ...(providerInfo?.openai ? (["openai"] as ProviderMode[]) : []),
    ...(providerInfo?.anthropic ? (["anthropic"] as ProviderMode[]) : []),
    ...(providerInfo?.ollama ? (["ollama"] as ProviderMode[]) : []),
  ];

  // ── Collapsed ─────────────────────────────────────────────────────────────
  if (collapsed) return null;

  // ── Expanded panel ────────────────────────────────────────────────────────
  return (
    <>
    {/* ── Document Viewer Modal ─────────────────────────────────────────── */}
    {docViewer && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setDocViewer(null)}>
        <div className="bg-white rounded-xl shadow-2xl w-[85vw] max-w-5xl h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 flex-shrink-0">
            <FileText className="w-4 h-4 text-red-500" />
            <span className="font-semibold text-sm text-gray-800 flex-1 truncate">{docViewer.filename}</span>
            <a
              href={`http://localhost:8000/api/documents/${docViewer.docId}/file`}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 px-2 py-1 border border-blue-200 rounded hover:bg-blue-50 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />새 탭으로
            </a>
            <button onClick={() => setDocViewer(null)} className="p-1 hover:bg-gray-100 rounded transition-colors ml-1">
              <XIcon className="w-4 h-4 text-gray-500" />
            </button>
          </div>
          {/* PDF iframe */}
          <div className="flex-1 overflow-hidden rounded-b-xl">
            <iframe
              src={`http://localhost:8000/api/documents/${docViewer.docId}/file`}
              className="w-full h-full border-0"
              title={docViewer.filename}
            />
          </div>
        </div>
      </div>
    )}
    <div
      ref={panelRef}
      className="flex-shrink-0 border-l border-gray-200 bg-white flex"
      style={{ width: panelWidth }}
    >
      {/* Left drag handle for panel width */}
      <div
        onMouseDown={startPanelResize}
        className="w-1.5 flex-shrink-0 cursor-col-resize hover:bg-blue-400 bg-transparent transition-colors group flex items-center justify-center"
        title="드래그하여 폭 조절"
      >
        <GripVertical className="w-3 h-3 text-gray-300 group-hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {/* Main panel content */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">

        {/* Header */}
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-200 bg-gray-50 flex-shrink-0">
          <Bot className="w-4 h-4 text-blue-600 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-800">NELLA 어시스턴트</p>
            <p className="text-xs text-blue-500 truncate">
              {PROVIDER_LABELS[mode]}{(providerModel || localModelName) ? ` · ${providerModel || localModelName}` : ""} · {PAGE_LABELS[currentPage] ?? currentPage}
            </p>
          </div>

          {/* 강제 중단 — 요청 진행 중에만 표시 */}
          {sending && (
            <button onClick={forceStop}
              title="요청 중단"
              className="p-1 rounded bg-red-100 hover:bg-red-200 text-red-600 transition-colors flex items-center gap-0.5">
              <Square className="w-3 h-3" />
            </button>
          )}

          {/* 설정 */}
          <button onClick={() => setSettingsOpen(true)}
            title="어시스턴트 설정"
            className="p-1 hover:bg-blue-100 rounded text-gray-400 hover:text-blue-600 transition-colors">
            <Settings className="w-3.5 h-3.5" />
          </button>

          {/* 대화 이력 삭제 (확인 후 실행) */}
          {confirmReset ? (
            <div className="flex items-center gap-1 ml-1">
              <span className="text-[10px] text-red-500 font-medium">삭제?</span>
              <button
                onClick={() => { setConfirmReset(false); forceReset(); }}
                className="px-1.5 py-0.5 bg-red-500 hover:bg-red-600 text-white text-[10px] font-semibold rounded transition-colors"
              >확인</button>
              <button
                onClick={() => setConfirmReset(false)}
                className="px-1.5 py-0.5 bg-gray-200 hover:bg-gray-300 text-gray-600 text-[10px] font-semibold rounded transition-colors"
              >취소</button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmReset(true)}
              title="대화 이력 삭제"
              className="ml-1 p-1 hover:bg-red-100 rounded text-gray-400 hover:text-red-500 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          {/* 재연결 */}
          {!modelReady && !sending && (
            <button onClick={fetchSetup}
              title="에이전트 재연결"
              className="p-1 hover:bg-blue-100 rounded text-gray-400 hover:text-blue-500 transition-colors">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}

          <button onClick={onToggle} title="패널 닫기"
            className="p-1 hover:bg-gray-200 rounded text-gray-400 hover:text-gray-600">
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* ── 설정 모달 ──────────────────────────────────────────────── */}
        {settingsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
               onClick={() => setSettingsOpen(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 flex flex-col"
                 onClick={(e) => e.stopPropagation()}>
              {/* Modal header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-blue-600" />
                  <h2 className="text-sm font-bold text-gray-900">어시스턴트 설정</h2>
                </div>
                <button onClick={() => setSettingsOpen(false)}
                  className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors">
                  <XIcon className="w-4 h-4" />
                </button>
              </div>

              <div className="px-5 py-4 space-y-5 overflow-y-auto max-h-[70vh]">
                {/* LLM 공급자 */}
                <div>
                  <p className="text-xs font-semibold text-gray-700 mb-2">LLM 공급자</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(providerInfo ? enabledModes : (["openai", "anthropic", "ollama"] as ProviderMode[])).map(m => (
                      <button key={m}
                        onClick={() => handleModeChange(m)}
                        className={`flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-xl border-2 transition-all text-left ${
                          mode === m
                            ? "border-blue-500 bg-blue-50"
                            : "border-gray-200 hover:border-blue-300"
                        }`}>
                        <span className={`text-xs font-bold ${mode === m ? "text-blue-700" : "text-gray-700"}`}>
                          {PROVIDER_LABELS[m]}
                        </span>
                        {mode === m && modelReady && (
                          <span className="text-[10px] text-green-600 font-medium">● 연결됨</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 모델 선택 */}
                {mode !== "local" && (
                  <div>
                    <p className="text-xs font-semibold text-gray-700 mb-2">모델</p>
                    {mode !== "ollama" && presetModels.length > 0 ? (
                      <select value={providerModel}
                        onChange={e => { setProviderModel(e.target.value); persistProviderModel(e.target.value); }}
                        className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                        {/* 저장된 모델이 목록에 없으면(예: chat 미지원이라 걸러진 모델)
                            select가 첫 항목을 보여주면서 state에는 예전 값이 남습니다. */}
                        {providerModel && !presetModels.includes(providerModel) && (
                          <option value={providerModel}>{providerModel} (사용 불가 — 변경 필요)</option>
                        )}
                        {presetModels.map((m: string) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    ) : (
                      // 자유 입력은 타이핑마다 저장하지 않도록 포커스가 빠질 때 반영합니다.
                      <input type="text" value={providerModel}
                        onChange={e => setProviderModel(e.target.value)}
                        onBlur={e => persistProviderModel(e.target.value)}
                        placeholder="모델명 입력..."
                        className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                    )}
                  </div>
                )}
                {mode === "local" && (
                  <div>
                    <p className="text-xs font-semibold text-gray-700 mb-2">로컬 모델</p>
                    <select value={localModelPath} disabled={loadingModel}
                      onChange={e => { const loc = localModels.find(x => x.path === e.target.value); if (loc) loadLocalModel(loc.path, loc.name); }}
                      className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                      <option value="">모델 선택...</option>
                      {localModels.map(m => <option key={m.path} value={m.path}>{m.name}</option>)}
                    </select>
                    {loadingModel && <p className="text-xs text-blue-500 mt-1 flex items-center gap-1"><Loader className="w-3 h-3 animate-spin" />로딩 중...</p>}
                  </div>
                )}

                {/* 페르소나 */}
                <div>
                  <p className="text-xs font-semibold text-gray-700 mb-1">페르소나 / 추가 지시</p>
                  <p className="text-[10px] text-gray-400 mb-2">어시스턴트의 역할·말투·제약 조건 등을 자유롭게 입력하세요. 시스템 프롬프트에 추가됩니다.</p>
                  <textarea
                    value={persona}
                    onChange={e => setPersona(e.target.value)}
                    rows={4}
                    placeholder={"예) 한국어로만 답변하세요.\n예) 항상 단계별로 설명하세요.\n예) 반말로 친근하게 대화하세요."}
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                  />
                  {persona.trim() && (
                    <button onClick={() => setPersona("")}
                      className="mt-1 text-[10px] text-red-500 hover:text-red-700 transition-colors">
                      초기화
                    </button>
                  )}
                </div>

                {/* 자율 실행 모드 */}
                <div className="flex items-center justify-between py-2 border-t border-gray-100">
                  <div>
                    <p className="text-xs font-semibold text-gray-700">자율 실행 모드</p>
                    <p className="text-[10px] text-gray-400">계획 수립 단계 없이 바로 실행합니다</p>
                  </div>
                  <button onClick={() => setAutoExec(v => !v)}
                    className={`relative w-9 h-5 rounded-full transition-colors ${autoExec ? "bg-blue-600" : "bg-gray-200"}`}>
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${autoExec ? "translate-x-4" : "translate-x-0.5"}`} />
                  </button>
                </div>
              </div>

              <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
                <button onClick={() => setSettingsOpen(false)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors">
                  확인
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Terminal (top) ───────────────────────────────────────────── */}
        <div
          className="flex-shrink-0 flex flex-col bg-[#0d1117] overflow-hidden"
          style={{ height: terminalOpen ? terminalH : undefined }}
        >
          {/* Terminal header */}
          <div className="flex items-center gap-1.5 px-2 py-1 border-b border-gray-700 flex-shrink-0">
            {/* 캐릭터 상태 표시 */}
            <div className="flex-shrink-0 relative" title={characterState}>
              <img
                src={STATE_IMAGES[characterState]}
                alt={characterState}
                className="h-10 w-10 rounded object-cover object-top"
              />
            </div>
            <Terminal className="w-3 h-3 text-green-400" />
            <span className="text-[10px] text-green-400 font-mono font-semibold">AGENT TERMINAL</span>
            <div className="ml-auto flex items-center gap-1.5">
              {terminalOpen && (
                <span className="text-[10px] text-gray-500 font-mono">{terminalLogs.length} entries</span>
              )}
              {terminalOpen && terminalLogs.length > 0 && (
                <button
                  onClick={() => setTerminalLogs([])}
                  title="터미널 지우기"
                  className="text-gray-600 hover:text-gray-300 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
            <button
              onClick={() => setTerminalOpen(v => !v)}
              title={terminalOpen ? "터미널 접기" : "터미널 펼치기"}
              className="text-gray-500 hover:text-gray-200 transition-colors"
            >
              {terminalOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
          {/* Terminal body */}
          {terminalOpen && (
            <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed space-y-0.5">
              {terminalLogs.length === 0 && (
                <p className="text-gray-600 italic">대화를 시작하면 에이전트의 도구 호출과 결과가 여기 표시됩니다...</p>
              )}
              {terminalLogs.map((log, i) => {
                const stepCfg = log.step ? STEP_CONFIG[log.step] : null;
                const ts = log.ts.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                return (
                  <div key={i}>
                    {log.type === "boot" && (
                      <p className="text-violet-400 whitespace-pre-wrap font-mono">
                        <span className="text-gray-600">{ts} </span>{log.text}
                      </p>
                    )}
                    {log.type === "skill" && (
                      <p className={`${stepCfg?.color ?? "text-indigo-300"} whitespace-pre-wrap font-mono pl-3`}>
                        {log.text} <span className="text-green-500 text-[10px]">✓</span>
                      </p>
                    )}
                    {log.type === "monitor" && (
                      <p className="text-sky-400 whitespace-pre-wrap font-mono">
                        <span className="text-gray-600">{ts} </span>{log.text}
                      </p>
                    )}
                    {log.type === "call" && (
                      <p className={`${stepCfg?.color ?? "text-yellow-300"} whitespace-pre-wrap break-words`}>
                        <span className="text-gray-600">{ts} </span>
                        {stepCfg && (
                          <span className={`text-[9px] font-bold px-1 py-0.5 rounded mr-1 ${stepCfg.bgColor} ${stepCfg.color}`}>
                            {stepCfg.icon}{log.step}
                          </span>
                        )}
                        ▶ {log.text}
                      </p>
                    )}
                    {log.type === "result" && (
                      <p className="text-green-300 whitespace-pre-wrap break-words pl-5 border-l border-green-900">
                        {log.text}
                      </p>
                    )}
                    {log.type === "nav" && (
                      <p className="text-cyan-400 whitespace-pre-wrap">
                        <span className="text-gray-600">{ts} </span>{log.text}
                      </p>
                    )}
                    {log.type === "info" && (
                      <p className="text-gray-400 whitespace-pre-wrap">
                        <span className="text-gray-600">{ts} </span>{log.text}
                      </p>
                    )}
                    {log.type === "error" && (
                      <p className="text-red-400 whitespace-pre-wrap font-mono">
                        <span className="text-gray-600">{ts} </span>✗ {log.text}
                      </p>
                    )}
                    {log.type === "event" && (
                      <p className="text-teal-300 whitespace-pre-wrap border-l-2 border-teal-700 pl-2">
                        <span className="text-gray-600">{ts} </span>{log.text}
                      </p>
                    )}
                  </div>
                );
              })}
              {sending && (
                <p className="text-blue-400 animate-pulse font-mono">
                  ⟳ {LOADING_STAGES[loadingStageIdx]}...
                </p>
              )}
              <div ref={terminalEndRef} />
            </div>
          )}
        </div>

        {/* ── Vertical drag divider (only when terminal open) ──────────── */}
        {terminalOpen && (
          <div
            onMouseDown={startTerminalResize}
            className="h-1.5 flex-shrink-0 cursor-row-resize bg-gray-200 hover:bg-blue-400 transition-colors flex items-center justify-center group"
            title="드래그하여 높이 조절"
          >
            <div className="w-8 h-0.5 bg-gray-400 group-hover:bg-white rounded-full" />
          </div>
        )}

        {/* ── Chat (bottom) ────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Messages */}
          <div ref={chatBodyRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0" style={{ minHeight: MIN_MSGS_H }}>
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center px-2">
                <Bot className="w-9 h-9 text-gray-200 mb-2" />
                <p className="text-xs text-gray-400 leading-relaxed">
                  {modelReady
                    ? isAgentMode
                      ? `현재 화면(${PAGE_LABELS[currentPage] ?? currentPage})과 시스템 상태를 실시간으로 파악합니다.\n무엇이든 물어보세요.`
                      : "메시지를 입력해 대화를 시작하세요."
                    : mode === "local" ? "로컬 모델을 선택해주세요." : "AI를 선택해주세요."}
                </p>
              </div>
            )}

            {messages.map((msg, idx) => {
              const isLast = idx === messages.length - 1;
              const isPending = msg.approved === undefined;

              // Which action buttons to show
              const showPlanBtns = msg.isPlan && isPending && isLast && !sending;
              const showStepBtns = msg.isStepConfirm && isPending && isLast && !sending;

              // Bubble styling
              const bubbleCls = msg.role === "user"
                ? "bg-blue-600 text-white rounded-tr-sm"
                : msg.isPlan
                  ? "bg-amber-50 border border-amber-200 text-gray-800 rounded-tl-sm"
                  : msg.isStepConfirm
                    ? "bg-blue-50 border border-blue-200 text-gray-800 rounded-tl-sm"
                    : (msg.isTrainingWait || msg.isDownloadWait)
                      ? "bg-purple-50 border border-purple-200 text-gray-800 rounded-tl-sm"
                      : "bg-gray-100 text-gray-800 rounded-tl-sm";

              const avatarCls = msg.role === "user"
                ? "bg-blue-600"
                : msg.isPlan ? "bg-amber-100"
                : msg.isStepConfirm ? "bg-blue-100"
                : "bg-gray-200";

              const iconCls = msg.role === "user" ? "text-white"
                : msg.isPlan ? "text-amber-600"
                : msg.isStepConfirm ? "text-blue-600"
                : "text-gray-600";

              return (
              <div key={idx} className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${avatarCls}`}>
                  {msg.role === "user"
                    ? <User className="w-3 h-3 text-white" />
                    : <Bot className={`w-3 h-3 ${iconCls}`} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`rounded-2xl px-3 py-2 text-[11px] leading-snug ${bubbleCls}`}>
                    {msg.role === "assistant" ? (
                      <div className="text-[11px] leading-snug break-words space-y-0.5
                        [&_p]:m-0 [&_p]:leading-snug
                        [&_ul]:m-0 [&_ul]:pl-4
                        [&_ol]:m-0 [&_ol]:pl-4
                        [&_li]:m-0 [&_li]:leading-snug
                        [&_strong]:font-semibold
                        [&_h1]:text-xs [&_h1]:font-semibold [&_h1]:m-0
                        [&_h2]:text-[11px] [&_h2]:font-semibold [&_h2]:m-0
                        [&_h3]:text-[11px] [&_h3]:font-semibold [&_h3]:m-0
                        [&_code]:text-[10px] [&_code]:bg-black/10 [&_code]:px-1 [&_code]:rounded
                        [&_pre]:text-[10px] [&_pre]:bg-black/10 [&_pre]:p-1.5 [&_pre]:rounded [&_pre]:overflow-auto [&_pre]:m-0
                        [&_pre_code]:bg-transparent [&_pre_code]:p-0
                        [&_blockquote]:border-l-2 [&_blockquote]:pl-2 [&_blockquote]:text-gray-500 [&_blockquote]:m-0
                        [&_hr]:my-0.5">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            p: ({children}) => <p className="m-0 leading-snug">{children}</p>,
                            li: ({children}) => <li className="m-0 leading-snug">{children}</li>,
                            img: ({src, alt}) => (
                              <img src={src} alt={alt ?? ""}
                                className="mt-1.5 rounded border border-gray-200 max-w-[60px] shadow-sm block"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                              />
                            ),
                            a: ({href, children}) => {
                              if (href?.startsWith('/doc-view')) {
                                const params = new URLSearchParams(href.split('?')[1] ?? '');
                                const docId = Number(params.get('id'));
                                const name = params.get('name') ?? '문서';
                                return <button className="underline text-blue-300 hover:text-blue-100 font-medium" onClick={() => openDocViewer(docId, name)}>{children}</button>;
                              }
                              const isInternal = href && (href.startsWith('/') || href.startsWith('http://localhost'));
                              if (isInternal) {
                                const path = href.startsWith('http') ? new URL(href).pathname : href;
                                return <button className="underline text-blue-300 hover:text-blue-100" onClick={() => navigate(path)}>{children}</button>;
                              }
                              return <a href={href} target="_blank" rel="noopener noreferrer" className="underline text-blue-300 hover:text-blue-100">{children}</a>;
                            },
                          }}
                        >{msg.content.replace(/\n{3,}/g, '\n\n').trim()}</ReactMarkdown>
                      </div>
                    ) : (
                      <div className="text-[11px] leading-snug break-words">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            p: ({children}) => <p className="m-0 leading-snug whitespace-pre-wrap">{children}</p>,
                            img: ({src, alt}) => (
                              <img src={src} alt={alt ?? ""}
                                className="mt-1.5 rounded border border-white/20 max-w-[60px] shadow-sm block"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                              />
                            ),
                            a: ({href, children}) => {
                              if (href?.startsWith('/doc-view')) {
                                const params = new URLSearchParams(href.split('?')[1] ?? '');
                                const docId = Number(params.get('id'));
                                const name = params.get('name') ?? '문서';
                                return <button className="underline text-blue-200 hover:text-white font-medium" onClick={() => openDocViewer(docId, name)}>{children}</button>;
                              }
                              const isInternal = href && (href.startsWith('/') || href.startsWith('http://localhost'));
                              if (isInternal) {
                                const path = href.startsWith('http') ? new URL(href).pathname : href;
                                return <button className="underline text-blue-200 hover:text-white font-medium" onClick={() => navigate(path)}>{children}</button>;
                              }
                              return <a href={href} target="_blank" rel="noopener noreferrer" className="underline text-blue-200 hover:text-white">{children}</a>;
                            },
                          }}
                        >{msg.content.replace(/\n{3,}/g, '\n\n').trim()}</ReactMarkdown>
                      </div>
                    )}
                  </div>

                  {/* ── Plan approval buttons ─────────────────── */}
                  {showPlanBtns && (() => {
                    const firstStep = getInitialPlanStep(msg);
                    const firstStepNum = firstStep.num;
                    const stepLabel = firstStepNum != null ? `${firstStepNum}단계` : "첫 단계";
                    const btnLabel = firstStep.name ? `승인 · ${stepLabel} (${firstStep.name}) 시작` : `승인 · ${stepLabel} 시작`;
                    return (
                      <div className="mt-2 flex gap-2 flex-wrap">
                        <button onClick={() => approvePlan(msg)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-[11px] font-semibold rounded-lg transition-colors shadow-sm">
                          <CheckCircle className="w-3.5 h-3.5" />{btnLabel}
                        </button>
                        <button onClick={cancelPlan}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-red-50 text-gray-600 hover:text-red-600 text-[11px] font-semibold rounded-lg border border-gray-200 hover:border-red-200 transition-colors">
                          <XCircle className="w-3.5 h-3.5" />취소
                        </button>
                      </div>
                    );
                  })()}

                  {/* 학습 데이터 생성·검증과 동일하게 wait 메시지에는 별도 버튼 없음 — 응답 생성 중 스피너만 표시 */}

                  {/* ── Step continue/stop buttons ───────────── */}
                  {showStepBtns && (() => {
                    const next = parseNextStepHint(msg.content);
                    const btnLabel = next ? `${next.num}단계 (${next.name}) 실행` : "다음 단계 실행";
                    return (
                      <div className="mt-2 flex gap-2 flex-wrap">
                        <button onClick={continueStep}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold rounded-lg transition-colors shadow-sm">
                          <CheckCircle className="w-3.5 h-3.5" />{btnLabel}
                        </button>
                        <button onClick={stopStep}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-red-50 text-gray-600 hover:text-red-600 text-[11px] font-semibold rounded-lg border border-gray-200 hover:border-red-200 transition-colors">
                          <XCircle className="w-3.5 h-3.5" />중단
                        </button>
                      </div>
                    );
                  })()}

                  {/* ── Decision badge after approval/cancel ─── */}
                  {(msg.isPlan || msg.isStepConfirm) && !isPending && (
                    <div className={`mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      msg.approved ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                      {msg.approved ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                      {msg.approved
                        ? (msg.isPlan ? "승인됨" : "계속됨")
                        : (msg.isPlan ? "취소됨" : "중단됨")}
                    </div>
                  )}

                  <div className={`flex items-center gap-1 mt-0.5 px-1 ${msg.role === "user" ? "justify-end" : ""}`}>
                    <span className="text-[10px] text-gray-400">
                      {msg.ts.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {msg.elapsedMs !== undefined && msg.role === "assistant" && (
                      <span className="text-[10px] text-gray-400">· ⏱ {msg.elapsedMs < 60000 ? `${(msg.elapsedMs/1000).toFixed(1)}s` : `${Math.floor(msg.elapsedMs/60000)}m ${Math.round((msg.elapsedMs%60000)/1000)}s`}</span>
                    )}
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <span className="text-[10px] text-blue-400">· 🔧 {msg.toolCalls.length}개 도구</span>
                    )}
                    {msg.isPlan && <span className="text-[10px] text-amber-500">· 📋 계획</span>}
                    {msg.isStepConfirm && <span className="text-[10px] text-blue-500">· ▶ 단계 완료</span>}
                    {msg.role === "assistant" && (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(msg.content);
                          setCopiedIdx(idx);
                          setTimeout(() => setCopiedIdx(null), 2000);
                        }}
                        className="ml-0.5 p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                        title="복사"
                      >
                        {copiedIdx === idx ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                      </button>
                    )}
                  </div>
                </div>
              </div>
              );
            })}

            {(sending || backgroundWait) && (
              <div className="flex gap-2">
                <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-3 h-3 text-gray-600" />
                </div>
                <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-3 py-2 flex items-center gap-2">
                  <Loader className="w-3 h-3 text-gray-400 animate-spin" />
                  <span className="text-[11px] text-gray-400">
                    {backgroundWait
                      ? `${LOADING_STAGES[loadingStageIdx]} · ${backgroundWait.label}`
                      : isAgentMode ? LOADING_STAGES[loadingStageIdx] : "응답 생성 중"}
                    {sendingElapsed > 0 && !backgroundWait && <span className="ml-1 font-mono">({sendingElapsed}s)</span>}
                    {backgroundWait && (
                      <span className="ml-1 font-mono">
                        ({Math.max(0, Math.floor((Date.now() - backgroundWait.startedAt) / 1000))}s)
                      </span>
                    )}
                  </span>
                </div>
              </div>
            )}
            {error && !sending && (
              <p className="text-[11px] text-red-500 bg-red-50 px-3 py-1.5 rounded-lg text-center">{error}</p>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Drag divider between messages and input */}
          <div
            onMouseDown={startInputResize}
            className="h-1.5 flex-shrink-0 cursor-row-resize bg-gray-100 hover:bg-blue-400 transition-colors flex items-center justify-center group"
            title="드래그하여 입력창 크기 조절"
          >
            <div className="w-8 h-0.5 bg-gray-400 group-hover:bg-white rounded-full" />
          </div>

          {/* Input */}
          <div
            className="border-t border-gray-100 px-3 pt-2 pb-2 flex-shrink-0 flex flex-col gap-1.5"
            style={{ height: chatInputH }}
          >
            {/* 처리 중 배너 */}
            {sending && (
              <div className="flex items-center justify-between bg-orange-50 border border-orange-200 rounded-lg px-3 py-1.5 flex-shrink-0">
                <div className="flex items-center gap-1.5 text-[11px] text-orange-700">
                  <Loader className="w-3 h-3 animate-spin" />
                  에이전트 처리 중...
                </div>
                <button onClick={forceStop}
                  className="flex items-center gap-1 text-[11px] font-semibold text-red-600 hover:text-red-800 transition-colors">
                  <Square className="w-3 h-3" />중단
                </button>
              </div>
            )}

            {/* ── 파일 업로드 ── */}
            <input ref={fileInputRef} type="file" accept=".pdf,.docx,.hwp,.txt,.md" className="hidden" onChange={handleFileUpload} />
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingFile || sending}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] border transition-colors ${
                  uploadedDoc ? "border-blue-300 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600"
                } disabled:opacity-50`}
              >
                {uploadingFile
                  ? <><Loader className="w-3 h-3 animate-spin" />처리 중...</>
                  : <><Paperclip className="w-3 h-3" />문서 첨부</>}
              </button>
              {uploadedDoc && (
                <span className="flex items-center gap-1 text-[11px] text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1 max-w-[140px]">
                  <span className="truncate">{uploadedDoc.name}</span>
                  <button onClick={() => setUploadedDoc(null)} className="flex-shrink-0"><XIcon className="w-2.5 h-2.5" /></button>
                </span>
              )}
            </div>

            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                sending
                  ? "처리 중... (중단하려면 위 버튼을 누르세요)"
                  : !modelReady
                    ? mode === "local" ? "로컬 모델을 선택해주세요" : "AI를 선택해주세요 (↺ 재연결)"
                    : hasAnyPending
                      ? "위 버튼으로 승인하거나, 여기에 수정 사항을 입력하세요"
                      : isAgentMode
                        ? "요청을 입력하면 계획을 먼저 수립합니다 (Enter)"
                        : "메시지 입력... (Enter 전송)"
              }
              disabled={sending}
              className="flex-1 min-h-0 w-full rounded-xl border border-gray-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400 resize-none"
            />
            <div className="flex gap-2 flex-shrink-0">
              {isAgentMode && (
                <button
                  onClick={() => setAutoExec(v => !v)}
                  title={autoExec ? "자율 실행 모드 ON — 클릭하여 계획 모드로 전환" : "계획 모드 — 클릭하여 자율 실행 모드로 전환"}
                  className={`flex-shrink-0 px-2.5 py-1.5 rounded-xl text-[11px] font-medium border transition-colors ${
                    autoExec
                      ? "bg-green-600 text-white border-green-600"
                      : "bg-white text-gray-500 border-gray-200 hover:border-blue-300 hover:text-blue-600"
                  }`}
                >
                  {autoExec ? "⚡ 자율" : "📋 계획"}
                </button>
              )}
              <button
                onClick={handleSend}
                disabled={!input.trim() || sending}
                className="flex-1 py-1.5 text-white rounded-xl text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 transition-colors bg-blue-600 hover:bg-blue-700"
              >
                <Send className="w-3 h-3" />{autoExec && isAgentMode ? "실행하기" : "전송하기"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
};

export default AgentChat;
