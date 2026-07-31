import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ShieldCheck, Filter, RefreshCw, CheckCircle, AlertCircle,
  ClipboardCheck, ThumbsUp, ThumbsDown, Minus, Database, FileJson,
  History, ChevronRight, X,
} from "lucide-react";
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";
import { useLocation } from "react-router-dom";
import { api, trainingDataApi, settingsApi, Dataset } from "../services/api";
import { useAgentPolling } from "../hooks/useAgentPolling";
import { useAgentToolResult } from "../hooks/useAgentToolResult";

const OWNED_PATH = "/data-validation";
import { emitPipelineEvent } from "../pipelineEvent";
import PageHelp from "../components/PageHelp";

type Tab = "quality" | "validate";
const AGENT_TOOL_RESULT_EVENT = "nella-agent-tool-result";
const AGENT_PAGE_START_EVENT = "nella-agent-page-start";
const SS_AGENT_ACTIVE_PAGE = "nella.agent.activePage";

// SFT 계열(QA, CoT, ToT, GoT) — DPO를 제외한 모든 지도학습 데이터 타입
const SFT_FAMILY = new Set(["sft", "sft_alpaca", "cot", "tot", "got"]);
const isSftFamily = (t: string | undefined | null) => !!t && SFT_FAMILY.has(t);

// 데이터 유형 표시 라벨·색상
const DT_LABEL: Record<string, string> = {
  sft: "QA",
  sft_alpaca: "QA",
  qa: "QA",
  cot: "CoT",
  tot: "ToT",
  got: "GoT",
  dpo: "DPO",
};
const DT_BADGE: Record<string, string> = {
  sft: "bg-blue-50 text-blue-600",
  sft_alpaca: "bg-blue-50 text-blue-600",
  qa: "bg-blue-50 text-blue-600",
  cot: "bg-emerald-50 text-emerald-600",
  tot: "bg-amber-50 text-amber-600",
  got: "bg-rose-50 text-rose-600",
  dpo: "bg-purple-50 text-purple-600",
};
const dtLabel = (t: string) => DT_LABEL[t] ?? t.toUpperCase();
const dtBadge = (t: string) => DT_BADGE[t] ?? "bg-gray-50 text-gray-600";

const ProviderButtons: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => (
  <div className="grid grid-cols-3 gap-1.5">
    {[{ id: "openai", label: "OpenAI" }, { id: "anthropic", label: "Claude" }, { id: "ollama", label: "Ollama" }].map((p) => (
      <button key={p.id} onClick={() => onChange(p.id)}
        className={`py-1.5 rounded-lg border text-xs font-medium transition-colors ${
          value === p.id ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500 hover:border-gray-300"
        }`}>
        {p.label}
      </button>
    ))}
  </div>
);

