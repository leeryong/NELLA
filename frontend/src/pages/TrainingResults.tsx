import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const OWNED_PATH = "/training-results";
import {
  Download, RefreshCw, ChevronDown, ChevronUp, MessageSquare,
  CheckCircle, XCircle, AlertCircle, Info, Database, Cpu,
  Clock, BarChart2, FolderOpen, Copy, Check, Trash2, GitMerge, Trophy,
} from "lucide-react";
import { trainingApi, TrainedModelRecord } from "../services/api";
import MetricsChart from "../components/MetricsChart";
import { formatDate, statusColor } from "../lib/utils";
import PageHelp from "../components/PageHelp";
import { useAgentPolling } from "../hooks/useAgentPolling";
import { useAgentToolResult } from "../hooks/useAgentToolResult";
import { emitPipelineEvent } from "../pipelineEvent";

// ── 파일 크기 포맷 ────────────────────────────────────
function fmtBytes(bytes?: number): string {
  if (!bytes) return "–";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

// ── 훈련 방식 레이블 ──────────────────────────────────
const METHOD_LABEL: Record<string, { label: string; color: string }> = {
  lora:         { label: "LoRA",         color: "bg-blue-100 text-blue-700" },
  qlora:        { label: "QLoRA",        color: "bg-purple-100 text-purple-700" },
  full:         { label: "Full FT",      color: "bg-orange-100 text-orange-700" },
  dpo:          { label: "DPO",          color: "bg-pink-100 text-pink-700" },
  sft:          { label: "SFT",          color: "bg-blue-100 text-blue-700" },
  autoresearch: { label: "AutoResearch", color: "bg-indigo-100 text-indigo-700" },
};

// ── 복사 버튼 ─────────────────────────────────────────
const CopyBtn: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="p-1 hover:bg-gray-200 rounded transition-colors"
      title="복사"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 text-gray-400" />}
    </button>
  );
};

// ── LoRA 사용 가이드 ──────────────────────────────────
const LoraGuide: React.FC<{ record: TrainedModelRecord }> = ({ record }) => {
  const isLora = record.method === "lora" || record.method === "qlora";
  if (!isLora) return null;

  const baseModelId = record.model?.hf_model_id ?? "<base_model>";
  const adapterPath = record.output_dir ?? "./data/models/trained_output";

  const mergeCode = `from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

# 1. 베이스 모델 로드
base_model = AutoModelForCausalLM.from_pretrained("${baseModelId}")
tokenizer = AutoTokenizer.from_pretrained("${baseModelId}")

# 2. LoRA 어댑터 적용
model = PeftModel.from_pretrained(base_model, "${adapterPath}")

# 3. 가중치 병합 (선택사항 — 추론 속도 향상)
model = model.merge_and_unload()

# 4. 추론
inputs = tokenizer("질문을 입력하세요.", return_tensors="pt")
outputs = model.generate(**inputs, max_new_tokens=200)
print(tokenizer.decode(outputs[0], skip_special_tokens=True))`;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <Info className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
        <p className="text-xs font-semibold text-amber-700">
          {record.method.toUpperCase()} 어댑터 — 베이스 모델 필요
        </p>
      </div>
      <p className="text-xs text-amber-600 leading-relaxed">
        LoRA 어댑터는 단독으로 실행되지 않습니다. 베이스 모델
        <code className="mx-1 px-1 bg-amber-100 rounded font-mono">{baseModelId}</code>
        와 함께 사용하거나 merge_and_unload()로 병합하세요.
      </p>
      <details className="group">
        <summary className="text-xs text-amber-600 cursor-pointer hover:text-amber-800 font-medium select-none">
          Python 사용 예시 펼치기 ▸
        </summary>
        <div className="mt-2 bg-gray-900 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-700">
            <span className="text-xs text-gray-400 font-mono">python</span>
            <CopyBtn text={mergeCode} />
          </div>
          <pre className="px-3 py-2.5 text-xs text-green-300 font-mono whitespace-pre-wrap leading-relaxed overflow-auto max-h-64">
            {mergeCode}
          </pre>
        </div>
      </details>
    </div>
  );
};

