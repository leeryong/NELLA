import React, { useEffect, useState, useCallback, useRef } from "react";
import { useAgentPolling } from "../hooks/useAgentPolling";
import {
  Download, CheckCircle, Search, Cpu, Trash2, MessageSquare,
  AlertTriangle, TrendingUp, Star, ArrowDownUp, RefreshCw, Clock, X,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

const OWNED_PATH = "/models";
import { modelsApi, ModelInfo, ModelRecord, HFModelInfo } from "../services/api";
import { emitPipelineEvent } from "../pipelineEvent";
import PageHelp from "../components/PageHelp";

// ── Download progress types ──────────────────────────────────────────────────
interface DownloadProgress {
  model_id: string;
  model_name: string;
  status: "idle" | "preparing" | "downloading" | "completed" | "failed" | "cancelled" | "cancelling";
  percent: number;
  downloaded_str: string;
  total_str: string | null;
  files_total: number;
  error: string | null;
}

// ── Download Progress Panel ──────────────────────────────────────────────────
const DownloadProgressPanel: React.FC<{
  items: DownloadProgress[];
  onDismiss: (modelId: string) => void;
  onCancel: (modelId: string) => void;
}> = ({ items, onDismiss, onCancel }) => {
  if (items.length === 0) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 w-80">
      {items.map((item) => {
        const isDone = item.status === "completed" || item.status === "failed" || item.status === "cancelled";
        const isCancelling = item.status === "cancelling";
        return (
          <div key={item.model_id}
            className={`rounded-xl border shadow-lg p-4 bg-white ${
              item.status === "completed" ? "border-green-300"
              : item.status === "failed"   ? "border-red-300"
              : item.status === "cancelled" || isCancelling ? "border-gray-300"
              : "border-blue-300"
            }`}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-800 truncate">{item.model_name}</p>
                <p className="text-xs text-gray-400 font-mono truncate">{item.model_id}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {/* Cancel button — only while downloading */}
                {(item.status === "downloading") && (
                  <button
                    onClick={() => onCancel(item.model_id)}
                    title="다운로드 취소"
                    className="flex items-center gap-1 px-2 py-0.5 text-xs text-red-500 border border-red-200 rounded hover:bg-red-50 transition-colors"
                  >
                    <X className="w-3 h-3" />취소
                  </button>
                )}
                {isDone && (
                  <button onClick={() => onDismiss(item.model_id)} className="text-gray-400 hover:text-gray-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Progress bar — preparing 단계도 함께 표시 (백엔드 placeholder ↔ 실제 시작 사이 화면 빈 구간 방지) */}
            {(item.status === "downloading" || item.status === "preparing" || isCancelling) && (
              <>
                <div className="w-full bg-gray-100 rounded-full h-2 mb-1.5">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${isCancelling ? "bg-gray-400" : item.status === "preparing" ? "bg-blue-300 animate-pulse" : "bg-blue-500"}`}
                    style={{ width: `${item.percent || 2}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>{isCancelling ? "취소 중..." : item.status === "preparing" ? "다운로드 준비 중..." : `${item.percent}%`}</span>
                  <span>
                    {item.downloaded_str}
                    {item.total_str ? ` / ${item.total_str}` : ""}
                  </span>
                </div>
              </>
            )}

            {item.status === "completed" && (
              <div className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
                <CheckCircle className="w-3.5 h-3.5" />
                다운로드 완료
              </div>
            )}

            {item.status === "cancelled" && (
              <div className="text-xs text-gray-500">취소됨 — 부분 파일 삭제 완료</div>
            )}

            {item.status === "failed" && (
              <div className="text-xs text-red-600">
                <span className="font-medium">실패:</span> {item.error || "원인 미상 — 백엔드 로그 또는 /api/models/download-status/{model_id}로 상태 확인 필요"}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

const InlineDownloadProgress: React.FC<{ progress?: DownloadProgress }> = ({ progress }) => {
  if (!progress || ["completed", "failed", "cancelled"].includes(progress.status)) return null;
  const label =
    progress.status === "preparing" ? "다운로드 준비 중" :
    progress.status === "cancelling" ? "취소 중" :
    "다운로드 중";
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[11px] text-blue-600 mb-1">
        <span>{label}</span>
        <span className="font-mono tabular-nums">{progress.percent}%</span>
      </div>
      <div className="w-full bg-blue-50 rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-1.5 rounded-full transition-all duration-500 ${progress.status === "preparing" ? "bg-blue-300 animate-pulse" : "bg-blue-500"}`}
          style={{ width: `${Math.max(2, Math.min(100, progress.percent))}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] text-gray-400 truncate">
        {progress.downloaded_str}{progress.total_str ? ` / ${progress.total_str}` : ""}
      </p>
    </div>
  );
};

const FALLBACK_MODELS: ModelInfo[] = [
  {
    hf_model_id: "Qwen/Qwen2.5-0.5B-Instruct",
    name: "Qwen2.5 0.5B Instruct",
    description: "경량 연구/PoC용 지시따르기 베이스 모델",
    parameter_count: "0.5B", size_category: "tiny", download_size_gb: 0.9,
    tags: ["SFT", "Instruct"], license: "Apache 2.0", is_downloaded: false,
  },
  {
    hf_model_id: "Qwen/Qwen2.5-1.5B-Instruct",
    name: "Qwen2.5 1.5B Instruct",
    description: "Alibaba Qwen2.5 1.5B instruction-tuned.",
    parameter_count: "1.5B", size_category: "tiny", download_size_gb: 3.0,
    tags: ["qwen", "instruct", "multilingual"], is_downloaded: false,
  },
  {
    hf_model_id: "meta-llama/Llama-3.2-3B-Instruct",
    name: "Llama 3.2 3B Instruct",
    description: "Meta Llama 3.2 3B instruct. HF 토큰 필요.",
    parameter_count: "3B", size_category: "small", download_size_gb: 6.0,
    tags: ["llama", "meta", "instruct"], is_downloaded: false,
  },
  {
    hf_model_id: "microsoft/phi-3-mini-4k-instruct",
    name: "Phi-3-mini-4k-instruct",
    description: "Microsoft Phi-3 mini 3.8B. 소형치고 높은 성능.",
    parameter_count: "3.8B", size_category: "small", download_size_gb: 7.6,
    tags: ["phi", "microsoft", "instruct"], is_downloaded: false,
  },
  {
    hf_model_id: "google/gemma-2-2b-it",
    name: "Gemma-2-2B-it",
    description: "Google Gemma 2 2B instruction-tuned.",
    parameter_count: "2B", size_category: "small", download_size_gb: 5.0,
    tags: ["gemma", "google", "instruct"], is_downloaded: false,
  },
  {
    hf_model_id: "mistralai/Mistral-7B-Instruct-v0.3",
    name: "Mistral-7B-Instruct-v0.3",
    description: "Mistral 7B instruct v0.3. 파인튜닝 업계 표준.",
    parameter_count: "7B", size_category: "medium", download_size_gb: 14.0,
    tags: ["mistral", "instruct", "popular"], is_downloaded: false,
  },
  {
    hf_model_id: "Qwen/Qwen2.5-7B-Instruct",
    name: "Qwen2.5-7B-Instruct",
    description: "Qwen2.5 7B instruct. 다국어 성능 우수.",
    parameter_count: "7B", size_category: "medium", download_size_gb: 15.0,
    tags: ["qwen", "instruct", "multilingual"], is_downloaded: false,
  },
  {
    hf_model_id: "HuggingFaceTB/SmolLM2-1.7B-Instruct",
    name: "SmolLM2-1.7B-Instruct",
    description: "HuggingFace SmolLM2 1.7B. 경량 고효율.",
    parameter_count: "1.7B", size_category: "tiny", download_size_gb: 3.4,
    tags: ["smollm", "huggingface", "instruct"], is_downloaded: false,
  },
];

type SortKey = "downloads" | "likes" | "lastModified_desc" | "lastModified_asc" | "size_asc" | "size_desc";
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "downloads",         label: "인기순 (다운로드)" },
  { value: "likes",             label: "좋아요순" },
  { value: "lastModified_desc", label: "최신 업데이트순" },
  { value: "lastModified_asc",  label: "오래된 순" },
  { value: "size_asc",          label: "크기: 작은 순" },
  { value: "size_desc",         label: "크기: 큰 순" },
];
// size_asc / size_desc are client-side only — fall back to downloads for the API call
function sortKeyToParams(k: SortKey): { sort: "downloads"|"likes"|"lastModified"; direction: -1|1 } {
  if (k === "downloads")         return { sort: "downloads",    direction: -1 };
  if (k === "likes")             return { sort: "likes",        direction: -1 };
  if (k === "lastModified_desc") return { sort: "lastModified", direction: -1 };
  if (k === "lastModified_asc")  return { sort: "lastModified", direction:  1 };
  return                                { sort: "downloads",    direction: -1 };  // size_* → fetch by downloads
}
function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n/1_000).toFixed(0)}K`;
  return String(n);
}
function fmtDate(s?: string|null) {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("ko-KR", { year:"numeric", month:"short", day:"numeric" });
}

type Tab = "curated" | "hf";
const sizeLabels: Record<string,string> = { tiny:"< 2B", small:"2-7B", medium:"7-13B", unknown:"?" };
const AGENT_TOOL_RESULT_EVENT = "nella-agent-tool-result";
const AGENT_DOWNLOAD_STARTED_EVENT = "nella-agent-download-started";
const AGENT_DOWNLOAD_COMPLETED_EVENT = "nella-agent-download-completed";
const SS_AGENT_PENDING_DOWNLOADS = "nella.agent.pendingDownloads";

const ModelSelection: React.FC = () => {
  const navigate = useNavigate();
  const pageActive = useLocation().pathname === OWNED_PATH;
  const [tab, setTab] = useState<Tab>("curated");

  // Curated
  const [curatedModels, setCuratedModels]   = useState<ModelInfo[]>([]);
  const [curatedLoading, setCuratedLoading] = useState(true);
  const [curatedFilter, setCuratedFilter]   = useState({ size: "", search: "", sort: "" });

  // HF Hub
  const [hfModels, setHfModels]       = useState<HFModelInfo[]>([]);
  const [hfLoading, setHfLoading]     = useState(false);
  const [hfFetched, setHfFetched]     = useState(false);
  const [hfSort, setHfSort]           = useState<SortKey>("downloads");
  const [hfSearch, setHfSearch]       = useState("");
  const [hfLastFetched, setHfLastFetched] = useState<Date|null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>|null>(null);

  // Shared
  const [downloadedModels, setDownloadedModels] = useState<ModelRecord[]>([]);
  const [downloadedLoaded, setDownloadedLoaded] = useState(false);
  const [downloading, setDownloading]   = useState<string|null>(null);
  const [deletingId, setDeletingId]     = useState<number|null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ModelRecord|null>(null);
  const [localSearch, setLocalSearch]   = useState("");
  const [deletingAll, setDeletingAll]   = useState(false);
  const [message, setMessage]           = useState<{ text:string; type:"info"|"error"|"success" }|null>(null);

  // Download progress tracking
  const [dlProgress, setDlProgress] = useState<DownloadProgress[]>([]);
  const pollRefs = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const emittedDownloadEventsRef = useRef<Set<string>>(new Set());
  const agentDownloadIdsRef = useRef<Set<string>>(new Set());
  const emptyDownloadedPolls = useRef(0);

  const clearPendingDownload = useCallback((modelId: string) => {
    try {
      const pending = JSON.parse(window.sessionStorage.getItem(SS_AGENT_PENDING_DOWNLOADS) || "[]") as Array<{ model_id?: string }>;
      window.sessionStorage.setItem(
        SS_AGENT_PENDING_DOWNLOADS,
        JSON.stringify(pending.filter((item) => item.model_id !== modelId))
      );
    } catch { /* ignore */ }
  }, []);

  const startPolling = useCallback((modelId: string, modelName: string) => {
    if (pollRefs.current[modelId]) return;
    setDlProgress((prev) => [
      ...prev.filter((p) => p.model_id !== modelId),
      { model_id: modelId, model_name: modelName, status: "preparing",
        percent: 0, downloaded_str: "0 B", total_str: null, files_total: 0, error: null },
    ]);
    const pollOnce = async () => {
      try {
        const res = await modelsApi.downloadStatus(modelId);
        const d = res.data;
        // idle/preparing 단계도 진행 중으로 간주해 폴링을 계속하되, 화면엔 별도 "preparing" 상태로 표시.
        const normalizedStatus =
          d.status === "idle" ? "preparing" :
          d.status === "preparing" ? "preparing" :
          d.status;
        setDlProgress((prev) =>
          prev.map((p) => p.model_id === modelId
            ? { ...p, status: normalizedStatus, percent: Math.max(p.percent ?? 0, d.percent ?? 0),
                downloaded_str: d.downloaded_str, total_str: d.total_str,
                files_total: d.files_total, error: d.error }
            : p
          )
        );
        if (d.status === "completed" || d.status === "failed" || d.status === "cancelled") {
          clearInterval(pollRefs.current[modelId]);
          delete pollRefs.current[modelId];
          clearPendingDownload(modelId);
          if (d.status === "completed") {
            const eventKey = `${modelId}:completed`;
            if (!emittedDownloadEventsRef.current.has(eventKey)) {
              emittedDownloadEventsRef.current.add(eventKey);
              emitPipelineEvent({ kind: "complete", label: "⬇️ 모델 다운로드 완료", detail: modelName });
              window.dispatchEvent(new CustomEvent(AGENT_DOWNLOAD_COMPLETED_EVENT, {
                detail: { model_id: modelId, name: modelName, agent_initiated: agentDownloadIdsRef.current.has(modelId), ts: Date.now() },
              }));
            }
            loadCurated(); loadDownloaded();
          } else if (d.status === "failed") {
            const eventKey = `${modelId}:failed`;
            if (!emittedDownloadEventsRef.current.has(eventKey)) {
              emittedDownloadEventsRef.current.add(eventKey);
              emitPipelineEvent({ kind: "failed", label: "⬇️ 모델 다운로드 실패", detail: modelName });
            }
          }
        }
      } catch { /* ignore */ }
    };
    void pollOnce();
    pollRefs.current[modelId] = setInterval(pollOnce, 1000);
  }, [clearPendingDownload]); // eslint-disable-line react-hooks/exhaustive-deps

  const showDownloadStatus = useCallback((modelId: string, modelName: string, status: DownloadProgress["status"], error?: string | null) => {
    setDlProgress((prev) => [
      ...prev.filter((p) => p.model_id !== modelId),
      {
        model_id: modelId,
        model_name: modelName,
        status,
        percent: status === "completed" ? 100 : 0,
        downloaded_str: "0 B",
        total_str: null,
        files_total: 0,
        error: error ?? null,
      },
    ]);
  }, []);

  const dismissProgress = useCallback((modelId: string) => {
    setDlProgress((prev) => prev.filter((p) => p.model_id !== modelId));
  }, []);

  useEffect(() => {
    const finished = dlProgress.filter((p) => ["completed", "failed", "cancelled"].includes(p.status));
    if (finished.length === 0) return;
    const timers = finished.map((item) => window.setTimeout(() => dismissProgress(item.model_id), 3000));
    return () => timers.forEach(window.clearTimeout);
  }, [dlProgress, dismissProgress]);

  const cancelDownload = useCallback(async (modelId: string) => {
    emitPipelineEvent({ kind: "cancel", label: "⬇️ 모델 다운로드 취소", detail: modelId.split("/").pop() ?? modelId });
    setDlProgress((prev) =>
      prev.map((p) => p.model_id === modelId ? { ...p, status: "cancelling" } : p)
    );
    try {
      await modelsApi.cancelDownload(modelId);
    } catch { /* ignore — polling will pick up the cancelled status */ }
  }, []);

  useEffect(() => () => { Object.values(pollRefs.current).forEach(clearInterval); }, []);

  // ── Loaders ────────────────────────────────────────────────────────────────
  const [allCuratedModels, setAllCuratedModels] = useState<ModelInfo[]>([]);

  const loadCurated = useCallback(async () => {
    setCuratedLoading((prev) => allCuratedModels.length === 0 ? true : prev);
    try {
      const res = await modelsApi.listCurated();
      const models = res.data?.length ? res.data : FALLBACK_MODELS;
      setAllCuratedModels((prev) => {
        const prevKey = prev.map((m) => `${m.hf_model_id}:${m.is_downloaded ? 1 : 0}`).join("|");
        const nextKey = models.map((m) => `${m.hf_model_id}:${m.is_downloaded ? 1 : 0}`).join("|");
        return prevKey === nextKey ? prev : models;
      });
    } catch {
      if (allCuratedModels.length === 0) {
        setAllCuratedModels(FALLBACK_MODELS);
        setCuratedModels(FALLBACK_MODELS);
      }
    } finally {
      setCuratedLoading(false);
    }
  }, [allCuratedModels.length]);

  // Parse "0.5B", "7B", "13B" etc. → number (in billions) for sorting
  const parseParamCount = (s: string): number => {
    const m = s.match(/([\d.]+)\s*([BMK]?)/i);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    const unit = (m[2] || "").toUpperCase();
    if (unit === "B") return n;
    if (unit === "M") return n / 1000;
    if (unit === "K") return n / 1_000_000;
    return n;
  };

  // Client-side filter — instant, no API call
  useEffect(() => {
    let filtered = [...allCuratedModels];
    if (curatedFilter.size) filtered = filtered.filter((m) => m.size_category === curatedFilter.size);
    if (curatedFilter.search) {
      const q = curatedFilter.search.toLowerCase();
      filtered = filtered.filter((m) =>
        m.name.toLowerCase().includes(q) || m.hf_model_id.toLowerCase().includes(q) ||
        (m.description ?? "").toLowerCase().includes(q)
      );
    }
    if (curatedFilter.sort === "size_asc") {
      filtered.sort((a, b) => parseParamCount(a.parameter_count) - parseParamCount(b.parameter_count));
    } else if (curatedFilter.sort === "size_desc") {
      filtered.sort((a, b) => parseParamCount(b.parameter_count) - parseParamCount(a.parameter_count));
    }
    setCuratedModels((prev) => {
      const prevKey = prev.map((m) => `${m.hf_model_id}:${m.is_downloaded ? 1 : 0}`).join("|");
      const nextKey = filtered.map((m) => `${m.hf_model_id}:${m.is_downloaded ? 1 : 0}`).join("|");
      return prevKey === nextKey ? prev : filtered;
    });
  }, [curatedFilter, allCuratedModels]);

  useEffect(() => {
    if (allCuratedModels.length === 0) return;
    let cancelled = false;
    const syncActiveDownloads = async () => {
      await Promise.all(allCuratedModels.map(async (model) => {
        try {
          const res = await modelsApi.downloadStatus(model.hf_model_id);
          if (!cancelled && res.data.status === "downloading") {
            startPolling(model.hf_model_id, model.name);
          }
        } catch { /* ignore */ }
      }));
    };
    void syncActiveDownloads();
    return () => { cancelled = true; };
  }, [allCuratedModels, startPolling]);

  const loadDownloaded = useCallback(async () => {
    try {
      const res = await modelsApi.listDownloaded();
      const next = res.data || [];
      setDownloadedModels((prev) => {
        if (next.length === 0 && prev.length > 0) {
          emptyDownloadedPolls.current += 1;
          if (emptyDownloadedPolls.current < 3) return prev;
        } else {
          emptyDownloadedPolls.current = 0;
        }
        const prevKey = prev.map((m) => `${m.id}:${m.hf_model_id}:${m.local_path ?? ""}`).join("|");
        const nextKey = next.map((m) => `${m.id}:${m.hf_model_id}:${m.local_path ?? ""}`).join("|");
        return prevKey === nextKey ? prev : next;
      });
      setDownloadedLoaded(true);
    } catch {
      setDownloadedLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!pageActive) return;
    const consumePendingDownloads = () => {
      try {
        const pending = JSON.parse(window.sessionStorage.getItem(SS_AGENT_PENDING_DOWNLOADS) || "[]") as Array<{ model_id?: string; name?: string; ts?: number }>;
        const remaining: typeof pending = [];
        for (const item of pending) {
          if (!item.model_id || !item.ts) continue;
          if (Date.now() - item.ts > 10 * 60_000) continue;
          agentDownloadIdsRef.current.add(item.model_id);
          startPolling(item.model_id, item.name || item.model_id.split("/").pop() || item.model_id);
        }
        window.sessionStorage.setItem(SS_AGENT_PENDING_DOWNLOADS, JSON.stringify(remaining));
      } catch { /* ignore */ }
    };

    const handleAgentDownload = (detail: { name?: string; args?: Record<string, unknown>; result?: Record<string, unknown> }) => {
      if (detail.name === "download_compatible_models" && Array.isArray(detail.result?.downloads)) {
        for (const item of detail.result.downloads as Array<Record<string, unknown>>) {
          const modelId = String(item.model_id ?? "");
          if (modelId) {
            agentDownloadIdsRef.current.add(modelId);
            startPolling(modelId, String(item.name ?? modelId.split("/").pop() ?? modelId));
          }
        }
        return;
      }
      if (detail.name !== "download_model" && detail.name !== "wait_for_model_download") return;
      const result = detail.result ?? {};
      const modelId = String(result.model_id ?? detail.args?.model_id ?? "");
      if (!modelId) return;
      const modelName = modelId.split("/").pop() || modelId;
      const status = String(result.status ?? "");
      if (status === "downloading" || status === "in_progress") {
        agentDownloadIdsRef.current.add(modelId);
        startPolling(modelId, modelName);
      } else if (status === "completed" || status === "already_downloaded") {
        showDownloadStatus(modelId, modelName, "completed");
        window.dispatchEvent(new CustomEvent(AGENT_DOWNLOAD_COMPLETED_EVENT, {
          detail: { model_id: modelId, name: modelName, agent_initiated: true, ts: Date.now(), already_downloaded: status === "already_downloaded" },
        }));
        void loadCurated();
        void loadDownloaded();
      } else if (status === "failed" || status === "error") {
        showDownloadStatus(modelId, modelName, "failed", String(result.error ?? result.message ?? "다운로드 실패"));
      }
    };

    const onAgentResult = (event: Event) => {
      handleAgentDownload((event as CustomEvent<{ name?: string; args?: Record<string, unknown>; result?: Record<string, unknown> }>).detail);
    };
    const onAgentDownloadStarted = (event: Event) => {
      const detail = (event as CustomEvent<{ model_id?: string; name?: string }>).detail;
      if (!detail?.model_id) return;
      agentDownloadIdsRef.current.add(detail.model_id);
      startPolling(detail.model_id, detail.name || detail.model_id.split("/").pop() || detail.model_id);
      clearPendingDownload(detail.model_id);
    };
    const onAgentNavigate = () => consumePendingDownloads();
    window.addEventListener(AGENT_TOOL_RESULT_EVENT, onAgentResult);
    window.addEventListener(AGENT_DOWNLOAD_STARTED_EVENT, onAgentDownloadStarted);
    window.addEventListener("agent-navigate", onAgentNavigate);
    try {
      consumePendingDownloads();
      const stored = window.sessionStorage.getItem("nella.agent.lastToolResult");
      if (stored) {
        const parsed = JSON.parse(stored) as { name?: string; args?: Record<string, unknown>; result?: Record<string, unknown>; ts?: number };
        if (parsed.ts && Date.now() - parsed.ts < 10 * 60_000) handleAgentDownload(parsed);
      }
    } catch { /* ignore */ }

    // NELLA가 페이지 mount 전/후에 download_model을 호출하는 race를 모두 처리하도록
    // 1) mount 직후 + 2) 2초 주기 폴링으로 새 활성 다운로드를 감지해 startPolling을 시작한다.
    // (LLM 응답 완료 후가 아니라 백엔드가 다운로드를 실제로 시작한 즉시 진행률이 화면에 보임)
    const fetchActive = () => {
      void modelsApi.activeDownloads().then((res) => {
        for (const item of res.data) {
          if (!item.model_id) continue;
          // startPolling은 이미 폴링 중인 model_id면 noop. 자동 dedupe.
          startPolling(item.model_id, item.model_id.split("/").pop() || item.model_id);
        }
      }).catch(() => { /* ignore */ });
    };
    fetchActive();
    const activeDownloadsTimer = window.setInterval(fetchActive, 2000);
    return () => {
      window.clearInterval(activeDownloadsTimer);
      window.removeEventListener(AGENT_TOOL_RESULT_EVENT, onAgentResult);
      window.removeEventListener(AGENT_DOWNLOAD_STARTED_EVENT, onAgentDownloadStarted);
      window.removeEventListener("agent-navigate", onAgentNavigate);
    };
  }, [pageActive, clearPendingDownload, loadCurated, loadDownloaded, showDownloadStatus, startPolling]);

  const fetchHF = useCallback(async (searchQuery: string, sortKey: SortKey) => {
    setHfLoading(true);
    const { sort, direction } = sortKeyToParams(sortKey);
    try {
      const res = await modelsApi.trending({
        max_results: 50, sort, direction,
        search: searchQuery.trim() || undefined,
      });
      const next = res.data.results || [];
      setHfModels((prev) => {
        const prevKey = prev.map((m) => `${m.hf_model_id}:${m.is_downloaded ? 1 : 0}`).join("|");
        const nextKey = next.map((m) => `${m.hf_model_id}:${m.is_downloaded ? 1 : 0}`).join("|");
        return prevKey === nextKey ? prev : next;
      });
      setHfFetched(true);
      setHfLastFetched(new Date());
    } catch {
      setHfModels((prev) => prev);
    }
    finally { setHfLoading(false); }
  }, []);

  // Initial curated load + agent-driven refresh
  useAgentPolling(loadCurated, { idle: 30_000, active: 3_000, enabled: pageActive });
  useAgentPolling(loadDownloaded, { idle: 15_000, active: 2_000, enabled: pageActive });

  // Auto-load HF once when tab first opens
  useEffect(() => {
    if (tab === "hf" && !hfFetched) fetchHF("", hfSort);
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch when sort changes (HF tab, no search) — skip for client-side size sorts
  useEffect(() => {
    if (tab === "hf" && hfFetched && !hfSearch.trim() && hfSort !== "size_asc" && hfSort !== "size_desc") {
      fetchHF("", hfSort);
    }
  }, [hfSort]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search on HF tab
  useEffect(() => {
    if (tab !== "hf") return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => fetchHF(hfSearch, hfSort), 600);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [hfSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync HF models' is_downloaded flag whenever the local downloaded list changes
  useEffect(() => {
    if (hfModels.length === 0) return;
    const downloadedIds = new Set(downloadedModels.map((m) => m.hf_model_id));
    setHfModels((prev) => {
      let changed = false;
      const next = prev.map((m) => {
        const isDownloaded = downloadedIds.has(m.hf_model_id);
        if (m.is_downloaded !== isDownloaded) changed = true;
        return changed ? { ...m, is_downloaded: isDownloaded } : m;
      });
      return changed ? next : prev;
    });
  }, [downloadedModels]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ────────────────────────────────────────────────────────────────
  const handleDownload = async (modelId: string, modelName?: string) => {
    setDownloading(modelId); setMessage(null);
    const displayName = modelName || modelId.split("/").pop() || modelId;
    emitPipelineEvent({ kind: "start", label: "⬇️ 모델 다운로드 시작", detail: displayName });
    try {
      const res = await modelsApi.download(modelId);
      if (res.data.status === "already_downloaded") {
        emitPipelineEvent({ kind: "complete", label: "⬇️ 모델 이미 다운로드됨", detail: displayName });
        setMessage({ text: res.data.message, type: "success" });
        await loadCurated();
        await loadDownloaded();
        setTimeout(() => setMessage(null), 3000);
      } else {
        startPolling(modelId, displayName);
      }
    } catch {
      emitPipelineEvent({ kind: "failed", label: "⬇️ 모델 다운로드 실패", detail: displayName });
      setMessage({ text: "Download failed", type: "error" });
    }
    finally { setDownloading(null); }
  };

  const handleDeleteConfirm = async () => {
    if (!confirmDelete) return;
    setDeletingId(confirmDelete.id); setConfirmDelete(null);
    try {
      const res = await modelsApi.deleteModel(confirmDelete.id, true);
      setMessage({ text: res.data.message, type: "success" });
      setDownloadedModels((prev) => prev.filter((m) => m.id !== confirmDelete.id));
      await loadDownloaded(); await loadCurated();
    } catch { setMessage({ text: "Failed to delete model", type: "error" }); }
    finally { setDeletingId(null); }
  };

  const handleDeleteAllDownloaded = async () => {
    if (!confirm(`로컬 저장된 모델 ${downloadedModels.length}개를 모두 삭제하시겠습니까?\n저장된 파일도 함께 삭제됩니다.`)) return;
    setDeletingAll(true);
    try {
      const res = await modelsApi.deleteAllDownloaded(true);
      setMessage({ text: res.data.message, type: "success" });
      emptyDownloadedPolls.current = 3;
      setDownloadedModels([]);
      await loadDownloaded(); await loadCurated();
    } catch { setMessage({ text: "전체 삭제 실패", type: "error" }); }
    finally { setDeletingAll(false); }
  };

  const msgBg = { info:"bg-blue-50 border-blue-200 text-blue-700", error:"bg-red-50 border-red-200 text-red-700", success:"bg-green-50 border-green-200 text-green-700" };

  const DownloadBtn = ({ modelId, modelName, isDownloaded }: { modelId:string; modelName:string; isDownloaded:boolean }) => {
    const inProgress = dlProgress.find((p) => p.model_id === modelId && ["preparing", "downloading", "cancelling"].includes(p.status));
    const isActive   = downloading === modelId || !!inProgress;
    return (
      <button
        onClick={() => handleDownload(modelId, modelName)}
        disabled={isDownloaded || isActive}
        className={`flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
          isDownloaded ? "bg-green-100 text-green-700 cursor-default"
          : isActive    ? "bg-gray-100 text-gray-400 cursor-wait"
          : "bg-blue-600 text-white hover:bg-blue-700"
        }`}
      >
        {isDownloaded ? <><CheckCircle className="w-3 h-3"/>Ready</>
         : isActive    ? "Downloading..."
         : <><Download className="w-3 h-3"/>Download</>}
      </button>
    );
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      <div className="flex items-center gap-3">
        <span className="w-7 h-7 rounded-md bg-blue-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">4</span>
        <Cpu className="w-5 h-5 text-blue-600 flex-shrink-0" />
        <div>
          <div className="flex items-center gap-1"><h1 className="text-xl font-bold text-gray-900">기반모델 선택</h1><PageHelp pageKey="modelSelection" /></div>
          <p className="text-xs text-gray-500">HuggingFace에서 기반 모델 검색 및 다운로드</p>
        </div>
      </div>

      {/* Downloaded Models */}
      {downloadedLoaded && downloadedModels.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-500"/>
              로컬 저장된 모델 ({downloadedModels.length})
            </h2>
            <button
              onClick={handleDeleteAllDownloaded}
              disabled={deletingAll}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-50 rounded-lg border border-red-200 hover:border-red-300 transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />{deletingAll ? "삭제 중..." : "전체 삭제"}
            </button>
          </div>
          {downloadedModels.length > 3 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                type="text"
                placeholder="로컬 모델 검색..."
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {downloadedModels
              .filter((m) => !localSearch ||
                m.name.toLowerCase().includes(localSearch.toLowerCase()) ||
                m.hf_model_id.toLowerCase().includes(localSearch.toLowerCase()))
              .map((model) => (
              <div key={model.id} className="bg-green-50 border border-green-200 rounded-xl p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-green-600 flex-shrink-0"/>
                      <p className="text-sm font-medium text-gray-800 truncate">{model.name}</p>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 font-mono truncate">{model.hf_model_id}</p>
                    {model.local_path && <p className="text-xs text-gray-400 mt-0.5 truncate">{model.local_path}</p>}
                    <InlineDownloadProgress progress={dlProgress.find((p) => p.model_id === model.hf_model_id)} />
                  </div>
                  <div className="flex flex-col gap-2 flex-shrink-0">
                    <button
                      onClick={() => navigate(`/chat?model_path=${encodeURIComponent(model.local_path||"")}&model_name=${encodeURIComponent(model.name)}`)}
                      disabled={!model.local_path}
                      className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors"
                    >
                      <MessageSquare className="w-3 h-3"/>Chat
                    </button>
                    <button
                      onClick={() => setConfirmDelete(model)}
                      disabled={deletingId === model.id}
                      className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-medium hover:bg-red-100 disabled:opacity-40 transition-colors"
                    >
                      <Trash2 className="w-3 h-3"/>
                      {deletingId === model.id ? "삭제 중..." : "삭제"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {message && (
        <div className={`border rounded-lg p-3 text-sm ${msgBg[message.type]}`}>{message.text}</div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-1">
          <button
            onClick={() => setTab("curated")}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === "curated" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <Cpu className="w-4 h-4"/>큐레이션 모델
          </button>
          <button
            onClick={() => setTab("hf")}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === "hf" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <TrendingUp className="w-4 h-4"/>HuggingFace 최신 모델
          </button>
        </div>
      </div>

      {/* ── Curated Tab ─────────────────────────────────────────────────────── */}
      {tab === "curated" && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
              <input type="text" placeholder="모델 검색..."
                value={curatedFilter.search}
                onChange={(e) => setCuratedFilter({ ...curatedFilter, search: e.target.value })}
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
            </div>
            <select value={curatedFilter.size}
              onChange={(e) => setCuratedFilter({ ...curatedFilter, size: e.target.value })}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">전체 크기</option>
              <option value="tiny">소형 (&lt;2B)</option>
              <option value="small">중소형 (2-7B)</option>
              <option value="medium">중형 (7-13B)</option>
            </select>
            <select value={curatedFilter.sort}
              onChange={(e) => setCuratedFilter({ ...curatedFilter, sort: e.target.value })}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">정렬: 기본</option>
              <option value="size_asc">크기: 작은 순</option>
              <option value="size_desc">크기: 큰 순</option>
            </select>
          </div>

          {curatedLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[...Array(6)].map((_,i) => <div key={i} className="bg-gray-100 rounded-xl h-32 animate-pulse"/>)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {curatedModels.map((model) => (
                <div key={model.hf_model_id} className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Cpu className="w-4 h-4 text-blue-500 flex-shrink-0"/>
                        <p className="text-sm font-medium text-gray-800 truncate">{model.name}</p>
                        {model.is_downloaded && <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0"/>}
                      </div>
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{model.description}</p>
                      <div className="flex gap-2 mt-2 flex-wrap">
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-xs rounded">{model.parameter_count}</span>
                        <span className="px-2 py-0.5 bg-gray-50 text-gray-600 text-xs rounded">{sizeLabels[model.size_category] || model.size_category}</span>
                        {model.download_size_gb && <span className="px-2 py-0.5 bg-gray-50 text-gray-600 text-xs rounded">{model.download_size_gb}GB</span>}
                      </div>
                      <p className="text-xs text-gray-400 mt-1 font-mono truncate">{model.hf_model_id}</p>
                      <InlineDownloadProgress progress={dlProgress.find((p) => p.model_id === model.hf_model_id)} />
                    </div>
                    <DownloadBtn modelId={model.hf_model_id} modelName={model.name} isDownloaded={!!model.is_downloaded}/>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── HF Tab ──────────────────────────────────────────────────────────── */}
      {tab === "hf" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
              <input type="text" placeholder="HuggingFace 모델 검색... (예: Qwen, Llama, Mistral)"
                value={hfSearch}
                onChange={(e) => setHfSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
            </div>
            <select value={hfSort}
              onChange={(e) => { setHfSort(e.target.value as SortKey); }}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button
              onClick={() => fetchHF(hfSearch, hfSort)}
              disabled={hfLoading}
              className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
              title="리스트 업데이트"
            >
              <RefreshCw className={`w-4 h-4 ${hfLoading ? "animate-spin" : ""}`}/>
              업데이트
            </button>
          </div>

          {hfLastFetched && (
            <p className="text-xs text-gray-400 flex items-center gap-1">
              <Clock className="w-3 h-3"/>
              {hfLoading ? "업데이트 중..." : `${hfLastFetched.toLocaleTimeString("ko-KR")} 기준`} · {hfModels.length}개
              {hfSearch.trim() && <span> · "<span className="text-blue-500">{hfSearch}</span>" 검색 결과</span>}
            </p>
          )}

          {hfLoading && !hfFetched && hfModels.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[...Array(8)].map((_,i) => <div key={i} className="bg-gray-100 rounded-xl h-28 animate-pulse"/>)}
            </div>
          ) : !hfFetched ? (
            <div className="text-center py-12 text-gray-400 text-sm">불러오는 중...</div>
          ) : hfModels.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">검색 결과가 없습니다.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(hfSort === "size_asc" || hfSort === "size_desc"
                ? [...hfModels].sort((a, b) => {
                    const diff = parseParamCount(a.parameter_count) - parseParamCount(b.parameter_count);
                    return hfSort === "size_asc" ? diff : -diff;
                  })
                : hfModels
              ).map((model) => (
                <div key={model.hf_model_id} className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Cpu className="w-4 h-4 text-purple-500 flex-shrink-0"/>
                        <p className="text-sm font-medium text-gray-800 truncate">{model.name}</p>
                        {model.is_downloaded && <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0"/>}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5 font-mono truncate">{model.hf_model_id}</p>
                      <div className="flex gap-3 mt-1.5 text-xs text-gray-500">
                        {(model.downloads??0) > 0 && (
                          <span className="flex items-center gap-0.5"><ArrowDownUp className="w-3 h-3"/>{fmtNum(model.downloads!)}</span>
                        )}
                        {(model.likes??0) > 0 && (
                          <span className="flex items-center gap-0.5"><Star className="w-3 h-3"/>{fmtNum(model.likes!)}</span>
                        )}
                        {model.last_modified && (
                          <span className="flex items-center gap-0.5 text-gray-400"><Clock className="w-3 h-3"/>{fmtDate(model.last_modified)}</span>
                        )}
                      </div>
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {model.tags
                          .filter((t) => !t.startsWith("arxiv:") && !t.startsWith("base_model:") && !t.startsWith("region:") && !t.startsWith("deploy:"))
                          .slice(0, 5)
                          .map((tag) => (
                            <span key={tag} className="px-1.5 py-0.5 bg-purple-50 text-purple-600 text-xs rounded">{tag}</span>
                          ))}
                      </div>
                      <InlineDownloadProgress progress={dlProgress.find((p) => p.model_id === model.hf_model_id)} />
                    </div>
                    <DownloadBtn modelId={model.hf_model_id} modelName={model.name} isDownloaded={!!model.is_downloaded}/>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Download Progress Panel */}
      <DownloadProgressPanel items={dlProgress} onDismiss={dismissProgress} onCancel={cancelDownload} />

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-5 h-5 text-red-500"/>
              <h3 className="text-base font-semibold text-gray-900">모델 삭제</h3>
            </div>
            <p className="text-sm text-gray-600 mb-2">
              <span className="font-medium">{confirmDelete.name}</span> 모델을 삭제하시겠습니까?
            </p>
            <p className="text-xs text-gray-400 mb-6">로컬 파일도 함께 삭제됩니다. 되돌릴 수 없습니다.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">취소</button>
              <button onClick={handleDeleteConfirm} className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700">삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModelSelection;
