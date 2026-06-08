import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { BarChart3, RefreshCw, FileText, Download, Play, Loader, CheckCircle, AlertCircle, Trash2, StopCircle } from "lucide-react";
import { api, evaluationApi, trainingApi, trainingDataApi, modelsApi, benchmarkApi, TrainingJob, EvaluationResult, ModelInfo, ARJob, Dataset, BenchmarkRunRow } from "../services/api";
import { formatDate } from "../lib/utils";
import { useAgentPolling } from "../hooks/useAgentPolling";

const OWNED_PATH = "/evaluation";
const AGENT_PAGE_START_EVENT = "nella-agent-page-start";
const SS_AGENT_ACTIVE_PAGE = "nella.agent.activePage";
import PageHelp from "../components/PageHelp";
import { emitPipelineEvent } from "../pipelineEvent";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, RadarChart,
  PolarGrid, PolarAngleAxis, Radar, Legend,
} from "recharts";

// ── 벤치마크 정의 ─────────────────────────────────
const BENCHMARKS = [
  { id: "mmlu",        name: "MMLU",        desc: "Massive Multitask Language Understanding",     shots: 5,  category: "일반", color: "#3b82f6" },
  { id: "arc_easy",   name: "ARC-Easy",    desc: "AI2 Reasoning Challenge (쉬운 문제)",            shots: 0,  category: "추론", color: "#8b5cf6" },
  { id: "arc_challenge", name: "ARC-Challenge", desc: "AI2 Reasoning Challenge (어려운 문제)",    shots: 25, category: "추론", color: "#7c3aed" },
  { id: "hellaswag",  name: "HellaSwag",   desc: "상식 추론 완성 평가",                              shots: 10, category: "상식", color: "#06b6d4" },
  { id: "truthfulqa", name: "TruthfulQA",  desc: "사실 정확성 평가",                               shots: 0,  category: "사실", color: "#f59e0b" },
  { id: "gsm8k",      name: "GSM8K",       desc: "수학 문제 풀기 (초등~중학 수준)",                  shots: 5,  category: "수학", color: "#10b981" },
  { id: "winogrande", name: "WinoGrande",  desc: "상식·대명사 해석 추론",                           shots: 5,  category: "상식", color: "#ef4444" },
  { id: "ko_mmlu",    name: "Ko-MMLU",     desc: "한국어 MMLU (Korean MMLU)",                    shots: 5,  category: "한국어", color: "#f97316" },
  { id: "klue",       name: "KLUE",        desc: "Korean Language Understanding Evaluation",    shots: 0,  category: "한국어", color: "#ec4899" },
];

type EvalTab = "basic" | "benchmark";

// 백엔드 BenchmarkRunRow를 BenchmarkChart props 형태로 정규화
const toChartInput = (row: BenchmarkRunRow) => ({
  modelName: row.model_name,
  benchmarks: row.tasks,
  results: Object.fromEntries(
    Object.entries(row.results ?? {}).filter(([, v]) => typeof v === "number"),
  ) as Record<string, number>,
});

// ── 기본 평가 지표 배지 ───────────────────────────
const MetricBadge: React.FC<{ label: string; value?: number | null }> = ({ label, value }) => {
  if (value === null || value === undefined) return null;
  return (
    <div className="text-center p-2 bg-gray-50 rounded-lg">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-bold text-gray-800">{typeof value === "number" ? value.toFixed(4) : value}</p>
    </div>
  );
};

// ── 벤치마크 결과 차트 ────────────────────────────
interface ChartInput {
  modelName: string;
  benchmarks: string[];
  results: Record<string, number>;
}