interface MergeState {
  status: "idle" | "merging" | "done" | "error";
  percent: number;
  message: string;
  done: boolean;
  error: string | null;
  merged_dir: string | null;
}

// ── 메인 컴포넌트 ─────────────────────────────────────
const TrainingResults: React.FC = () => {
  const navigate = useNavigate();
  const [records, setRecords] = useState<TrainedModelRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const autoExpandRef = useRef(false);
  const initialLoadDoneRef = useRef(false);
  const [downloading, setDownloading] = useState<Set<number>>(new Set());
  const [filterStatus, setFilterStatus] = useState<"all" | "completed" | "cancelled" | "failed">("all");
  const [mergeState, setMergeState] = useState<Record<number, MergeState>>({});
  const [merging, setMerging] = useState<Set<number>>(new Set());
  const esRefs = useRef<Record<number, EventSource>>({});
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  const load = async () => {
    if (!initialLoadDoneRef.current) setLoading(true);
    try {
      const [res, arRes] = await Promise.all([
        trainingApi.listTrainedModels(),
        trainingApi.listARJobs(),
      ]);
      initialLoadDoneRef.current = true;
      const mergedRecords = [...res.data];
      const existingArIds = new Set(
        mergedRecords
          .filter((record) => record.record_type === "autoresearch")
          .map((record) => record.id),
      );
      for (const job of arRes.data ?? []) {
        if (!["completed", "cancelled", "failed"].includes(job.status)) continue;
        if (existingArIds.has(job.id)) continue;
        mergedRecords.push({
          id: job.id,
          name: job.name,
          record_type: "autoresearch",
          status: job.status as "completed" | "cancelled" | "failed",
          method: "autoresearch",
          config: job.best_config,
          output_dir: undefined,
          final_loss: job.best_loss,
          training_metrics: undefined,
          error_message: undefined,
          started_at: undefined,
          completed_at: undefined,
          created_at: job.created_at,
          model_size_bytes: undefined,
          max_trials: job.max_trials,
          steps_per_trial: job.steps_per_trial,
          trial_results: job.trial_results,
        });
      }
      mergedRecords.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      setRecords(mergedRecords);
      // 서버에서 이미 병합된 항목은 mergeState에 "done"으로 초기화
      setMergeState((prev) => {
        const next = { ...prev };
        for (const r of mergedRecords) {
          if (r.merged_dir && !next[r.id]) {
            next[r.id] = {
              status: "done", percent: 100, message: "병합 완료",
              done: true, error: null, merged_dir: r.merged_dir,
            };
          }
        }
        return next;
      });
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  const isActive = useLocation().pathname === OWNED_PATH;
  useAgentPolling(load, { idle: 3_000, active: 2_000, enabled: isActive });
  useAgentToolResult(
    [
      "delete_training_job", "delete_all_training_jobs",
      "delete_autoresearch_job", "delete_all_autoresearch_jobs",
      "merge_adapter", "wait_for_merge",
      "get_training_jobs", "start_training_job", "wait_for_training_job",
      "start_autoresearch", "wait_for_autoresearch", "get_autoresearch_job_status",
    ],
    () => { void load(); },
    isActive,
  );

  useEffect(() => {
    if (!isActive) return;
    const refreshSoon = () => {
      void load();
      window.setTimeout(() => void load(), 800);
      window.setTimeout(() => void load(), 2500);
    };
    window.addEventListener("agent-navigate", refreshSoon);
    return () => window.removeEventListener("agent-navigate", refreshSoon);
  }, [isActive]);

  // Auto-expand latest completed record on first load (one-shot)
  useEffect(() => {
    if (autoExpandRef.current || records.length === 0) return;
    const completed = records.filter((r) => r.status === "completed");
    if (completed.length === 0) return;
    autoExpandRef.current = true;
    const latest = completed.reduce((a, b) => (a.id > b.id ? a : b));
    setExpandedId(latest.id);
  }, [records]);

  const handleDownload = (record: TrainedModelRecord) => {
    if (!record.output_dir) return;
    setDownloading((prev) => new Set(prev).add(record.id));
    trainingApi.downloadModel(record.id);
    setTimeout(() => {
      setDownloading((prev) => { const s = new Set(prev); s.delete(record.id); return s; });
    }, 3000);
  };

  const handleDelete = async (e: React.MouseEvent, record: TrainedModelRecord) => {
    e.stopPropagation();
    if (confirmDelete !== record.id) { setConfirmDelete(record.id); return; }
    setConfirmDelete(null);
    try {
      if (record.record_type === "autoresearch") {
        await trainingApi.deleteARJob(record.id);
      } else {
        await trainingApi.deleteJob(record.id);
      }
      setRecords((prev) => prev.filter((r) => r.id !== record.id));
      if (expandedId === record.id) setExpandedId(null);
    } catch { /* ignore */ }
  };

  const handleDeleteAll = async () => {
    setConfirmDeleteAll(false);
    try {
      await Promise.all([trainingApi.deleteAllJobs(), trainingApi.deleteAllARJobs()]);
      setRecords([]);
      setExpandedId(null);
    } catch { /* ignore */ }
  };

  const handleMerge = async (id: number) => {
    if (merging.has(id)) return;
    emitPipelineEvent({ kind: "start", label: "🔗 어댑터 병합 시작", detail: `작업 #${id}` });
    setMerging((prev) => new Set(prev).add(id));
    setMergeState((prev) => ({
      ...prev,
      [id]: { status: "merging", percent: 0, message: "병합 시작 중...", done: false, error: null, merged_dir: null },
    }));

    try {
      await trainingApi.mergeAdapter(id);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? String(e);
      setMergeState((prev) => ({
        ...prev,
        [id]: { status: "error", percent: 0, message: msg, done: true, error: msg, merged_dir: null },
      }));
      setMerging((prev) => { const s = new Set(prev); s.delete(id); return s; });
      return;
    }

    // Subscribe to SSE progress
    esRefs.current[id]?.close();
    const es = new EventSource(`/api/training/jobs/${id}/merge-progress`);
    esRefs.current[id] = es;
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.heartbeat) return;
        setMergeState((prev) => ({
          ...prev,
          [id]: {
            status: data.error ? "error" : data.done ? "done" : "merging",
            percent: data.percent ?? 0,
            message: data.message ?? "",
            done: !!data.done,
            error: data.error ?? null,
            merged_dir: data.merged_dir ?? null,
          },
        }));
        if (data.done) {
          emitPipelineEvent({ kind: data.error ? "failed" : "complete", label: data.error ? "🔗 병합 실패" : "🔗 어댑터 병합 완료", detail: `작업 #${id}` });
          es.close();
          delete esRefs.current[id];
          setMerging((prev) => { const s = new Set(prev); s.delete(id); return s; });
        }
      } catch { /* ignore */ }
    };
    es.onerror = () => {
      es.close();
      delete esRefs.current[id];
      setMerging((prev) => { const s = new Set(prev); s.delete(id); return s; });
    };
  };

  const handleMergedDownload = (id: number) => {
    const url = trainingApi.getMergedDownloadUrl(id);
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.click();
  };

  const filtered = records.filter((r) => filterStatus === "all" || r.status === filterStatus);
  const counts = {
    all: records.length,
    completed: records.filter((r) => r.status === "completed").length,
    cancelled: records.filter((r) => r.status === "cancelled").length,
    failed: records.filter((r) => r.status === "failed").length,
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span className="w-7 h-7 rounded-md bg-blue-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">7</span>
            <Trophy className="w-5 h-5 text-blue-600 flex-shrink-0" />
            <div>
              <div className="flex items-center gap-1"><h1 className="text-xl font-bold text-gray-900">훈련결과 보기</h1><PageHelp pageKey="trainingResults" /></div>
              <p className="text-xs text-gray-500">훈련된 모델 관리 · 어댑터 병합 · 배포 준비</p>
            </div>
          </div>
        </div>
        <button onClick={load} className="p-2 hover:bg-gray-100 rounded-lg">
          <RefreshCw className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      {/* 필터 탭 + 전체삭제 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {(["all", "completed", "cancelled", "failed"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filterStatus === s
                ? "bg-blue-600 text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:border-gray-300"
            }`}
          >
            {s === "all" ? "전체" : s === "completed" ? "완료" : s === "cancelled" ? "취소" : "실패"}
            <span className={`ml-1.5 px-1.5 py-0.5 rounded text-xs ${filterStatus === s ? "bg-blue-500" : "bg-gray-100 text-gray-500"}`}>
              {counts[s]}
            </span>
          </button>
        ))}
        {records.length > 0 && (
          <div className="ml-auto">
            {confirmDeleteAll ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-red-600 font-medium">{records.length}개 모두 삭제?</span>
                <button onClick={handleDeleteAll} className="px-2 py-0.5 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded transition-colors">확인</button>
                <button onClick={() => setConfirmDeleteAll(false)} className="px-2 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded transition-colors">취소</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDeleteAll(true)}
                className="flex items-center gap-1 px-2.5 py-1 text-xs text-red-500 hover:bg-red-50 rounded-lg transition-colors border border-red-200"
              >
                <Trash2 className="w-3.5 h-3.5" />전체 삭제
              </button>
            )}
          </div>
        )}
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400 text-sm">
          로딩 중...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <FolderOpen className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">훈련 결과가 없습니다</p>
          <button
            onClick={() => navigate("/training")}
            className="mt-3 text-xs text-blue-500 hover:underline"
          >
            모델 훈련 시작하기 →
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((record) => {
            const isExpanded = expandedId === record.id;
            const isLoRA = record.method === "lora" || record.method === "qlora";
            const methodMeta = METHOD_LABEL[record.method] ?? { label: record.method?.toUpperCase(), color: "bg-gray-100 text-gray-600" };
            const duration = record.started_at && record.completed_at
              ? Math.round((new Date(record.completed_at).getTime() - new Date(record.started_at).getTime()) / 60000)
              : null;
            const hasModel = !!record.output_dir;

            return (
              <div key={record.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* 카드 헤더 */}
                <div
                  className="px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : record.id)}
                >
                  <div className="flex items-start gap-3">
                    {/* 상태 아이콘 */}
                    <div className="mt-0.5 flex-shrink-0">
                      {record.status === "completed" && <CheckCircle className="w-4 h-4 text-green-500" />}
                      {record.status === "cancelled" && <XCircle className="w-4 h-4 text-orange-400" />}
                      {record.status === "failed" && <AlertCircle className="w-4 h-4 text-red-400" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* 이름 + 배지 */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-800">{record.name}</p>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${methodMeta.color}`}>
                          {methodMeta.label}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor(record.status)}`}>
                          {record.status === "completed" ? "완료" : record.status === "cancelled" ? "취소" : "실패"}
                        </span>
                        {isLoRA && (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-600 border border-amber-200">
                            어댑터
                          </span>
                        )}
                      </div>

                      {/* 요약 정보 */}
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 text-xs text-gray-500">
                        {record.model && (
                          <span className="flex items-center gap-1">
                            <Cpu className="w-3 h-3 text-gray-400" />
                            {record.model.name}
                            {record.model.parameter_count && ` (${record.model.parameter_count})`}
                          </span>
                        )}
                        {record.dataset && (
                          <span className="flex items-center gap-1">
                            <Database className="w-3 h-3 text-gray-400" />
                            {record.dataset.name}
                            <span className={`px-1 rounded text-xs ${record.dataset.data_type === "sft" ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"}`}>
                              {record.dataset.data_type.toUpperCase()}
                            </span>
                            ({record.dataset.train_count}개)
                          </span>
                        )}
                        {record.final_loss != null && (
                          <span className="flex items-center gap-1">
                            <BarChart2 className="w-3 h-3 text-gray-400" />
                            {record.record_type === "autoresearch" ? "최적 loss " : "loss "}
                            {record.final_loss.toFixed(4)}
                          </span>
                        )}
                        {record.record_type === "autoresearch" && record.trial_results && (
                          <span className="flex items-center gap-1 text-indigo-500">
                            {record.trial_results.length}/{record.max_trials ?? "?"} 시도
                          </span>
                        )}
                        {duration !== null && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-gray-400" />
                            {duration}분
                          </span>
                        )}
                        <span className="text-gray-400">{formatDate(record.created_at)}</span>
                      </div>
                    </div>

                    {/* 다운로드 + 삭제 + 펼치기 */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {hasModel && record.status === "completed" && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDownload(record); }}
                          disabled={downloading.has(record.id)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-60"
                          title={isLoRA ? `LoRA 어댑터 다운로드 (${fmtBytes(record.model_size_bytes)})` : `다운로드 (${fmtBytes(record.model_size_bytes)})`}
                        >
                          <Download className="w-3.5 h-3.5" />
                          {downloading.has(record.id) ? "준비 중..." : fmtBytes(record.model_size_bytes)}
                        </button>
                      )}
                      {confirmDelete === record.id ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <button onClick={(e) => handleDelete(e, record)} className="px-1.5 py-0.5 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded transition-colors">삭제</button>
                          <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); }} className="px-1.5 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded transition-colors">취소</button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => handleDelete(e, record)}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="삭제"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                    </div>
                  </div>
                </div>

                {/* 펼친 상세 */}
                {isExpanded && (
                  <div className="border-t border-gray-100 px-5 pb-5 pt-4 space-y-4 bg-gray-50">

                    {/* 훈련 설정 */}
                    {record.config && (
                      <div>
                        <p className="text-xs font-semibold text-gray-500 mb-2">훈련 설정</p>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(record.config)
                            .filter(([, v]) => v != null && v !== -1)
                            .map(([k, v]) => (
                              <span key={k} className="px-2 py-0.5 bg-white border border-gray-200 rounded text-xs text-gray-600">
                                <span className="text-gray-400">{k}=</span>
                                {typeof v === "number" && v < 0.01 ? (v as number).toExponential(1) : String(v)}
                              </span>
                            ))}
                        </div>
                      </div>
                    )}

                    {/* Loss 그래프 */}
                    {record.training_metrics && record.training_metrics.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-gray-500 mb-2">Loss 곡선</p>
                        <MetricsChart metrics={record.training_metrics} />
                      </div>
                    )}

                    {/* 출력 경로 */}
                    {record.output_dir && (
                      <div>
                        <p className="text-xs font-semibold text-gray-500 mb-1.5">저장 경로</p>
                        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
                          <code className="text-xs text-gray-600 font-mono flex-1 truncate">{record.output_dir}</code>
                          <CopyBtn text={record.output_dir} />
                        </div>
                      </div>
                    )}

                    {/* AutoResearch 시도 결과 */}
                    {record.record_type === "autoresearch" && record.trial_results && record.trial_results.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-gray-500 mb-2">
                          시도 결과 ({record.trial_results.length}회)
                        </p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs border-collapse">
                            <thead>
                              <tr className="bg-gray-100 text-gray-500">
                                <th className="px-2 py-1.5 text-left font-medium rounded-tl">시도</th>
                                <th className="px-2 py-1.5 text-right font-medium">Loss</th>
                                <th className="px-2 py-1.5 text-right font-medium">스텝</th>
                                <th className="px-2 py-1.5 text-right font-medium rounded-tr">시간</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...record.trial_results]
                                .sort((a, b) => a.final_loss - b.final_loss)
                                .map((t, i) => (
                                  <tr key={t.trial_id} className={`border-t border-gray-100 ${i === 0 ? "bg-green-50" : "bg-white"}`}>
                                    <td className="px-2 py-1.5 font-medium text-gray-700 flex items-center gap-1">
                                      {i === 0 && <span className="text-green-500 font-bold">★</span>}
                                      #{t.trial_id + 1}
                                    </td>
                                    <td className="px-2 py-1.5 text-right font-mono text-gray-700">{t.final_loss.toFixed(4)}</td>
                                    <td className="px-2 py-1.5 text-right text-gray-500">{t.steps}</td>
                                    <td className="px-2 py-1.5 text-right text-gray-500">{Math.round(t.duration_seconds)}s</td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* LoRA 가이드 */}
                    <LoraGuide record={record} />

                    {/* LoRA 병합 */}
                    {isLoRA && record.status === "completed" && hasModel && (() => {
                      const ms = mergeState[record.id];
                      return (
                        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold text-blue-700">베이스 모델 병합</p>
                            {ms?.done && !ms.error && ms.merged_dir && (
                              <span className="text-xs text-green-600 font-medium">병합 완료 ✓</span>
                            )}
                          </div>
                          <p className="text-xs text-blue-600">
                            LoRA 어댑터를 베이스 모델에 통합하여 단독 실행 가능한 전체 모델을 생성합니다.
                          </p>
                          {ms && (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-xs">
                                <span className={`flex items-center gap-1 ${ms.error ? "text-red-600" : "text-blue-600"}`}>
                                  {ms.error
                                    ? <AlertCircle className="w-3 h-3 flex-shrink-0" />
                                    : ms.done
                                    ? <CheckCircle className="w-3 h-3 flex-shrink-0 text-green-500" />
                                    : <svg className="w-3 h-3 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
                                      </svg>
                                  }
                                  {ms.message}
                                </span>
                                <span className="text-gray-400 font-mono">{ms.percent}%</span>
                              </div>
                              <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                                <div
                                  className={`h-1.5 rounded-full transition-all duration-500 ${ms.error ? "bg-red-400" : ms.done ? "bg-green-500" : "bg-blue-500"}`}
                                  style={{ width: `${ms.percent}%` }}
                                />
                              </div>
                            </div>
                          )}
                          <div className="flex gap-2">
                            {(!ms || ms.error) && (
                              <button
                                onClick={() => handleMerge(record.id)}
                                disabled={merging.has(record.id)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-60"
                              >
                                <GitMerge className="w-3.5 h-3.5" />
                                {merging.has(record.id) ? "병합 중..." : (ms?.error ? "재시도" : "병합 시작")}
                              </button>
                            )}
                            {ms?.done && !ms.error && ms.merged_dir && (
                              <button
                                onClick={() => handleMergedDownload(record.id)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg transition-colors"
                              >
                                <Download className="w-3.5 h-3.5" />
                                병합 모델 다운로드
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* 오류 메시지 */}
                    {record.error_message && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                        <p className="text-xs font-semibold text-red-700 mb-1">오류</p>
                        <p className="text-xs text-red-600 font-mono whitespace-pre-wrap break-all">{record.error_message}</p>
                      </div>
                    )}

                    {/* 액션 버튼 */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {hasModel && record.status === "completed" && (
                        <button
                          onClick={() => handleDownload(record)}
                          disabled={downloading.has(record.id)}
                          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
                        >
                          <Download className="w-4 h-4" />
                          {downloading.has(record.id)
                            ? "준비 중..."
                            : isLoRA
                            ? `LoRA 어댑터 다운로드 (${fmtBytes(record.model_size_bytes)})`
                            : `모델 다운로드 (${fmtBytes(record.model_size_bytes)})`}
                        </button>
                      )}
                      {hasModel && record.status === "completed" && (
                        <button
                          onClick={() => navigate(`/chat?model_path=${encodeURIComponent(record.output_dir!)}&model_name=${encodeURIComponent(record.name)}`)}
                          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 hover:border-gray-300 text-gray-700 text-sm font-medium rounded-lg transition-colors"
                        >
                          <MessageSquare className="w-4 h-4" />
                          채팅 테스트
                        </button>
                      )}
                      {confirmDelete === record.id ? (
                        <div className="flex items-center gap-1.5 ml-auto" onClick={(e) => e.stopPropagation()}>
                          <span className="text-xs text-red-600 font-medium">삭제하시겠습니까?</span>
                          <button onClick={(e) => handleDelete(e, record)} className="px-2 py-1 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded transition-colors">확인</button>
                          <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); }} className="px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded transition-colors">취소</button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => handleDelete(e, record)}
                          className="flex items-center gap-2 px-4 py-2 bg-white border border-red-200 hover:border-red-300 text-red-600 text-sm font-medium rounded-lg transition-colors ml-auto"
                        >
                          <Trash2 className="w-4 h-4" />
                          삭제
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TrainingResults;