// ── 규칙 기반 검증 패널 ───────────────────────────────
const QualityFilterPanel: React.FC<{ datasets: Dataset[]; onDatasetCreated: (ds: Dataset) => void }> = ({ datasets, onDatasetCreated }) => {
  const [dataTypeFilter, setDataTypeFilter] = useState<"sft" | "dpo">("sft");
  const [datasetId, setDatasetId] = useState("");
  const autoSelectedRef = useRef(false);
  const [minLength, setMinLength] = useState(20);
  const [maxLength, setMaxLength] = useState(2000);
  const [filterDuplicates, setFilterDuplicates] = useState(true);
  const [filterLowQuality, setFilterLowQuality] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdDatasets, setCreatedDatasets] = useState<Array<{
    dataset: Dataset;
    stats: { total: number; kept: number; removed: number; reasons: string[] };
  }>>([]);
  const filterAbortRef = useRef<AbortController | null>(null);
  const processedAgentFilterRef = useRef<number | null>(null);

  useEffect(() => {
    if (autoSelectedRef.current) return;
    const sftDatasets = datasets.filter((d) => isSftFamily(d.data_type));
    if (sftDatasets.length === 0) return;
    const latest = sftDatasets.reduce((a, b) => (a.id > b.id ? a : b));
    autoSelectedRef.current = true;
    setDatasetId(String(latest.id));
  }, [datasets]);

  useEffect(() => {
    const applyAgentFilter = (result: Record<string, unknown>, ts = Date.now()) => {
      if (processedAgentFilterRef.current === ts) return;
      processedAgentFilterRef.current = ts;
      const filterResult = result.filter_result as { dataset_id?: number; dataset_name?: string; train_count?: number; test_count?: number; data_type?: string } | undefined;
      if (!filterResult?.dataset_id) return;
      const sourceId = String((result.source_dataset_id as number | string | undefined) ?? "");
      const source = datasets.find((d) => String(d.id) === sourceId);
      setDatasetId(sourceId || String(filterResult.dataset_id));
      setRunning(true);
      setError(null);
      window.setTimeout(() => {
        const filteredDataset: Dataset = {
          id: Number(filterResult.dataset_id),
          name: filterResult.dataset_name ?? `dataset_${filterResult.dataset_id}`,
          data_type: filterResult.data_type ?? source?.data_type ?? "sft",
          train_count: Number(filterResult.train_count ?? 0),
          test_count: Number(filterResult.test_count ?? 0),
          train_ratio: source?.train_ratio ?? 0.9,
          created_at: new Date().toISOString(),
        };
        const total = (source?.train_count ?? 0) + (source?.test_count ?? 0);
        const kept = filteredDataset.train_count + filteredDataset.test_count;
        setCreatedDatasets((prev) => [{
          dataset: filteredDataset,
          stats: {
            total,
            kept,
            removed: Math.max(0, total - kept),
            reasons: ["중복 항목 제거", "저품질 항목 제거", `길이 범위(${minLength}~${maxLength}자) 외 항목 제거`],
          },
        }, ...prev]);
        onDatasetCreated(filteredDataset);
        setRunning(false);
      }, 900);
    };

    const handleAgentResult = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string; result?: Record<string, unknown> }>).detail;
      if (detail?.name !== "validate_training_data" || !detail.result) return;
      applyAgentFilter(detail.result);
    };
    window.addEventListener(AGENT_TOOL_RESULT_EVENT, handleAgentResult);
    try {
      const stored = window.sessionStorage.getItem("nella.agent.lastToolResult");
      if (stored) {
        const parsed = JSON.parse(stored) as { name?: string; result?: Record<string, unknown>; ts?: number };
        if (parsed.name === "validate_training_data" && parsed.result && parsed.ts && Date.now() - parsed.ts < 10_000) {
          applyAgentFilter(parsed.result, parsed.ts);
        }
      }
    } catch { /* ignore */ }
    return () => window.removeEventListener(AGENT_TOOL_RESULT_EVENT, handleAgentResult);
  }, [datasets, maxLength, minLength, onDatasetCreated]);

  const handleRun = async () => {
    if (!datasetId) return;
    if (running) {
      filterAbortRef.current?.abort();
      setRunning(false);
      setError("규칙 기반 검증를 중단했습니다.");
      emitPipelineEvent({ kind: "cancel", label: "🔍 규칙 기반 검증 중단", detail: "사용자 요청으로 중단됨" });
      await trainingDataApi.cancelValidation(Number(datasetId)).catch(() => {});
      return;
    }
    setRunning(true); setError(null);
    const controller = new AbortController();
    filterAbortRef.current = controller;
    const ds = datasets.find((d) => String(d.id) === datasetId);
    const base = (ds?.name ?? `dataset_${datasetId}`)
      .replace(/_LLM_judge_filter$/, "")
      .replace(/_rule_based_filter$/, "")
      .replace(/_filtered$/, "");
    const newName = `${base}_rule_based_filter`;
    const reasons = [
      filterDuplicates ? "중복 항목 제거" : "",
      filterLowQuality ? "저품질 항목 제거" : "",
      `길이 범위(${minLength}~${maxLength}자) 외 항목 제거`,
    ].filter(Boolean);
    emitPipelineEvent({ kind: "start", label: "🔍 규칙 기반 검증", detail: ds?.name ?? `#${datasetId}` });
    try {
      const res = await trainingDataApi.filter(Number(datasetId), {
        min_length: minLength,
        max_length: maxLength,
        filter_duplicates: filterDuplicates,
        filter_low_quality: filterLowQuality,
        new_name: newName,
      }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const newDs = res.data;
      const total = (ds?.train_count ?? 0) + (ds?.test_count ?? 0);
      const kept = newDs.train_count + newDs.test_count;
      emitPipelineEvent({ kind: "complete", label: "🔍 규칙 기반 검증 완료", detail: `${kept}/${total}개 유지 → ${newDs.name}` });
      setCreatedDatasets((prev) => [{ dataset: newDs, stats: { total, kept, removed: total - kept, reasons } }, ...prev]);
      onDatasetCreated(newDs);
    } catch (e: unknown) {
      if ((e as { code?: string; name?: string })?.code === "ERR_CANCELED" || (e as { name?: string })?.name === "CanceledError") {
        setError("규칙 기반 검증를 중단했습니다.");
        return;
      }
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "규칙 기반 검증 실패";
      emitPipelineEvent({ kind: "failed", label: "🔍 규칙 기반 검증 실패", detail: msg });
      setError(msg);
    } finally {
      filterAbortRef.current = null;
      setRunning(false);
    }
  };

  const keepPct = (kept: number, total: number) => total > 0 ? Math.round(kept / total * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-purple-500" />
          <h3 className="text-sm font-semibold text-gray-700">규칙 기반 검증 설정</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">데이터 유형</label>
            <div className="grid grid-cols-2 gap-1.5">
              {([["sft", "SFT", "QA · CoT · ToT · GoT"], ["dpo", "DPO", "선호도 학습 데이터"]] as const).map(([val, label, sub]) => (
                <button key={val} onClick={() => { setDataTypeFilter(val); setDatasetId(""); }}
                  className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                    dataTypeFilter === val
                      ? val === "sft" ? "border-blue-500 bg-blue-50" : "border-purple-500 bg-purple-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}>
                  <p className={`font-semibold ${dataTypeFilter === val ? (val === "sft" ? "text-blue-700" : "text-purple-700") : "text-gray-600"}`}>{label}</p>
                  <p className="text-gray-400">{sub}</p>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">대상 데이터셋</label>
            <select value={datasetId} onChange={(e) => setDatasetId(e.target.value)}
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">데이터셋 선택...</option>
              {datasets.filter((d) => dataTypeFilter === "sft" ? isSftFamily(d.data_type) : d.data_type === dataTypeFilter).map((d) => (
                <option key={d.id} value={d.id}>[{dtLabel(d.data_type)}] {d.name} ({d.train_count + d.test_count}개)</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">최소 답변 길이</label>
              <input type="number" value={minLength} min={5} onChange={(e) => setMinLength(Number(e.target.value))}
                className="w-full mt-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">최대 답변 길이</label>
              <input type="number" value={maxLength} min={100} onChange={(e) => setMaxLength(Number(e.target.value))}
                className="w-full mt-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
            </div>
          </div>
        </div>
        <div className="space-y-2">
          {[
            { label: "중복 항목 제거", checked: filterDuplicates, set: setFilterDuplicates },
            { label: "저품질 항목 제거", checked: filterLowQuality, set: setFilterLowQuality },
          ].map((opt) => (
            <label key={opt.label} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={opt.checked} onChange={(e) => opt.set(e.target.checked)}
                className="w-3.5 h-3.5 accent-purple-600" />
              <span className="text-xs text-gray-600">{opt.label}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-400">
          길이, 중복, 단답, 질문-답변 동일 여부를 기준으로 규칙 기반 검증를 수행하고 제거된 산출 데이터셋을 생성합니다.
        </p>
        {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
        <button onClick={handleRun} disabled={!datasetId}
          className={`w-full flex items-center justify-center gap-2 py-2.5 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors ${
            running ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
          }`}>
          {running ? <><X className="w-4 h-4" />중단하기</> : <><ShieldCheck className="w-4 h-4" />규칙 기반 검증 실행</>}
        </button>

        {running && (
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <p className="text-xs font-semibold text-purple-600 flex items-center gap-1.5">
              <RefreshCw className="w-3 h-3 animate-spin" />규칙 기반 검증 처리 중...
            </p>
            <div className="w-full bg-purple-100 rounded-full h-1.5 overflow-hidden">
              <div className="h-1.5 bg-purple-400 rounded-full animate-pulse w-1/2" />
            </div>
          </div>
        )}
      </div>

      {/* 규칙 기반 검증 결과 목록 */}
      {createdDatasets.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
            <Database className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-semibold text-gray-700">규칙 기반 검증 산출 데이터셋 ({createdDatasets.length})</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {createdDatasets.map(({ dataset: ds, stats }) => (
              <div key={ds.id} className="px-5 py-4">
                <div className="flex items-start gap-3">
                  <Database className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-800">{ds.name}</p>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${dtBadge(ds.data_type)}`}>{dtLabel(ds.data_type)}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-green-50 text-green-600">
                        <CheckCircle className="w-3 h-3 inline mr-0.5" />완료
                      </span>
                    </div>
                    <div className="flex items-center gap-4 mt-1.5">
                      <span className="text-xs text-gray-500">전체 {stats.total}개</span>
                      <span className="text-xs text-green-600 font-medium">유지 {stats.kept}개</span>
                      <span className="text-xs text-red-500">제거 {stats.removed}개</span>
                      <span className="text-xs text-gray-400">({keepPct(stats.kept, stats.total)}% 보존)</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5 mt-2 overflow-hidden">
                      <div className="h-1.5 bg-green-400 rounded-full transition-all" style={{ width: `${keepPct(stats.kept, stats.total)}%` }} />
                    </div>
                    <div className="mt-2 space-y-0.5">
                      {ds.train_path && (
                        <p className="flex items-center gap-1.5 text-xs text-blue-600 font-mono">
                          <FileJson className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{ds.train_path.split("/").slice(-2).join("/")}</span>
                          <span className="text-gray-400">({ds.train_count}개)</span>
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {stats.reasons.map((r, i) => (
                        <span key={i} className="text-xs px-2 py-0.5 bg-red-50 text-red-500 border border-red-200 rounded">{r}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── LLM 기반 검증 패널 ───────────────────────────────
interface ValidationCriteria {
  accuracy: boolean; relevance: boolean; clarity: boolean; completeness: boolean; diversity: boolean;
}

interface ClusterSummary {
  label: number;
  size: number;
  sample_count: number;
  avg_score: number;
  passed: boolean;
}

interface ValidationResult {
  id: string;
  datasetName: string;
  datasetId: string;
  filteredDataset?: {
    dataset_id?: number;
    dataset_name?: string;
    train_count?: number;
    test_count?: number;
    data_type?: string;
    train_path?: string;
    test_path?: string;
  };
  filteredDatasetId?: number;
  filteredDatasetName?: string;
  keptCount?: number;
  removedCount?: number;
  minScore?: number;
  totalSampled: number;
  totalRows?: number;
  sampleMethod?: "all" | "representative";
  provider?: string;
  overallScore: number;
  recommendation: "ready" | "needs_work" | "not_recommended";
  criteria: { name: string; score: number; color: string }[];
  issues: { text: string; count: number; severity: "high" | "medium" | "low" }[];
  clusters?: ClusterSummary[];
  clusterMode?: boolean;
  createdAt: Date;
}

// 각 step.pct는 "이 단계가 끝나는 시점의 percent"로 정의 — 백엔드 진행률(0~100)과 align.
// 백엔드 흐름:
//   0~10%   : 데이터셋 샘플 추출 (chat.py dispatcher 시작 + validate_dataset 진입)
//   10~60%  : LLM judge 루프 (매 샘플 푸시)
//   60~70%  : 결과 저장 + 점수 집계
//   70~100% : 규칙 필터 + 리포트 생성 (에이전트 경로)
const STEPS = [
  { label: "데이터셋 샘플 추출", pct: 10 },
  { label: "각 항목 평가 중", pct: 60 },
  { label: "기준별 점수 집계", pct: 70 },
  { label: "리포트 생성", pct: 100 },
];

const VALIDATION_HISTORY_STORAGE_KEY = "nella.validation.history.v1";

const RecommendationBadge: React.FC<{ rec: ValidationResult["recommendation"] }> = ({ rec }) => {
  if (rec === "ready")
    return <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-semibold"><ThumbsUp className="w-4 h-4" />훈련 준비 완료</span>;
  if (rec === "needs_work")
    return <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-sm font-semibold"><Minus className="w-4 h-4" />개선 필요</span>;
  return <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm font-semibold"><ThumbsDown className="w-4 h-4" />사용 비권장</span>;
};

type AgentProgressState = {
  label: string;
  phase: "filtering" | "validating" | "done" | "error";
  percent?: number;
  message?: string;
  provider?: string;
  sample_method?: "all" | "representative";
  sample_count?: number;
  sample_percent?: number;
  dataset_id?: number | string;
} | null;

const ValidationPanel: React.FC<{
  datasets: Dataset[];
  onDatasetCreated: (ds: Dataset) => void;
  agentProgress: AgentProgressState;
}> = ({ datasets, onDatasetCreated, agentProgress }) => {
  const [dataTypeFilter, setDataTypeFilter] = useState<"sft" | "dpo">("sft");
  const [datasetId, setDatasetId] = useState("");
  const [provider, setProvider] = useState("openai");
  const [sampleMethod, setSampleMethod] = useState<"all" | "representative">("all");
  const [sampleCount, setSampleCount] = useState(30);
  const [samplePercent, setSamplePercent] = useState<number | null>(null);
  const [criteria, setCriteria] = useState<ValidationCriteria>({ accuracy: true, relevance: true, clarity: true, completeness: true, diversity: true });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentResult, setCurrentResult] = useState<ValidationResult | null>(null);
  const validationAbortRef = useRef<AbortController | null>(null);
  const activeValidationDatasetRef = useRef<number | null>(null);
  const validationRunRef = useRef(0);

  // 폴링 percent를 STEP별 active/done/내부 비율로 매핑한다.
  // 결과(currentResult)가 도착해도 "리포트 생성" 단계가 사용자에게 잠시 보이도록 1.5초 페이드아웃 지연.
  const polledPercent = agentProgress?.percent;
  const isAgentRunning = !!agentProgress && agentProgress.phase !== "done" && agentProgress.phase !== "error";
  const [resultGraceUntil, setResultGraceUntil] = useState<number | null>(null);
  useEffect(() => {
    if (currentResult) {
      setResultGraceUntil(Date.now() + 1500);
      const t = setTimeout(() => setResultGraceUntil(null), 1600);
      return () => clearTimeout(t);
    }
    setResultGraceUntil(null);
  }, [currentResult]);
  const inGracePeriod = resultGraceUntil != null && Date.now() < resultGraceUntil;
  const showProgress = (running || isAgentRunning || inGracePeriod);
  const [history, setHistory] = useState<ValidationResult[]>(() => {
    try {
      const raw = window.localStorage.getItem(VALIDATION_HISTORY_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Array<Omit<ValidationResult, "createdAt"> & { createdAt: string }>;
      return parsed.map((item) => ({ ...item, createdAt: new Date(item.createdAt) }));
    } catch {
      return [];
    }
  });
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const processedAgentValidationRef = useRef<number | null>(null);

  const CRITERIA_META = [
    { id: "accuracy",     label: "정확성", color: "#3b82f6" },
    { id: "relevance",    label: "관련성", color: "#8b5cf6" },
    { id: "clarity",      label: "명확성", color: "#06b6d4" },
    { id: "completeness", label: "완성도", color: "#10b981" },
    { id: "diversity",    label: "다양성", color: "#f59e0b" },
  ];

  const validationDatasets = datasets.filter((d) => dataTypeFilter === "sft" ? isSftFamily(d.data_type) : d.data_type === dataTypeFilter);
  const selectedDataset = validationDatasets.find((d) => String(d.id) === datasetId);
  const sampleMax = Math.max(1, selectedDataset?.train_count ?? 200);
  const sampleMin = 1;
  const sampleStep = sampleMax < 10 ? 1 : 5;
  const clampedSampleCount = Math.max(sampleMin, Math.min(sampleCount, sampleMax));
  const percentOptions = [10, 25, 50, 75];
  const getPercentSampleCount = (percent: number) => Math.max(sampleMin, Math.min(sampleMax, Math.round(sampleMax * percent / 100)));
  const rangePercent = samplePercent ?? Math.max(1, Math.min(100, Math.round((clampedSampleCount / sampleMax) * 100)));
  const selectedDatasetHistory = datasetId ? history.filter((h) => h.datasetId === datasetId) : [];

  useEffect(() => {
    settingsApi.get()
      .then((res) => {
        const defaultProvider = String((res.data as { llm_provider?: string }).llm_provider || "");
        if (["openai", "anthropic", "ollama"].includes(defaultProvider)) {
          setProvider(defaultProvider);
        }
      })
      .catch(() => {});
  }, []);

  // NELLA가 검증을 실행 중일 때 dispatcher가 푸시한 sample 설정을 UI에 동기화.
  // (sampleMethod 토글이 "대표 데이터"로, 해당 percent 버튼이 active로 표시되게)
  useEffect(() => {
    if (!agentProgress) return;
    if (agentProgress.dataset_id != null) {
      const nextDatasetId = String(agentProgress.dataset_id);
      const ds = datasets.find((item) => String(item.id) === nextDatasetId);
      if (ds) {
        setDataTypeFilter(ds.data_type === "dpo" ? "dpo" : "sft");
        setDatasetId(nextDatasetId);
      }
    }
    if (agentProgress.sample_method && (agentProgress.sample_method === "all" || agentProgress.sample_method === "representative")) {
      setSampleMethod(agentProgress.sample_method);
    }
    if (agentProgress.sample_percent && agentProgress.sample_percent > 0) {
      setSamplePercent(agentProgress.sample_percent);
    }
    if (agentProgress.sample_count && agentProgress.sample_count > 0) {
      setSampleCount(agentProgress.sample_count);
    } else if (agentProgress.sample_percent && agentProgress.sample_percent > 0) {
      setSampleCount(getPercentSampleCount(agentProgress.sample_percent));
    }
    if (agentProgress.provider && ["openai", "anthropic", "ollama"].includes(agentProgress.provider)) {
      setProvider(agentProgress.provider);
    }
  }, [agentProgress?.dataset_id, agentProgress?.sample_method, agentProgress?.sample_count, agentProgress?.sample_percent, agentProgress?.provider, datasets, selectedDataset?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!datasetId) return;
    setSampleCount((prev) => samplePercent ? getPercentSampleCount(samplePercent) : Math.max(sampleMin, Math.min(prev, sampleMax)));
  }, [datasetId, sampleMax, sampleMin]);

  useEffect(() => {
    window.localStorage.setItem(VALIDATION_HISTORY_STORAGE_KEY, JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    setSelectedHistoryId(null);
    setCurrentResult(null);
  }, [datasetId]);

  useEffect(() => {
    const applyAgentValidation = (rawResult: Record<string, unknown>, ts = Date.now()) => {
      if (processedAgentValidationRef.current === ts) return;
      processedAgentValidationRef.current = ts;
      const validation = (rawResult.validation_result as Record<string, unknown> | undefined) ?? rawResult;
      if (!validation?.datasetId) return;
      setDatasetId(String(validation.datasetId));
      setProvider(String(validation.provider ?? provider));
      setSampleMethod((validation.sampleMethod as "all" | "representative" | undefined) ?? sampleMethod);
      setRunning(true);
      setCurrentResult(null);
      setError(null);
      // 진행률은 백엔드 폴링(agentProgress)이 결정 — 시뮬레이션 없음.
      {
        const result: ValidationResult = {
          id: String(validation.id ?? `agent-validation-${Date.now()}`),
          datasetName: String(validation.datasetName ?? rawResult.dataset_name ?? "데이터셋"),
          datasetId: String(validation.datasetId),
          totalSampled: Number(validation.totalSampled ?? rawResult.total_sampled ?? 0),
          totalRows: validation.totalRows != null ? Number(validation.totalRows) : undefined,
          sampleMethod: validation.sampleMethod as "all" | "representative" | undefined,
          provider: validation.provider ? String(validation.provider) : undefined,
          overallScore: Number(validation.overallScore ?? rawResult.overall_score ?? 0),
          recommendation: (validation.recommendation as ValidationResult["recommendation"]) ?? "needs_work",
          criteria: (validation.criteria as ValidationResult["criteria"]) ?? [],
          issues: (validation.issues as ValidationResult["issues"]) ?? [],
          clusters: (validation.clusters as ValidationResult["clusters"]) ?? undefined,
          clusterMode: typeof validation.clusterMode === "boolean" ? validation.clusterMode : undefined,
          filteredDataset: validation.filteredDataset as ValidationResult["filteredDataset"],
          filteredDatasetId: validation.filteredDatasetId != null ? Number(validation.filteredDatasetId) : undefined,
          filteredDatasetName: validation.filteredDatasetName ? String(validation.filteredDatasetName) : undefined,
          keptCount: validation.keptCount != null ? Number(validation.keptCount) : undefined,
          removedCount: validation.removedCount != null ? Number(validation.removedCount) : undefined,
          minScore: validation.minScore != null ? Number(validation.minScore) : undefined,
          createdAt: new Date(String(validation.createdAt ?? new Date().toISOString())),
        };
        if (result.filteredDataset?.dataset_id) {
          onDatasetCreated({
            id: Number(result.filteredDataset.dataset_id),
            name: result.filteredDataset.dataset_name ?? `dataset_${result.filteredDataset.dataset_id}`,
            data_type: result.filteredDataset.data_type ?? "sft",
            train_count: Number(result.filteredDataset.train_count ?? 0),
            test_count: Number(result.filteredDataset.test_count ?? 0),
            train_ratio: 0.9,
            created_at: new Date().toISOString(),
            train_path: result.filteredDataset.train_path,
            test_path: result.filteredDataset.test_path,
          } as Dataset);
        }
        setCurrentResult(result);
        setHistory((prev) => [result, ...prev.filter((h) => h.id !== result.id)].slice(0, 50));
        setSelectedHistoryId(result.id);
        setRunning(false);
      }
    };

    const handleAgentResult = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string; result?: Record<string, unknown> }>).detail;
      if (detail?.name === "validate_training_data" && detail.result) applyAgentValidation(detail.result);
    };
    window.addEventListener(AGENT_TOOL_RESULT_EVENT, handleAgentResult);

    try {
      const stored = window.sessionStorage.getItem("nella.agent.lastToolResult");
      if (stored) {
        const parsed = JSON.parse(stored) as { name?: string; result?: Record<string, unknown>; ts?: number };
        if (parsed.name === "validate_training_data" && parsed.result && parsed.ts && Date.now() - parsed.ts < 10_000) {
          applyAgentValidation(parsed.result, parsed.ts);
        }
      }
    } catch { /* ignore */ }

    return () => window.removeEventListener(AGENT_TOOL_RESULT_EVENT, handleAgentResult);
  }, [onDatasetCreated]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRun = async () => {
    if (running) {
      validationAbortRef.current?.abort();
      validationRunRef.current += 1;
      const ids = [Number(datasetId), activeValidationDatasetRef.current].filter((id): id is number => Number.isFinite(id));
      activeValidationDatasetRef.current = null;
      setRunning(false);
      setError("LLM 기반 검증를 중단했습니다.");
      emitPipelineEvent({ kind: "cancel", label: "🧪 LLM 기반 검증 중단", detail: "사용자 요청으로 중단됨" });
      await Promise.all(ids.map((id) => trainingDataApi.cancelValidation(id).catch(() => {})));
      return;
    }
    if (!datasetId) return;
    setRunning(true); setCurrentResult(null); setError(null);
    const controller = new AbortController();
    validationAbortRef.current = controller;
    const runId = validationRunRef.current + 1;
    validationRunRef.current = runId;
    try {
      const source = datasets.find((d) => String(d.id) === datasetId);
      const base = (source?.name ?? `dataset_${datasetId}`)
        .replace(/_LLM_judge_filter$/, "")
        .replace(/_rule_based_filter$/, "")
        .replace(/_filtered$/, "");
      activeValidationDatasetRef.current = Number(datasetId);
      emitPipelineEvent({ kind: "start", label: "🧪 LLM 기반 검증", detail: source?.name ?? `#${datasetId}` });
      const res = await trainingDataApi.validate(Number(datasetId), {
        provider,
        sample_method: sampleMethod,
        sample_count: Math.max(1, Math.min(clampedSampleCount, source?.train_count || clampedSampleCount)),
        min_score: 6.5,
        new_name: `${base}_LLM_judge_filter`,
        criteria: { ...criteria },
      }, { signal: controller.signal });
      if (controller.signal.aborted || validationRunRef.current !== runId) return;
      const data = res.data as Omit<ValidationResult, "createdAt"> & { createdAt: string };
      const result: ValidationResult = {
        ...data,
        createdAt: new Date(data.createdAt),
      };
      if (result.filteredDataset?.dataset_id) {
        onDatasetCreated({
          id: Number(result.filteredDataset.dataset_id),
          name: result.filteredDataset.dataset_name ?? `dataset_${result.filteredDataset.dataset_id}`,
          data_type: result.filteredDataset.data_type ?? source?.data_type ?? "sft",
          train_count: Number(result.filteredDataset.train_count ?? 0),
          test_count: Number(result.filteredDataset.test_count ?? 0),
          train_ratio: source?.train_ratio ?? 0.9,
          created_at: new Date().toISOString(),
          train_path: result.filteredDataset.train_path,
          test_path: result.filteredDataset.test_path,
        } as Dataset);
      }
      emitPipelineEvent({
        kind: "complete",
        label: "🧪 LLM 기반 검증 완료",
        detail: `${result.keptCount ?? 0}/${result.totalRows ?? result.totalSampled}개 유지 → ${result.filteredDatasetName ?? result.filteredDataset?.dataset_name ?? ""}`,
      });
      setCurrentResult(result);
      setHistory((prev) => [result, ...prev].slice(0, 50));
      setSelectedHistoryId(result.id);
    } catch (e: unknown) {
      if ((e as { code?: string; name?: string })?.code === "ERR_CANCELED" || (e as { name?: string })?.name === "CanceledError") {
        setError("LLM 기반 검증를 중단했습니다.");
        return;
      }
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "LLM 기반 검증 실패";
      emitPipelineEvent({ kind: "failed", label: "🧪 LLM 기반 검증 실패", detail: msg });
      setError(msg);
    } finally {
      validationAbortRef.current = null;
      activeValidationDatasetRef.current = null;
      if (validationRunRef.current === runId) setRunning(false);
    }
  };

  const displayResult = selectedHistoryId ? selectedDatasetHistory.find(h => h.id === selectedHistoryId) ?? currentResult : currentResult;
  const radarData = displayResult?.criteria.map((c) => ({ subject: c.name, score: c.score, fullMark: 10 })) ?? [];
  const barData = displayResult?.criteria.map((c) => ({ name: c.name, score: c.score, fill: c.color })) ?? [];
  const severityColor = (s: string) =>
    s === "high" ? "text-red-600 bg-red-50 border-red-200" :
    s === "medium" ? "text-yellow-700 bg-yellow-50 border-yellow-200" :
    "text-gray-600 bg-gray-50 border-gray-200";

  return (
    <div className="space-y-4">
      {/* LLM 기반 검증 설정 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-blue-500" />
          <h3 className="text-sm font-semibold text-gray-700">LLM 기반 검증 설정</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">데이터 유형</label>
            <div className="grid grid-cols-2 gap-1.5">
              {([["sft", "SFT", "QA · CoT · ToT · GoT"], ["dpo", "DPO", "선호도 쌍"]] as const).map(([val, label, sub]) => (
                <button key={val} onClick={() => { setDataTypeFilter(val); setDatasetId(""); }}
                  className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                    dataTypeFilter === val ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-gray-300"
                  }`}>
                  <p className={`font-semibold ${dataTypeFilter === val ? "text-blue-700" : "text-gray-600"}`}>{label}</p>
                  <p className="text-gray-400">{sub}</p>
                </button>
              ))}
            </div>
            <div className="mt-3">
              <label className="text-xs font-medium text-gray-600">평가할 데이터셋</label>
              <select value={datasetId} onChange={(e) => setDatasetId(e.target.value)}
                className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <option value="">데이터셋 선택...</option>
                {validationDatasets.map((d) => (
                  <option key={d.id} value={d.id}>[{dtLabel(d.data_type)}] {d.name} ({d.train_count}개 훈련)</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">평가 LLM</label>
              <ProviderButtons value={provider} onChange={setProvider} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">평가 데이터</label>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: "all", label: "전체 데이터" },
                  { id: "representative", label: "대표 데이터" },
                ].map((m) => (
                  <button key={m.id} onClick={() => {
                    setSampleMethod(m.id as typeof sampleMethod);
                    if (m.id === "all") setSamplePercent(null);
                  }}
                    className={`py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                      sampleMethod === m.id ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500 hover:border-gray-300"
                    }`}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">대표 샘플 수 ({clampedSampleCount}개)</label>
              <div className="grid grid-cols-4 gap-1.5 mt-1">
                {percentOptions.map((percent) => {
                  const count = getPercentSampleCount(percent);
                  return (
                    <button key={percent} type="button"
                      disabled={sampleMethod === "all" || !selectedDataset}
                      onClick={() => {
                        setSamplePercent(percent);
                        setSampleCount(count);
                      }}
                      className={`py-1.5 rounded-lg border text-xs font-medium transition-colors disabled:opacity-40 ${
                        sampleMethod === "representative" && selectedDataset && samplePercent === percent
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-gray-200 text-gray-500 hover:border-gray-300"
                      }`}>
                      {percent}%
                    </button>
                  );
                })}
              </div>
              <input type="range" min={1} max={100} step={1} value={rangePercent}
                disabled={sampleMethod === "all" || !selectedDataset}
                onChange={(e) => {
                  const nextPercent = Number(e.target.value);
                  setSamplePercent(nextPercent);
                  setSampleCount(getPercentSampleCount(nextPercent));
                }} className="w-full mt-2 accent-blue-600 disabled:opacity-40" />
              <div className="flex justify-between text-xs text-gray-400 mt-0.5"><span>1%</span><span>{rangePercent}%</span><span>100%</span></div>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-2">평가 기준</label>
            <div className="space-y-1.5">
              {CRITERIA_META.map((c) => (
                <label key={c.id} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={criteria[c.id as keyof ValidationCriteria]}
                    onChange={(e) => setCriteria((p) => ({ ...p, [c.id]: e.target.checked }))}
                    className="w-3.5 h-3.5 accent-blue-600" />
                  <span className="text-xs font-medium text-gray-700">{c.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <button onClick={handleRun} disabled={!running && !datasetId}
          className={`w-full flex items-center justify-center gap-2 py-2.5 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors ${
            running ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
          }`}>
          {running ? <><X className="w-4 h-4" />중단하기</> : <><ClipboardCheck className="w-4 h-4" />LLM 기반 검증 실행</>}
        </button>
        {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}

        {/* 진행 프로그레스바 — 매뉴얼/에이전트 양쪽 모두 백엔드 폴링 percent로 표시 */}
        {showProgress && (() => {
          const effectivePercent = inGracePeriod && !running ? 100 : (polledPercent ?? 0);
          const headerLabel = inGracePeriod
            ? "리포트 생성 완료"
            : (agentProgress?.message || `LLM 기반 검증 진행 중 (${provider})`);
          return (
          <div className="pt-3 border-t border-gray-100 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-blue-600 flex items-center gap-1.5">
                {inGracePeriod
                  ? <CheckCircle className="w-3 h-3 text-green-600" />
                  : <RefreshCw className="w-3 h-3 animate-spin" />}
                {headerLabel}
              </p>
              <span className="text-xs font-medium text-blue-700 tabular-nums">{effectivePercent}%</span>
            </div>
            {STEPS.map((step, i) => {
              const stepStart = i === 0 ? 0 : STEPS[i - 1].pct;
              const stepEnd = step.pct;
              const percent = Math.max(0, Math.min(100, inGracePeriod ? 100 : (polledPercent ?? 0)));
              const done = percent >= stepEnd;
              const active = !done && percent >= stepStart;
              const innerPct = active
                ? Math.round(((percent - stepStart) / Math.max(1, stepEnd - stepStart)) * 100)
                : (done ? 100 : 0);
              return (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className={`flex items-center gap-1.5 font-medium ${done ? "text-green-600" : active ? "text-blue-600" : "text-gray-400"}`}>
                      {done
                        ? <CheckCircle className="w-3 h-3" />
                        : active
                        ? <div className="w-3 h-3 rounded-full bg-blue-500 animate-pulse" />
                        : <div className="w-3 h-3 rounded-full bg-gray-200" />
                      }
                      {i + 1}단계. {step.label}
                    </span>
                    <span className={`${done ? "text-green-500" : active ? "text-blue-500" : "text-gray-300"}`}>
                      {done ? "완료" : active ? `${innerPct}%` : "대기"}
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-1.5 rounded-full transition-all duration-500 ${done ? "bg-green-400" : active ? "bg-blue-400" : "bg-gray-200"}`}
                      style={{ width: done ? "100%" : active ? `${innerPct}%` : "0%" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          );
        })()}
      </div>

      {/* LLM 기반 검증 결과 */}
      {displayResult && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 mb-0.5">
                {displayResult.datasetName} · {displayResult.totalSampled}개 평가
                {displayResult.totalRows ? ` / 전체 ${displayResult.totalRows}개` : ""}
                {displayResult.sampleMethod === "representative" ? " · 대표 데이터" : displayResult.sampleMethod === "all" ? " · 전체 데이터" : ""}
              </p>
              <div className="flex items-baseline gap-2">
                <span className={`text-4xl font-bold ${displayResult.overallScore >= 8 ? "text-green-600" : displayResult.overallScore >= 6.5 ? "text-yellow-600" : "text-red-600"}`}>
                  {displayResult.overallScore}
                </span>
                <span className="text-lg text-gray-400">/ 10</span>
              </div>
            </div>
            <RecommendationBadge rec={displayResult.recommendation} />
          </div>
          {displayResult.filteredDataset && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
              <div className="flex items-start gap-2">
                <Database className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-green-800">LLM 기반 검증 산출 데이터셋</p>
                  <p className="text-xs text-green-700 mt-0.5 truncate">{displayResult.filteredDataset.dataset_name}</p>
                  <div className="flex flex-wrap gap-3 mt-1.5 text-xs">
                    <span className="text-green-700">유지 {displayResult.keptCount ?? displayResult.filteredDataset.train_count ?? 0}개</span>
                    <span className="text-red-600">제거 {displayResult.removedCount ?? 0}개</span>
                    <span className="text-gray-500">
                      {displayResult.clusterMode
                        ? `클러스터 평균 ${displayResult.minScore ?? 6.5}/10 미만 클러스터 전체 제거`
                        : `기준 ${displayResult.minScore ?? 6.5}/10 미만 제거`}
                    </span>
                  </div>
                  {displayResult.filteredDataset.train_path && (
                    <p className="flex items-center gap-1.5 text-xs text-blue-700 font-mono mt-2">
                      <FileJson className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{displayResult.filteredDataset.train_path.split("/").slice(-2).join("/")}</span>
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
          {displayResult.clusterMode && displayResult.clusters && displayResult.clusters.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-600">클러스터별 채택 결과 (KMeans, k={displayResult.clusters.length})</p>
                <p className="text-[11px] text-gray-500">
                  대표 샘플 평균 &lt; {displayResult.minScore ?? 6.5} → 클러스터 전체 탈락
                </p>
              </div>
              <div className="space-y-1">
                {displayResult.clusters.map((c) => (
                  <div
                    key={c.label}
                    className={`flex items-center gap-3 px-2.5 py-1.5 rounded border text-xs ${
                      c.passed
                        ? "border-green-200 bg-green-50 text-green-800"
                        : "border-red-200 bg-red-50 text-red-700"
                    }`}
                  >
                    <span className="font-mono font-semibold w-14 flex-shrink-0">C{c.label}</span>
                    <div className="flex-1 min-w-0 flex items-center gap-3">
                      <span className="text-gray-600">항목 <span className="font-semibold text-gray-800">{c.size}</span></span>
                      <span className="text-gray-600">대표 <span className="font-semibold text-gray-800">{c.sample_count}</span></span>
                      <div className="flex-1 min-w-0 h-1.5 bg-gray-200 rounded overflow-hidden">
                        <div
                          className={`h-full ${c.passed ? "bg-green-500" : "bg-red-500"}`}
                          style={{ width: `${Math.min(100, (c.avg_score / 10) * 100)}%` }}
                        />
                      </div>
                    </div>
                    <span className={`font-semibold w-12 text-right flex-shrink-0 ${c.passed ? "text-green-700" : "text-red-600"}`}>
                      {c.avg_score.toFixed(1)}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold w-14 text-center flex-shrink-0 ${
                      c.passed ? "bg-green-200 text-green-800" : "bg-red-200 text-red-800"
                    }`}>
                      {c.passed ? "채택" : "탈락"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {radarData.length >= 3 && (
            <ResponsiveContainer width="100%" height={180}>
              <RadarChart data={radarData}>
                <PolarGrid /><PolarAngleAxis dataKey="subject" tick={{ fontSize: 11 }} />
                <Radar dataKey="score" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} />
              </RadarChart>
            </ResponsiveContainer>
          )}
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={barData} margin={{ top: 0, right: 0, left: -25, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis domain={[0, 10]} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => [`${v}/10`, "점수"]} />
              <Bar dataKey="score" radius={[3, 3, 0, 0]}>
                {barData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {displayResult.issues.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">발견된 문제</p>
              <div className="space-y-1.5">
                {displayResult.issues.map((issue, i) => (
                  <div key={i} className={`flex items-center justify-between px-3 py-1.5 rounded-lg border text-xs ${severityColor(issue.severity)}`}>
                    <span>{issue.text}</span>
                    <span className="font-semibold ml-2 flex-shrink-0">{issue.count}건</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* LLM 기반 검증 이력 */}
      {selectedDatasetHistory.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
            <History className="w-4 h-4 text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-700">LLM 기반 검증 이력 ({selectedDatasetHistory.length})</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {selectedDatasetHistory.map((h) => (
              <button
                key={h.id}
                onClick={() => setSelectedHistoryId(h.id)}
                className={`w-full flex items-center gap-3 px-5 py-3 hover:bg-gray-50 text-left transition-colors ${selectedHistoryId === h.id ? "bg-blue-50" : ""}`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                  h.overallScore >= 8 ? "bg-green-100 text-green-700" : h.overallScore >= 6.5 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-600"
                }`}>
                  {h.overallScore}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{h.datasetName}</p>
                  <p className="text-xs text-gray-400">
                    {h.totalSampled}개 · {h.sampleMethod === "all" ? "전체 데이터" : "대표 데이터"} · {h.createdAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {h.recommendation === "ready"
                    ? <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">준비 완료</span>
                    : h.recommendation === "needs_work"
                    ? <span className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full">개선 필요</span>
                    : <span className="text-xs px-2 py-0.5 bg-red-100 text-red-600 rounded-full">비권장</span>
                  }
                  <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {!displayResult && !running && selectedDatasetHistory.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 flex flex-col items-center justify-center text-center">
          <ClipboardCheck className="w-12 h-12 text-gray-200 mb-3" />
          <p className="text-sm text-gray-400 max-w-xs">데이터셋을 선택하고 LLM 기반 검증를 실행하면<br />제거된 산출 데이터셋이 생성됩니다</p>
        </div>
      )}
    </div>
  );
};

// ── 메인 ──────────────────────────────────────────────
const DataValidation: React.FC = () => {
  const [tab, setTab] = useState<Tab>("validate");
  // 자동 탭 전환을 phase 전환 시점에만 1회 적용하기 위한 추적용 ref
  const lastAutoTabPhaseRef = useRef<string | null>(null);
  // 사용자가 수동으로 탭을 클릭했는지 — true면 다음 새 phase 전환 전까지 자동 전환 중단
  const userTabOverrideRef = useRef(false);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [agentProgress, setAgentProgress] = useState<{
    label: string;
    phase: "filtering" | "validating" | "done" | "error";
    percent?: number;
    message?: string;
    provider?: string;
    sample_method?: "all" | "representative";
    sample_count?: number;
    sample_percent?: number;
    dataset_id?: number | string;
  } | null>(null);
  const processedProgressFilterRef = useRef<number | null>(null);

  const loadDatasets = useCallback(() => {
    trainingDataApi.list().then((res) => setDatasets(res.data ?? [])).catch(console.error);
  }, []);
  const handleDatasetCreated = useCallback((ds: Dataset) => {
    setDatasets((prev) => prev.some((item) => item.id === ds.id) ? prev : [ds, ...prev]);
  }, []);
  const isActive = useLocation().pathname === OWNED_PATH;
  useAgentPolling(loadDatasets, { idle: 3_000, active: 2_000, enabled: isActive });
  useAgentToolResult(
    ["validate_training_data", "filter_dataset", "preview_dataset"],
    () => { loadDatasets(); },
    isActive,
  );

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await api.get<{
          status?: string;
          phase?: "filtering" | "validating" | "done" | "error";
          percent?: number;
          message?: string;
          ts?: number;
          provider?: string;
          sample_method?: "all" | "representative";
          sample_count?: number;
          sample_percent?: number;
          source_dataset_id?: number | string;
          dataset_id?: number | string;
          filter_result?: { dataset_id?: number; dataset_name?: string; train_count?: number; test_count?: number; data_type?: string };
        }>("/chat/agent-progress/data-validation");
        const progress = res.data;
        if (!progress || progress.status === "idle") return;
        const phase = progress.phase ?? (progress.status === "completed" ? "done" : "filtering");
        setAgentProgress({
          label: phase === "validating" ? "LLM 기반 검증" : phase === "filtering" ? "규칙 기반 검증" : phase === "done" ? "검증 완료" : "검증 오류",
          phase,
          percent: progress.percent,
          message: progress.message,
          provider: progress.provider,
          sample_method: progress.sample_method,
          sample_count: progress.sample_count,
          sample_percent: progress.sample_percent,
          dataset_id: progress.source_dataset_id ?? progress.dataset_id,
        });
        // 탭 자동 전환은 phase가 변경된 그 시점에만, 그리고 사용자가 수동 클릭하지 않은 동안에만 적용한다.
        // - 매 폴링마다 setTab을 호출하면 사용자가 다른 탭을 골라도 2초 뒤에 빼앗긴다.
        // - 완료(done) 상태는 더 이상 탭을 강제하지 않는다 (사용자가 결과 보러 어디든 갈 수 있음).
        const phaseChanged = lastAutoTabPhaseRef.current !== phase;
        if (phaseChanged) {
          // 새 활성 phase가 시작되면 사용자 override를 초기화한 뒤 자동 전환
          const isNewActivePhase = phase === "validating" || phase === "filtering";
          if (isNewActivePhase) {
            userTabOverrideRef.current = false;
            if (!userTabOverrideRef.current) {
              if (phase === "validating") setTab("validate");
              else if (phase === "filtering") setTab("quality");
            }
          }
          lastAutoTabPhaseRef.current = phase;
        }
        if (progress.filter_result?.dataset_id && processedProgressFilterRef.current !== progress.filter_result.dataset_id) {
          processedProgressFilterRef.current = progress.filter_result.dataset_id;
          handleDatasetCreated({
            id: Number(progress.filter_result.dataset_id),
            name: progress.filter_result.dataset_name ?? `dataset_${progress.filter_result.dataset_id}`,
            data_type: progress.filter_result.data_type ?? "sft",
            train_count: Number(progress.filter_result.train_count ?? 0),
            test_count: Number(progress.filter_result.test_count ?? 0),
            train_ratio: 0.9,
            created_at: new Date().toISOString(),
          });
          loadDatasets();
        }
        if (phase === "done" || phase === "error") {
          loadDatasets();
          window.setTimeout(() => setAgentProgress(null), 4000);
        }
      } catch { /* ignore progress polling errors */ }
    };
    poll();
    const id = window.setInterval(poll, 2000);
    return () => window.clearInterval(id);
  }, [handleDatasetCreated, loadDatasets]);

  const TABS = [
    { id: "validate" as Tab, label: "LLM 기반 검증", icon: ClipboardCheck },
    { id: "quality" as Tab,  label: "규칙 기반 검증", icon: Filter },
  ];

  useEffect(() => {
    const playAgentValidationTabs = () => {
      // 백엔드가 percent/메시지를 직접 푸시하므로 시뮬레이션은 두지 않는다.
      // 탭만 자동 전환하고, 진행률은 agent-progress 폴링에서 갱신된다.
      // 에이전트가 명시적으로 트리거한 새 작업이므로 사용자 override를 초기화한다.
      userTabOverrideRef.current = false;
      setTab("validate");
    };
    const handleAgentPageStart = (event: Event) => {
      const detail = (event as CustomEvent<{ page?: string; label?: string; ts?: number }>).detail;
      if (detail?.page !== "/data-validation") return;
      userTabOverrideRef.current = false;
      setTab("validate");
      setAgentProgress((current) => current ?? {
        label: "LLM 기반 검증",
        phase: "validating",
        percent: 3,
        message: "NELLA가 LLM 기반 검증를 준비하고 있습니다.",
        sample_method: "representative",
        sample_percent: 50,
      });
    };
    const handleAgentResult = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string }>).detail;
      if (detail?.name !== "validate_training_data") return;
      playAgentValidationTabs();
    };
    window.addEventListener(AGENT_PAGE_START_EVENT, handleAgentPageStart);
    window.addEventListener(AGENT_TOOL_RESULT_EVENT, handleAgentResult);
    try {
      const active = window.sessionStorage.getItem(SS_AGENT_ACTIVE_PAGE);
      if (active) {
        const parsed = JSON.parse(active) as { page?: string; label?: string; ts?: number };
        if (parsed.page === "/data-validation" && parsed.ts && Date.now() - parsed.ts < 60_000) {
          handleAgentPageStart(new CustomEvent(AGENT_PAGE_START_EVENT, { detail: parsed }));
        }
      }
      const stored = window.sessionStorage.getItem("nella.agent.lastToolResult");
      if (stored) {
        const parsed = JSON.parse(stored) as { name?: string; ts?: number };
        if (parsed.name === "validate_training_data" && parsed.ts && Date.now() - parsed.ts < 10_000) {
          playAgentValidationTabs();
        }
      }
    } catch { /* ignore */ }
    return () => {
      window.removeEventListener(AGENT_PAGE_START_EVENT, handleAgentPageStart);
      window.removeEventListener(AGENT_TOOL_RESULT_EVENT, handleAgentResult);
    };
  }, []);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="w-7 h-7 rounded-md bg-blue-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">3</span>
          <ShieldCheck className="w-5 h-5 text-blue-600 flex-shrink-0" />
          <div>
            <div className="flex items-center gap-1"><h1 className="text-xl font-bold text-gray-900">학습데이터 검증</h1><PageHelp pageKey="dataValidation" /></div>
            <p className="text-xs text-gray-500">LLM 기반 검증와 규칙 기반 검증로 제거된 산출 데이터셋 생성</p>
          </div>
        </div>
        <button onClick={() => trainingDataApi.list().then((r) => setDatasets(r.data ?? []))} className="p-2 hover:bg-gray-100 rounded-lg">
          <RefreshCw className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      {datasets.length === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-center gap-3">
          <Database className="w-5 h-5 text-yellow-600 flex-shrink-0" />
          <p className="text-sm text-yellow-800">
            데이터셋이 없습니다. <a href="/data" className="font-semibold underline">학습데이터 생성</a> 페이지에서 먼저 데이터를 생성하세요.
          </p>
        </div>
      )}

      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => { setTab(id); userTabOverrideRef.current = true; }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === id ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}>
            <Icon className="w-3.5 h-3.5" />{label}
          </button>
        ))}
      </div>

      {tab === "validate" && <ValidationPanel datasets={datasets} onDatasetCreated={handleDatasetCreated} agentProgress={agentProgress} />}
      {tab === "quality"  && <QualityFilterPanel datasets={datasets} onDatasetCreated={handleDatasetCreated} />}
    </div>
  );
};

export default DataValidation;