const BenchmarkChart: React.FC<{ run: ChartInput }> = ({ run }) => {
  const barData = BENCHMARKS
    .filter((b) => run.benchmarks.includes(b.id) && run.results[b.id] !== undefined)
    .map((b) => ({ name: b.name, score: Math.round(run.results[b.id] * 100), fill: b.color }));

  const radarData = barData.map((d) => ({ subject: d.name, score: d.score }));

  if (barData.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* Bar chart */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-2">벤치마크 점수 (정확도 %)</p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={barData} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
            <Tooltip formatter={(v: number) => [`${v}%`, "정확도"]} />
            <Bar dataKey="score" radius={[4, 4, 0, 0]}>
              {barData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Radar chart (if 3+ benchmarks) */}
      {radarData.length >= 3 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">레이더 차트</p>
          <ResponsiveContainer width="100%" height={220}>
            <RadarChart data={radarData}>
              <PolarGrid />
              <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10 }} />
              <Radar name={run.modelName} dataKey="score" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.25} />
              <Legend />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Score table */}
      <div className="grid grid-cols-3 gap-2">
        {barData.map((d) => (
          <div key={d.name} className="bg-gray-50 rounded-lg p-2 text-center">
            <p className="text-xs text-gray-500">{d.name}</p>
            <p className="text-sm font-bold" style={{ color: d.fill }}>{d.score}%</p>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── 메인 ─────────────────────────────────────────
const Evaluation: React.FC = () => {
  const [tab, setTab] = useState<EvalTab>("basic");

  // Basic evaluation
  const [completedJobs, setCompletedJobs] = useState<TrainingJob[]>([]);
  const [completedARJobs, setCompletedARJobs] = useState<ARJob[]>([]);
  const [evaluations, setEvaluations] = useState<EvaluationResult[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [form, setForm] = useState({ training_job_id: "", job_type: "sft" as "sft" | "ar", use_llm_judge: false, sample_limit: 100, dataset_id: "" });
  const [running, setRunning] = useState(false);
  const [runningEvalId, setRunningEvalId] = useState<number | null>(null);
  const [evalProgress, setEvalProgress] = useState<{ pct: number; step: string; done: boolean; error?: boolean } | null>(null);
  const [report, setReport] = useState<{ id: number; text: string } | null>(null);
  const autoJobRef = useRef(false);
  const autoReportRef = useRef<number | null>(null);
  const progressPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const processedAgentEvalRef = useRef<number | null>(null);
  const processedAgentBenchmarkRef = useRef<number | null>(null);
  const [benchAgentProgress, setBenchAgentProgress] = useState<
    | { status: string; phase?: string; percent?: number; message?: string; model_ids?: string[]; tasks?: string[] }
    | null
  >(null);

  // Benchmark evaluation
  const [downloadedModels, setDownloadedModels] = useState<ModelInfo[]>([]);
  const downloadedModelsRef = useRef<ModelInfo[]>([]);
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
  const [modelSearch, setModelSearch] = useState("");
  const [selectedBenchmarks, setSelectedBenchmarks] = useState<Set<string>>(new Set(["mmlu", "arc_challenge", "hellaswag"]));
  const [benchmarkRuns, setBenchmarkRuns] = useState<BenchmarkRunRow[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [benchRunning, setBenchRunning] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  const load = async () => {
    const [jobs, arJobs, evals, ds] = await Promise.all([
      trainingApi.listJobs(),
      trainingApi.listARJobs(),
      evaluationApi.list(),
      trainingDataApi.list(),
    ]);
    setCompletedJobs(jobs.data.filter((j: TrainingJob) => j.status === "completed"));
    setCompletedARJobs(arJobs.data.filter((j: ARJob) => j.status === "completed"));
    setEvaluations(evals.data);
    setDatasets(ds.data.filter((d: Dataset) => d.test_path));
  };

  // Progress polling
  useEffect(() => {
    if (!runningEvalId) return;
    if (progressPollRef.current) clearInterval(progressPollRef.current);
    progressPollRef.current = setInterval(async () => {
      try {
        const res = await evaluationApi.getProgress(runningEvalId);
        setEvalProgress(res.data);
        if (res.data.done) {
          emitPipelineEvent({ kind: "complete", label: "📊 모델 평가 완료" });
          clearInterval(progressPollRef.current!);
          progressPollRef.current = null;
          setRunning(false);
          setRunningEvalId(null);
          setTimeout(load, 1000);
        }
      } catch { /* ignore */ }
    }, 1500);
    return () => { if (progressPollRef.current) clearInterval(progressPollRef.current); };
  }, [runningEvalId]);

  const isActive = useLocation().pathname === OWNED_PATH;
  useAgentPolling(load, { idle: 3_000, active: 2_000, enabled: isActive });
  useEffect(() => {
    modelsApi.listCurated().then((r) => setDownloadedModels(r.data.filter((m: ModelInfo) => m.is_downloaded))).catch(() => {});
  }, []);
  useEffect(() => {
    downloadedModelsRef.current = downloadedModels;
  }, [downloadedModels]);

  // NELLA가 mount 전/도중에 run_evaluation을 호출하는 race를 잡기 위해
  // mount 직후 + 2초 주기로 active evaluations를 폴링한다. 진행 중인 eval_id를 발견하면 자동으로 진행률 표시.
  // 페이지가 활성일 때만 — 숨겨진 페이지에서는 폴링하지 않음.
  useEffect(() => {
    if (!isActive) return;
    const pickup = async () => {
      try {
        const res = await evaluationApi.listActive();
        const active = res.data ?? [];
        if (active.length === 0) return;
        const first = active[0];
        // 이미 같은 eval_id를 폴링 중이면 skip.
        setRunningEvalId((prev) => (prev === first.eval_id ? prev : first.eval_id));
        setRunning(true);
        setEvalProgress({ pct: first.pct ?? 0, step: first.step || "NELLA가 평가를 시작했습니다.", done: false });
      } catch { /* ignore */ }
    };
    pickup();
    const t = window.setInterval(pickup, 2000);
    return () => window.clearInterval(t);
  }, [isActive]);

  const selectedTestDataset = datasets.find((d) => String(d.id) === form.dataset_id);
  const sampleMax = Math.max(1, selectedTestDataset?.test_count ?? 1000);

  useEffect(() => {
    const applyAgentEvaluation = (detail: { args?: Record<string, unknown>; result?: Record<string, unknown>; ts?: number }) => {
      const ts = detail.ts ?? Date.now();
      if (processedAgentEvalRef.current === ts) return;
      processedAgentEvalRef.current = ts;
      const result = detail.result ?? {};
      const args = detail.args ?? {};
      const evalId = Number(result.eval_id);
      if (!evalId) return;
      const trainingJobId = String(args.training_job_id ?? "");
      const datasetId = args.dataset_id != null ? String(args.dataset_id) : form.dataset_id;
      const ds = datasets.find((d) => String(d.id) === datasetId);
      setForm((prev) => ({
        ...prev,
        training_job_id: trainingJobId || prev.training_job_id,
        job_type: "sft",
        dataset_id: datasetId,
        use_llm_judge: Boolean(args.use_llm_judge ?? prev.use_llm_judge),
        sample_limit: Math.max(1, Math.min(Number(args.sample_limit ?? ds?.test_count ?? prev.sample_limit), Math.max(1, ds?.test_count ?? 1000))),
      }));
      setRunning(true);
      setRunningEvalId(evalId);
      setEvalProgress({ pct: 0, step: "NELLA가 평가를 시작했습니다.", done: false });
    };

    const applyAgentBenchmark = (detail: { args?: Record<string, unknown>; result?: Record<string, unknown>; ts?: number }) => {
      const ts = detail.ts ?? Date.now();
      if (processedAgentBenchmarkRef.current === ts) return;
      processedAgentBenchmarkRef.current = ts;
      const args = detail.args ?? {};
      const result = detail.result ?? {};
      const toStrArray = (v: unknown): string[] =>
        Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
      const modelIds = toStrArray(result.model_ids).length
        ? toStrArray(result.model_ids)
        : toStrArray(args.model_ids);
      const tasks = toStrArray(result.tasks).length
        ? toStrArray(result.tasks)
        : toStrArray(args.tasks);
      const groupId =
        (typeof result.group_id === "string" && result.group_id) ||
        (typeof args.group_id === "string" && (args.group_id as string)) ||
        null;
      const status = typeof result.status === "string" ? (result.status as string) : "";

      setTab("benchmark");
      if (modelIds.length) setSelectedModelIds(new Set(modelIds));
      if (tasks.length) setSelectedBenchmarks(new Set(tasks));
      if (groupId) {
        setActiveGroupId(groupId);
        if (status === "started" || status === "running" || status === "in_progress") {
          setBenchRunning(true);
        } else if (status === "completed" || status === "failed") {
          setBenchRunning(false);
        }
      }
      // 결과 조회/대기/취소 도구는 최신 목록을 즉시 한 번 가져와 표시
      benchmarkApi.list(50).then((res) => setBenchmarkRuns(res.data)).catch(() => {});
    };

    const handleAgentResult = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string; args?: Record<string, unknown>; result?: Record<string, unknown> }>).detail;
      if (detail?.name === "run_evaluation") applyAgentEvaluation(detail);
      else if (
        detail?.name === "run_benchmark" ||
        detail?.name === "wait_for_benchmark" ||
        detail?.name === "get_benchmark_results" ||
        detail?.name === "cancel_benchmark"
      ) {
        applyAgentBenchmark(detail);
      }
    };
    window.addEventListener("nella-agent-tool-result", handleAgentResult);

    try {
      const stored = window.sessionStorage.getItem("nella.agent.lastToolResult");
      if (stored) {
        const parsed = JSON.parse(stored) as { name?: string; args?: Record<string, unknown>; result?: Record<string, unknown>; ts?: number };
        if (parsed.ts && Date.now() - parsed.ts < 10_000 && parsed.result) {
          if (parsed.name === "run_evaluation") {
            applyAgentEvaluation(parsed);
          } else if (
            parsed.name === "run_benchmark" ||
            parsed.name === "wait_for_benchmark" ||
            parsed.name === "get_benchmark_results" ||
            parsed.name === "cancel_benchmark"
          ) {
            applyAgentBenchmark(parsed);
          }
        }
      }
    } catch { /* ignore */ }

    return () => window.removeEventListener("nella-agent-tool-result", handleAgentResult);
  }, [datasets, form.dataset_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // NELLA 승인 직후: agent-page-start 이벤트로 벤치마크 단계가 시작됐음을 감지하면
  // 즉시 벤치마크 탭으로 전환하고 "준비 중" 상태를 표시한다. 도구 결과가 도착하기 전까지의 빈 화면을 메운다.
  useEffect(() => {
    const isBenchmarkLabel = (label?: string) => {
      if (!label) return false;
      const l = label.toLowerCase();
      return l.includes("벤치마크") || l.includes("benchmark") || l.includes("run_benchmark") || l.includes("lm_eval") || l.includes("lm-eval");
    };
    const applyStart = (detail: { page?: string; label?: string }) => {
      if (detail?.page !== OWNED_PATH) return;
      if (!isBenchmarkLabel(detail.label)) return;
      setTab("benchmark");
      setBenchRunning(true);
      setBenchAgentProgress((prev) => prev ?? {
        status: "running",
        phase: "preparing",
        percent: 5,
        message: detail.label || "벤치마크 평가를 준비하고 있습니다.",
      });
    };
    const onPageStart = (event: Event) => {
      const detail = (event as CustomEvent<{ page?: string; label?: string; ts?: number }>).detail;
      applyStart(detail || {});
    };
    window.addEventListener(AGENT_PAGE_START_EVENT, onPageStart);
    try {
      const stored = window.sessionStorage.getItem(SS_AGENT_ACTIVE_PAGE);
      if (stored) {
        const parsed = JSON.parse(stored) as { page?: string; label?: string; ts?: number };
        if (parsed?.ts && Date.now() - parsed.ts < 10_000) applyStart(parsed);
      }
    } catch { /* ignore */ }
    return () => window.removeEventListener(AGENT_PAGE_START_EVENT, onPageStart);
  }, []);

  // 벤치마크 탭이 활성이고 NELLA가 작업 중일 때 /chat/agent-progress/benchmark 폴링
  // → run_benchmark 도구가 반환되기 전부터 model_ids/tasks/percent/message가 화면에 반영된다.
  useEffect(() => {
    if (!isActive) return;
    if (tab !== "benchmark") return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await api.get<{
          status?: string; phase?: string; percent?: number; message?: string;
          model_ids?: string[]; tasks?: string[];
        }>("/chat/agent-progress/benchmark");
        if (!alive) return;
        const p = res.data;
        if (!p || !p.status || p.status === "idle") {
          if (!activeGroupId) setBenchAgentProgress(null);
          return;
        }
        setBenchAgentProgress({
          status: p.status,
          phase: p.phase,
          percent: p.percent,
          message: p.message,
          model_ids: p.model_ids,
          tasks: p.tasks,
        });
        if (Array.isArray(p.model_ids) && p.model_ids.length) {
          setSelectedModelIds((prev) => {
            const next = new Set<string>();
            for (const id of p.model_ids!) next.add(String(id));
            if (prev.size === next.size && Array.from(prev).every((x) => next.has(x))) return prev;
            return next;
          });
          // 새로 다운로드돼서 downloadedModels 캐시에 없는 모델이 섞여 있으면 목록을 다시 가져온다.
          // (없는 ID는 selectedModelIds에 들어가도 체크박스 row 자체가 안 그려져 "체크 안 됨"으로 보임)
          // sft:/ar: 프리픽스는 학습한 모델이라 downloadedModels와 무관하므로 검사 대상에서 제외.
          const have = new Set(downloadedModelsRef.current.map((m) => m.hf_model_id));
          const missing = p.model_ids.some((id) => {
            const s = String(id);
            if (s.startsWith("sft:") || s.startsWith("ar:")) return false;
            return !have.has(s);
          });
          if (missing) {
            modelsApi
              .listCurated()
              .then((r) => setDownloadedModels(r.data.filter((m: ModelInfo) => m.is_downloaded)))
              .catch(() => {});
          }
        }
        if (Array.isArray(p.tasks) && p.tasks.length) {
          setSelectedBenchmarks((prev) => {
            const next = new Set<string>();
            for (const t of p.tasks!) next.add(String(t));
            if (prev.size === next.size && Array.from(prev).every((x) => next.has(x))) return prev;
            return next;
          });
        }
        if (p.status === "running") setBenchRunning(true);
        if (p.status === "error" || p.phase === "error") setBenchRunning(false);
      } catch { /* ignore */ }
    };
    tick();
    const handle = window.setInterval(tick, 1500);
    return () => { alive = false; window.clearInterval(handle); };
  }, [isActive, tab, activeGroupId]);

  // 최신 완료 훈련 작업 자동 선택 (SFT → AR 순서로 최신 ID 우선)
  useEffect(() => {
    if (autoJobRef.current) return;
    const hasAR = completedARJobs.length > 0;
    const hasSFT = completedJobs.length > 0;
    if (!hasAR && !hasSFT) return;
    autoJobRef.current = true;
    if (hasAR) {
      const latest = completedARJobs.reduce((a, b) => (a.id > b.id ? a : b));
      setForm((prev) => ({ ...prev, training_job_id: String(latest.id), job_type: "ar" }));
    } else {
      const latest = completedJobs.reduce((a, b) => (a.id > b.id ? a : b));
      setForm((prev) => ({ ...prev, training_job_id: String(latest.id), job_type: "sft" }));
    }
  }, [completedJobs, completedARJobs]);

  // 최신 평가 리포트 자동 로드 — 완료된 평가에 대해서만 (미완료 시 다음 폴링에서 재시도)
  useEffect(() => {
    if (evaluations.length === 0) return;
    const latest = evaluations.reduce((a, b) => (a.id > b.id ? a : b));
    if (autoReportRef.current === latest.id) return;
    const isComplete = latest.metrics_detail?.completed === true || (latest.bleu_score != null);
    if (!isComplete) return; // 아직 실행 중 — ref 설정하지 않고 다음 폴링에서 재확인
    autoReportRef.current = latest.id;
    evaluationApi.getReport(latest.id).then((res) => {
      if (res.data?.report) setReport({ id: latest.id, text: res.data.report });
    }).catch(() => {});
  }, [evaluations]);

  const handleRun = async () => {
    if (running) {
      if (runningEvalId) await evaluationApi.cancel(runningEvalId).catch(() => {});
      if (progressPollRef.current) {
        clearInterval(progressPollRef.current);
        progressPollRef.current = null;
      }
      setEvalProgress({ pct: 0, step: "평가를 중지했습니다.", done: true, error: true });
      setRunning(false);
      setRunningEvalId(null);
      emitPipelineEvent({ kind: "failed", label: "📊 모델 평가 중지", detail: "사용자 요청으로 중지됨" });
      return;
    }
    if (!form.training_job_id) return;
    emitPipelineEvent({ kind: "start", label: "📊 모델 평가 시작", detail: `${form.job_type === "ar" ? "AutoResearch" : "SFT"} 작업 #${form.training_job_id}` });
    setRunning(true);
    setEvalProgress({ pct: 0, step: "요청 전송 중...", done: false });
    try {
      const datasetId = form.dataset_id ? Number(form.dataset_id) : undefined;
      if (form.job_type === "ar") {
        const res = await evaluationApi.runAR({
          autoresearch_job_id: Number(form.training_job_id),
          use_llm_judge: form.use_llm_judge,
          sample_limit: Math.max(1, Math.min(form.sample_limit || sampleMax, sampleMax)),
          dataset_id: datasetId,
        });
        setRunningEvalId(res.data.eval_id);
      } else {
        const res = await evaluationApi.run({
          training_job_id: Number(form.training_job_id),
          use_llm_judge: form.use_llm_judge,
          sample_limit: Math.max(1, Math.min(form.sample_limit || sampleMax, sampleMax)),
          dataset_id: datasetId,
        });
        setRunningEvalId(res.data.id);
      }
    } catch (e) {
      console.error(e);
      setRunning(false);
      setEvalProgress(null);
    }
  };

  const handleReport = async (id: number) => {
    if (report?.id === id) { setReport(null); return; }
    const res = await evaluationApi.getReport(id);
    setReport({ id, text: res.data.report });
  };

  const handleDeleteAllEvals = async () => {
    setConfirmDeleteAll(false);
    try {
      await evaluationApi.deleteAll();
      setEvaluations([]);
      setReport(null);
    } catch (e) { console.error(e); }
  };

  const handleCancelEval = async (id: number) => {
    emitPipelineEvent({ kind: "cancel", label: "📊 평가 취소", detail: `평가 #${id}` });
    try {
      await evaluationApi.cancel(id);
      setRunning(false);
      load();
    } catch (e) { console.error(e); }
  };

  const toggleBenchmark = (id: string) => {
    setSelectedBenchmarks((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleModelId = (id: string) => {
    setSelectedModelIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleRunBenchmarks = async () => {
    if (benchRunning && activeGroupId) {
      try { await benchmarkApi.cancel(activeGroupId); } catch { /* ignore */ }
      emitPipelineEvent({ kind: "cancel", label: "📈 벤치마크 중단", detail: "사용자 요청으로 중단됨" });
      return;
    }
    if (selectedModelIds.size === 0 || selectedBenchmarks.size === 0) return;
    setBenchRunning(true);
    emitPipelineEvent({
      kind: "start",
      label: "📈 벤치마크 시작",
      detail: `${selectedModelIds.size}개 모델 × ${selectedBenchmarks.size}개 태스크`,
    });
    try {
      const res = await benchmarkApi.run({
        model_ids: Array.from(selectedModelIds),
        tasks: Array.from(selectedBenchmarks),
      });
      setActiveGroupId(res.data.group_id);
    } catch (e) {
      setBenchRunning(false);
      emitPipelineEvent({
        kind: "failed",
        label: "📈 벤치마크 실패",
        detail: (e as { message?: string })?.message ?? "요청 실패",
      });
    }
  };

  // 초기 로드: 최근 벤치마크 결과 가져오기
  useEffect(() => {
    let cancelled = false;
    benchmarkApi.list(50).then((res) => {
      if (!cancelled) setBenchmarkRuns(res.data);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // 폴링: 활성 그룹의 모든 row가 terminal 상태가 될 때까지 1.5초 간격으로 조회
  useEffect(() => {
    if (!activeGroupId) return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await benchmarkApi.list(50);
        if (!alive) return;
        setBenchmarkRuns(res.data);
        const groupRows = res.data.filter((r) => r.group_id === activeGroupId);
        const stillRunning = groupRows.some(
          (r) => r.status === "pending" || r.status === "running",
        );
        if (groupRows.length > 0 && !stillRunning) {
          setBenchRunning(false);
          setActiveGroupId(null);
          setBenchAgentProgress(null);
          const succeeded = groupRows.filter((r) => r.status === "completed").length;
          emitPipelineEvent({
            kind: "complete",
            label: "📈 벤치마크 완료",
            detail: `${succeeded}/${groupRows.length}개 모델 성공`,
          });
        }
      } catch { /* keep polling */ }
    };
    const handle = setInterval(tick, 1500);
    tick();
    return () => { alive = false; clearInterval(handle); };
  }, [activeGroupId]);

  const categories = [...new Set(BENCHMARKS.map((b) => b.category))];

  // benchmarkRuns(가장 최신 id desc)을 group_id별로 묶음. 같은 group_id의 row들이 한 묶음.
  const benchmarkGroups = useMemo<BenchmarkGroup[]>(() => {
    const order: string[] = [];
    const map = new Map<string, BenchmarkRunRow[]>();
    for (const row of benchmarkRuns) {
      const gid = row.group_id || `single_${row.id}`;
      if (!map.has(gid)) { map.set(gid, []); order.push(gid); }
      map.get(gid)!.push(row);
    }
    return order.map((gid) => ({ groupId: gid, rows: map.get(gid)! }));
  }, [benchmarkRuns]);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="w-7 h-7 rounded-md bg-blue-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">8</span>
          <BarChart3 className="w-5 h-5 text-blue-600 flex-shrink-0" />
          <div>
            <div className="flex items-center gap-1"><h1 className="text-xl font-bold text-gray-900">모델 평가</h1><PageHelp pageKey="evaluation" /></div>
            <p className="text-xs text-gray-500">BLEU · ROUGE 등 성능 지표로 모델 평가</p>
          </div>
        </div>
        <button onClick={load} className="p-2 hover:bg-gray-100 rounded-lg"><RefreshCw className="w-4 h-4 text-gray-500" /></button>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {([
          { id: "basic",     label: "기본 평가",     icon: BarChart3 },
          { id: "benchmark", label: "벤치마크 평가",  icon: CheckCircle },
        ] as { id: EvalTab; label: string; icon: React.ElementType }[]).map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === id ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}>
            <Icon className="w-3.5 h-3.5" />{label}
          </button>
        ))}
      </div>

      {/* ── 기본 평가 탭 ── */}
      {tab === "basic" && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-700">평가 실행</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-600">완료된 훈련 작업</label>
                <select
                  value={`${form.job_type}:${form.training_job_id}`}
                  onChange={(e) => {
                    const [type, id] = e.target.value.split(":");
                    setForm({ ...form, job_type: type as "sft" | "ar", training_job_id: id });
                  }}
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  <option value=":">작업 선택...</option>
                  {completedARJobs.length > 0 && (
                    <optgroup label="AutoResearch 작업">
                      {completedARJobs.map((j) => (
                        <option key={`ar:${j.id}`} value={`ar:${j.id}`}>
                          [AutoResearch] {j.name} (#{j.id})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {completedJobs.length > 0 && (
                    <optgroup label="일반 훈련 작업">
                      {completedJobs.map((j) => (
                        <option key={`sft:${j.id}`} value={`sft:${j.id}`}>
                          [{j.method?.toUpperCase() ?? "SFT"}] {j.name} (#{j.id})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">테스트 데이터셋</label>
                <select
                  value={form.dataset_id}
                  onChange={(e) => {
                    const datasetId = e.target.value;
                    const ds = datasets.find((d) => String(d.id) === datasetId);
                    setForm({ ...form, dataset_id: datasetId, sample_limit: ds ? Math.max(1, ds.test_count) : form.sample_limit });
                  }}
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">훈련 작업 기본값 사용</option>
                  {datasets.map((d) => (
                    <option key={d.id} value={String(d.id)}>
                      {d.name} (테스트 {d.test_count}개)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">샘플 수 (최대 {sampleMax}개)</label>
                <input type="number" value={form.sample_limit === 0 ? "" : Math.min(form.sample_limit, sampleMax)} min={1} max={sampleMax}
                  onChange={(e) => {
                    const value = e.target.value;
                    setForm({ ...form, sample_limit: value === "" ? 0 : Math.max(1, Math.min(Number(value), sampleMax)) });
                  }}
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={form.use_llm_judge} onChange={(e) => setForm({ ...form, use_llm_judge: e.target.checked })} className="rounded" />
                  LLM 심사
                </label>
              </div>
            </div>
            <button onClick={handleRun} disabled={!running && !form.training_job_id}
              className={`flex items-center gap-2 px-6 py-2 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
                running ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
              }`}>
              {running ? <><StopCircle className="w-4 h-4" />평가 중지</> : "평가 시작"}
            </button>

            {/* Progress bar */}
            {running && evalProgress && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-gray-600">
                  <span className="flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-500" />
                    {evalProgress.step}
                  </span>
                  <span className="font-semibold text-blue-600">{evalProgress.pct}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-2 rounded-full transition-all duration-700 ease-in-out ${evalProgress.error ? "bg-red-500" : "bg-blue-500"}`}
                    style={{ width: `${evalProgress.pct}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* 실행 중인 평가 배너 */}
          {evaluations.filter((ev) => ev.status === "running" || ev.status === "pending" || (!ev.metrics_detail && !ev.bleu_score && !ev.perplexity)).map((ev) => (
            <div key={ev.id} className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3">
              <RefreshCw className="w-5 h-5 text-blue-500 animate-spin flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-blue-800">평가 #{ev.id} 실행 중</p>
                <p className="text-xs text-blue-600">훈련 작업 #{ev.training_job_id} · {ev.sample_count}개 샘플 평가 중...</p>
              </div>
              <button
                onClick={() => handleCancelEval(ev.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-medium rounded-lg transition-colors"
              >
                <StopCircle className="w-3.5 h-3.5" />중단
              </button>
            </div>
          ))}

          <div className="space-y-4">
            {evaluations.length > 0 && (
              <div className="flex justify-end">
                {confirmDeleteAll ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-red-600 font-medium">{evaluations.length}개 모두 삭제?</span>
                    <button onClick={handleDeleteAllEvals} className="px-2 py-0.5 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded transition-colors">확인</button>
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
            {evaluations.length === 0 ? (
              <div className="text-center p-8 bg-white rounded-xl border border-gray-200">
                <BarChart3 className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                <p className="text-gray-400 text-sm">평가 결과 없음</p>
              </div>
            ) : evaluations.map((ev) => (
              <div key={ev.id} className={`bg-white rounded-xl border p-5 ${report?.id === ev.id ? "border-blue-300" : "border-gray-200"}`}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-800">평가 #{ev.id}</p>
                      {(ev.status === "running" || ev.status === "pending") && (
                        <span className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                          <RefreshCw className="w-3 h-3 animate-spin" />실행 중
                        </span>
                      )}
                      {ev.status === "completed" && (
                        <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">완료</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">작업 #{ev.training_job_id} · {formatDate(ev.created_at)} · {ev.sample_count}개 샘플</p>
                  </div>
                  <button onClick={() => handleReport(ev.id)}
                    className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      report?.id === ev.id ? "bg-blue-50 text-blue-700 border-blue-200" : "text-gray-600 hover:bg-gray-100 border-gray-200"
                    }`}>
                    <FileText className="w-3 h-3" />{report?.id === ev.id ? "리포트 닫기" : "리포트"}
                  </button>
                </div>
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                  <MetricBadge label="BLEU" value={ev.bleu_score} />
                  <MetricBadge label="ROUGE-1" value={ev.rouge1_score} />
                  <MetricBadge label="ROUGE-2" value={ev.rouge2_score} />
                  <MetricBadge label="ROUGE-L" value={ev.rougeL_score} />
                  <MetricBadge label="Perplexity" value={ev.perplexity} />
                  <MetricBadge label="LLM 심사" value={ev.llm_judge_score} />
                </div>
                {report?.id === ev.id && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <p className="text-xs font-semibold text-gray-500 mb-2">상세 평가 리포트</p>
                    <pre className="text-xs font-mono bg-gray-50 p-4 rounded-lg overflow-auto whitespace-pre-wrap text-gray-700 max-h-64">{report.text}</pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── 벤치마크 평가 탭 ── */}
      {tab === "benchmark" && (
        <div className="space-y-6">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
            <strong>lm-evaluation-harness</strong> (EleutherAI) 기반 자동 벤치마크 평가.
            선택한 벤치마크 데이터셋을 자동으로 다운로드하여 평가를 수행하고 결과를 그래프로 표시합니다.
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
            {/* 설정 */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4 min-w-0 overflow-hidden">
              <h2 className="text-sm font-semibold text-gray-700">벤치마크 설정</h2>

              <div>
                <label className="text-xs font-medium text-gray-600 flex items-center gap-2">
                  검증 모델 선택
                  <span className="text-xs text-gray-400">({selectedModelIds.size}개)</span>
                </label>
                <input
                  type="text"
                  placeholder="모델 이름 검색..."
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
                <div className="mt-2 max-h-56 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {(() => {
                    type PickerEntry = {
                      id: string;
                      kind: "base" | "sft" | "ar";
                      name: string;
                      sub: string;
                    };
                    const q = modelSearch.toLowerCase();
                    const matches = (e: PickerEntry) =>
                      !q || e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q) || e.sub.toLowerCase().includes(q);
                    const baseEntries: PickerEntry[] = downloadedModels.map((m) => ({
                      id: m.hf_model_id,
                      kind: "base",
                      name: m.name,
                      sub: m.hf_model_id,
                    }));
                    const sftEntries: PickerEntry[] = completedJobs.map((j) => ({
                      id: `sft:${j.id}`,
                      kind: "sft",
                      name: j.name,
                      sub: `훈련 작업 #${j.id} · ${(j.method || "SFT").toUpperCase()}`,
                    }));
                    const arEntries: PickerEntry[] = completedARJobs.map((j) => ({
                      id: `ar:${j.id}`,
                      kind: "ar",
                      name: j.name,
                      sub: `AutoResearch #${j.id}`,
                    }));
                    const all = [...sftEntries, ...arEntries, ...baseEntries].filter(matches);
                    const kindBadge = (k: PickerEntry["kind"]) => {
                      if (k === "sft") return { label: "SFT", cls: "bg-purple-100 text-purple-700" };
                      if (k === "ar") return { label: "AR", cls: "bg-indigo-100 text-indigo-700" };
                      return { label: "기반", cls: "bg-slate-100 text-slate-600" };
                    };
                    return all.map((e) => {
                      const badge = kindBadge(e.kind);
                      const checked = selectedModelIds.has(e.id);
                      return (
                        <label
                          key={e.id}
                          className={`flex items-start gap-2 px-3 py-2 text-sm cursor-pointer transition-colors ${
                            checked ? "bg-blue-50" : "hover:bg-gray-50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleModelId(e.id)}
                            className="w-3.5 h-3.5 accent-blue-600 mt-1 flex-shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${badge.cls} flex-shrink-0`}>{badge.label}</span>
                              <p className={`text-sm font-medium truncate ${checked ? "text-blue-700" : "text-gray-800"}`}>{e.name}</p>
                            </div>
                            <p className="text-xs text-gray-400 truncate">{e.sub}</p>
                          </div>
                        </label>
                      );
                    });
                  })()}
                </div>
                {downloadedModels.length === 0 && completedJobs.length === 0 && completedARJobs.length === 0 && (
                  <p className="text-xs text-yellow-600 mt-1">기반모델을 다운로드하거나 훈련 작업을 완료한 뒤 선택하세요.</p>
                )}
                {(completedJobs.length > 0 || completedARJobs.length > 0) && (
                  <p className="text-xs text-gray-400 mt-1">학습한 모델을 선택하면 LoRA 어댑터를 자동 인식해 평가합니다.</p>
                )}
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 block mb-2">벤치마크 선택</label>
                {categories.map((cat) => (
                  <div key={cat} className="mb-3">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{cat}</p>
                    <div className="space-y-1.5">
                      {BENCHMARKS.filter((b) => b.category === cat).map((b) => (
                        <label key={b.id}
                          className={`flex items-start gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                            selectedBenchmarks.has(b.id)
                              ? "border-blue-400 bg-blue-50"
                              : "border-gray-200 hover:border-gray-300"
                          }`}>
                          <input type="checkbox" checked={selectedBenchmarks.has(b.id)}
                            onChange={() => toggleBenchmark(b.id)}
                            className="w-3.5 h-3.5 accent-blue-600 mt-0.5 flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={`text-xs font-semibold ${selectedBenchmarks.has(b.id) ? "text-blue-700" : "text-gray-700"}`}>{b.name}</span>
                              <span className="text-xs text-gray-400">{b.shots}-shot</span>
                            </div>
                            <p className="text-xs text-gray-400 leading-snug">{b.desc}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <button onClick={handleRunBenchmarks}
                disabled={!benchRunning && (selectedModelIds.size === 0 || selectedBenchmarks.size === 0)}
                className={`w-full flex items-center justify-center gap-2 py-2.5 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors ${
                  benchRunning ? "bg-red-500 hover:bg-red-600" : "bg-blue-600 hover:bg-blue-700"
                }`}>
                {benchRunning
                  ? <><StopCircle className="w-4 h-4" />벤치마크 중단</>
                  : <><Download className="w-4 h-4" />데이터 다운로드 후 검증 실행</>}
              </button>
            </div>

            {/* 최신 결과 (가장 최근 group) — 실행 중엔 현재 그룹만 표시하고 이전 결과는 숨긴다 */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 min-w-0 overflow-hidden">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">
                {benchRunning ? "현재 실행" : "최신 결과"}
              </h2>
              {benchRunning && (
                <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 min-w-0">
                  <div className="flex items-start gap-2 mb-2 min-w-0">
                    <Loader className="w-4 h-4 text-blue-600 animate-spin flex-shrink-0 mt-0.5" />
                    <span className="text-sm font-semibold text-blue-700 min-w-0 break-words">
                      {benchAgentProgress?.message || "벤치마크 평가를 준비하고 있습니다..."}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-blue-600 mb-1">
                    <span>{benchAgentProgress?.phase || "preparing"}</span>
                    <span className="font-mono tabular-nums">
                      {Math.max(0, Math.min(100, benchAgentProgress?.percent ?? 5))}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-blue-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-500"
                      style={{ width: `${Math.max(4, Math.min(100, benchAgentProgress?.percent ?? 5))}%` }}
                    />
                  </div>
                  {(benchAgentProgress?.model_ids?.length || benchAgentProgress?.tasks?.length) && (
                    <div className="mt-2 text-xs text-blue-700/80">
                      {benchAgentProgress?.model_ids?.length
                        ? `모델 ${benchAgentProgress.model_ids.length}개`
                        : ""}
                      {benchAgentProgress?.model_ids?.length && benchAgentProgress?.tasks?.length ? " · " : ""}
                      {benchAgentProgress?.tasks?.length
                        ? `태스크 ${benchAgentProgress.tasks.length}개`
                        : ""}
                    </div>
                  )}
                </div>
              )}
              {(() => {
                // 실행 중: activeGroupId 매칭 row만 노출, 없으면 결과 영역 숨김
                if (benchRunning) {
                  const current = activeGroupId
                    ? benchmarkGroups.find((g) => g.groupId === activeGroupId)
                    : null;
                  return current ? <BenchmarkGroupView group={current} /> : null;
                }
                if (benchmarkGroups.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center h-64">
                      <BarChart3 className="w-10 h-10 text-gray-200 mb-3" />
                      <p className="text-sm text-gray-400">벤치마크를 실행하면 결과가 표시됩니다</p>
                    </div>
                  );
                }
                return <BenchmarkGroupView group={benchmarkGroups[0]} />;
              })()}
            </div>
          </div>

          {/* 이전 실행 기록 — 실행 중엔 숨김 */}
          {!benchRunning && benchmarkGroups.length > 1 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-gray-700">이전 검증 기록</h2>
              {benchmarkGroups.slice(1).map((group) => (
                <div key={group.groupId} className="bg-white rounded-xl border border-gray-200 p-5">
                  <BenchmarkGroupView group={group} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── 벤치마크 그룹 카드 (한 group_id에 묶인 모델 N개 결과) ─────────────
type BenchmarkGroup = { groupId: string; rows: BenchmarkRunRow[] };

// lm_eval 실패 메시지를 한 줄 요약으로 변환. 흔한 패턴을 친화적 한국어로 매핑한다.
const summarizeBenchmarkError = (err: string): string => {
  const s = err || "";
  if (!s) return "원인 미상으로 실패했습니다.";
  if (s.includes("사용자가 중단")) return "사용자가 중단했습니다.";
  if (s.includes("No module named lm_eval")) return "lm_eval 모듈이 설치돼 있지 않습니다.";
  if (s.includes("Repo id must be in the form")) return "기반 모델 경로를 찾을 수 없습니다 (학습 시점 경로가 변경되었을 수 있습니다).";
  if (s.includes("CUDA out of memory") || s.includes("OutOfMemoryError")) return "GPU 메모리가 부족합니다.";
  if (/401|403|gated repo|access to model is restricted/i.test(s)) return "모델 접근 권한이 없습니다 (HF_TOKEN 필요).";
  if (s.includes("Connection") || s.includes("ConnectionError") || s.includes("Could not reach")) return "네트워크/HuggingFace Hub 연결 실패.";
  return "벤치마크 실행이 실패했습니다.";
};

const BenchmarkRunErrorView: React.FC<{ error: string }> = ({ error }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1 min-w-0">
      <p className="text-xs text-red-500 break-words">{summarizeBenchmarkError(error)}</p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-1 text-[11px] text-red-400 hover:text-red-600 underline"
      >
        {open ? "접기" : "자세히 보기"}
      </button>
      {open && (
        <pre className="mt-1 text-[11px] text-red-400 whitespace-pre-wrap break-all font-mono max-h-40 overflow-auto bg-red-50/40 rounded p-2">
          {error}
        </pre>
      )}
    </div>
  );
};

const BenchmarkGroupView: React.FC<{ group: BenchmarkGroup }> = ({ group }) => {
  const rows = group.rows;
  const anyRunning = rows.some((r) => r.status === "pending" || r.status === "running");
  const startedAt = rows.map((r) => r.started_at || r.created_at).filter(Boolean).sort()[0];
  const tasks = rows[0]?.tasks ?? [];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-800">{rows.length}개 모델 · {tasks.length}개 태스크</p>
          <p className="text-xs text-gray-400">{startedAt ? formatDate(startedAt) : "—"}</p>
        </div>
        {anyRunning && (
          <span className="flex items-center gap-1 text-xs text-blue-600">
            <Loader className="w-3 h-3 animate-spin" />진행 중
          </span>
        )}
      </div>
      <div className="space-y-4">
        {rows.map((row) => (
          <div key={row.id} className="border border-gray-100 rounded-lg p-4 min-w-0 overflow-hidden">
            <div className="flex items-center justify-between gap-2 mb-3 min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate min-w-0 flex-1">{row.model_name}</p>
              <span className={`flex-shrink-0 px-2 py-0.5 rounded text-xs font-medium ${
                row.status === "completed" ? "bg-green-50 text-green-700" :
                row.status === "failed"    ? "bg-red-50 text-red-600" :
                row.status === "running"   ? "bg-blue-50 text-blue-600" :
                                             "bg-gray-100 text-gray-500"
              }`}>
                {row.status === "completed" ? "완료"
                  : row.status === "failed" ? "실패"
                  : row.status === "running" ? "실행 중"
                  : "대기"}
              </span>
            </div>
            {row.status === "completed" && <BenchmarkChart run={toChartInput(row)} />}
            {row.status === "failed" && row.error_message && (
              <BenchmarkRunErrorView error={row.error_message} />
            )}
            {(row.status === "pending" || row.status === "running") && (
              <div className="space-y-1.5 min-w-0">
                <div className="flex items-center justify-between text-xs text-gray-500 gap-2 min-w-0">
                  <span className="truncate font-mono min-w-0 flex-1">
                    {row.progress_message || (row.status === "pending" ? "대기 중..." : "검증 진행 중...")}
                  </span>
                  {typeof row.progress_percent === "number" && (
                    <span className="flex-shrink-0 tabular-nums">{row.progress_percent}%</span>
                  )}
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                  {typeof row.progress_percent === "number" ? (
                    <div
                      className="h-1.5 rounded-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${Math.max(2, row.progress_percent)}%` }}
                    />
                  ) : (
                    <div className="h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ width: "55%" }} />
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default Evaluation;
