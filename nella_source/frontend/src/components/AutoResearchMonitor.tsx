/**
 * AutoResearch Monitor
 * Real-time progress visualization for AutoResearch hyperparameter optimization.
 */
import React, { useEffect, useRef, useState } from "react";
import { CheckCircle, XCircle, Loader, Trophy, Zap, Clock } from "lucide-react";
import { ARJob, TrainingMetric, createARWebSocket } from "../services/api";
import MetricsChart from "./MetricsChart";

interface TrialState {
  trial_id: number;
  status: "pending" | "running" | "done" | "failed";
  config?: Record<string, unknown>;
  final_loss?: number;
  eval_loss?: number;
  duration_seconds?: number;
  currentStep?: number;
  totalSteps?: number;
  // 4번째 trial부터 LLM이 결정하는 조합: 결정 근거 및 전략 표시.
  reasoning?: string;
  strategy?: "preset" | "llm";
}

interface LogLine {
  ts: string;
  text: string;
  type: "info" | "success" | "error";
  overwrite?: boolean;
}

interface SystemStats {
  cpu_percent: number;
  ram_used_gb: number;
  ram_total_gb: number;
  ram_percent: number;
  gpu_allocated_gb?: number;
  gpu_driver_gb?: number;
  gpu_reserved_gb?: number;
}

interface ARMonitorProps {
  job: ARJob;
  onComplete?: (result: Record<string, unknown>) => void;
  onCancel?: () => void;
}

// Parse "X/Y" step progress from tqdm-style log lines
function parseStepProgress(text: string): { current: number; total: number } | null {
  const m = text.match(/(\d+)\/(\d+)\s+(?:\[|it)/);
  if (m) return { current: parseInt(m[1]), total: parseInt(m[2]) };
  const m2 = text.match(/step\s+(\d+).*?\/\s*(\d+)/i);
  if (m2) return { current: parseInt(m2[1]), total: parseInt(m2[2]) };
  return null;
}

const AutoResearchMonitor: React.FC<ARMonitorProps> = ({ job, onComplete, onCancel }) => {
  const totalTrials = job.max_trials;

  const [phase, setPhase] = useState<"idle" | "exploration" | "full_training" | "completed" | "failed">(
    job.status === "completed" ? "completed" : job.status === "failed" ? "failed" : "idle"
  );

  // Trials appear one by one as they start
  const [trials, setTrials] = useState<TrialState[]>(() => {
    if (job.trial_results && job.trial_results.length > 0) {
      // Build a map by trial_id for quick lookup
      const resultMap = new Map<number, Record<string, unknown>>(
        job.trial_results.map((t: Record<string, unknown>) => [t.trial_id as number, t])
      );
      // Always render all max_trials slots so none are missing
      return Array.from({ length: job.max_trials }, (_, i) => {
        const t = resultMap.get(i);
        if (t) return {
          trial_id: i,
          status: "done" as const,
          config: t.config as Record<string, unknown>,
          final_loss: t.final_loss as number,
          eval_loss: t.eval_loss as number | undefined,
          duration_seconds: t.duration_seconds as number,
          reasoning: typeof t.reasoning === "string" ? (t.reasoning as string) : undefined,
          strategy: i >= 3 ? ("llm" as const) : ("preset" as const),
        };
        return { trial_id: i, status: "pending" as const, strategy: i >= 3 ? ("llm" as const) : ("preset" as const) };
      });
    }
    return [];
  });

  const [currentTrialId, setCurrentTrialId] = useState<number | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [bestConfig, setBestConfig] = useState<Record<string, unknown> | null>(job.best_config || null);
  const [bestLoss, setBestLoss] = useState<number | null>(job.best_loss ?? null);
  const [finalResult, setFinalResult] = useState<Record<string, unknown> | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [fullTrainMetrics, setFullTrainMetrics] = useState<TrainingMetric[]>(() => job.final_training_metrics || []);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const loggedFromJobRef = useRef<Set<string>>(new Set());

  const addLog = (text: string, type: LogLine["type"] = "info", overwrite = false) => {
    const ts = new Date().toLocaleTimeString("ko-KR");
    setLogs((prev) => {
      if (overwrite && prev.length > 0 && prev[prev.length - 1].overwrite) {
        const updated = [...prev];
        updated[updated.length - 1] = { ts, text, type, overwrite: true };
        return updated;
      }
      return [...prev, { ts, text, type, overwrite }];
    });
    setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  const updateTrial = (trial_id: number, patch: Partial<TrialState>) => {
    setTrials((prev) =>
      prev.map((t) => (t.trial_id === trial_id ? { ...t, ...patch } : t))
    );
  };

  useEffect(() => {
    if (job.status === "completed") setPhase("completed");
    else if (job.status === "failed" || job.status === "cancelled") setPhase("failed");
    else if (job.trial_results && job.trial_results.length > 0) setPhase((prev) => prev === "idle" ? "exploration" : prev);

    if (job.best_config) setBestConfig(job.best_config);
    if (job.best_loss != null) setBestLoss(job.best_loss);
    if (job.trial_results && job.trial_results.length > 0) {
      const resultMap = new Map<number, Record<string, unknown>>(
        job.trial_results.map((t: Record<string, unknown>) => [t.trial_id as number, t])
      );
      setTrials(Array.from({ length: job.max_trials }, (_, i) => {
        const t = resultMap.get(i);
        if (t) {
          const failed = !Number.isFinite(Number(t.final_loss));
          return {
            trial_id: i,
            status: failed ? "failed" as const : "done" as const,
            config: t.config as Record<string, unknown>,
            final_loss: t.final_loss as number,
            eval_loss: t.eval_loss as number | undefined,
            duration_seconds: t.duration_seconds as number,
            reasoning: typeof t.reasoning === "string" ? (t.reasoning as string) : undefined,
            strategy: i >= 3 ? ("llm" as const) : ("preset" as const),
          };
        }
        return { trial_id: i, status: "pending" as const, strategy: i >= 3 ? ("llm" as const) : ("preset" as const) };
      }));
    }

    if ((job.status === "running" || job.status === "pending") && !loggedFromJobRef.current.has("polling-start")) {
      loggedFromJobRef.current.add("polling-start");
      addLog("AutoResearch 진행 상태를 수신 중입니다. 실시간 로그와 DB 폴링 결과를 함께 반영합니다.", "info");
    }

    for (const trial of job.trial_results || []) {
      const key = `trial-${trial.trial_id}-${trial.final_loss}`;
      if (loggedFromJobRef.current.has(key)) continue;
      loggedFromJobRef.current.add(key);
      const loss = Number(trial.final_loss);
      const trialNo = Number(trial.trial_id) + 1;
      addLog(
        `Trial ${trialNo}/${job.max_trials} 완료 — loss: ${Number.isFinite(loss) ? loss.toFixed(4) : "∞"} (${Number(trial.duration_seconds || 0).toFixed(1)}s)`,
        Number.isFinite(loss) ? "success" : "error",
      );
    }

    const trialResultCount = job.trial_results?.length ?? 0;
    const hasFinalMetrics = Array.isArray(job.final_training_metrics) && job.final_training_metrics.length > 0;
    const isFinalTrainingStage = job.status === "completed" || hasFinalMetrics || trialResultCount >= job.max_trials;

    if (job.best_config && isFinalTrainingStage && !loggedFromJobRef.current.has("final-best-config")) {
      loggedFromJobRef.current.add("final-best-config");
      if (job.status !== "completed" && job.status !== "failed" && job.status !== "cancelled") {
        setPhase("full_training");
      }
      addLog(
        `최적 설정 선택 완료 — loss: ${job.best_loss != null ? job.best_loss.toFixed(4) : "-"}. 최종 훈련 진행 중...`,
        "success",
      );
    } else if (job.best_config && !isFinalTrainingStage && !loggedFromJobRef.current.has("current-best-config")) {
      loggedFromJobRef.current.add("current-best-config");
      addLog(
        `현재까지 최적 설정 갱신 — loss: ${job.best_loss != null ? job.best_loss.toFixed(4) : "-"}. 하이퍼파라미터 탐색을 계속합니다.`,
        "info",
      );
    }

    if (Array.isArray(job.final_training_metrics) && job.final_training_metrics.length > 0) {
      setFullTrainMetrics((prev) => {
        const byStep = new Map<number, TrainingMetric>();
        for (const metric of prev) byStep.set(metric.step, metric);
        for (const metric of job.final_training_metrics || []) byStep.set(metric.step, metric);
        return Array.from(byStep.values()).sort((a, b) => a.step - b.step);
      });
    }
  }, [job.status, job.best_config, job.best_loss, job.trial_results, job.max_trials, job.final_training_metrics]);

  useEffect(() => {
    if (job.status === "completed" || job.status === "failed") return;

    const ws = createARWebSocket(
      job.id,
      (data) => {
        const type = data.type as string;

        if (type === "system_stats") {
          setSystemStats(data as unknown as SystemStats);
          return;
        }

        if (type === "ar_started") {
          setPhase("exploration");
          setWsConnected(true);
          addLog(`AutoResearch 시작: ${data.max_trials}회 시도 × ${data.steps_per_trial}스텝`, "info");
        }

        if (type === "ar_progress") {
          const d = data as Record<string, unknown>;

          // Trainer log line — extract step progress for running trial
          if (d.phase === "trial_log" || d.phase === "full_training_log") {
            const text = d.log_text as string;
            if (text) {
              addLog(text, "info", !!(d.overwrite as boolean));
              if (d.phase === "full_training_log") {
                const stepMatch = text.match(/\[step\s+(\d+)\]/i);
                const lossMatch = text.match(/loss=([0-9.]+)/i);
                const epochMatch = text.match(/epoch=([0-9.]+)/i);
                if (stepMatch && lossMatch) {
                  const metric: TrainingMetric = {
                    step: Number(stepMatch[1]),
                    loss: Number(lossMatch[1]),
                  };
                  if (epochMatch) metric.epoch = Number(epochMatch[1]);
                  setFullTrainMetrics((prev) => (
                    prev.some((m) => m.step === metric.step && m.loss === metric.loss)
                      ? prev
                      : [...prev, metric]
                  ));
                }
              }
              // Parse step progress only for trial logs (not full training)
              if (d.phase === "trial_log" && currentTrialId !== null) {
                const prog = parseStepProgress(text);
                if (prog) {
                  updateTrial(currentTrialId, { currentStep: prog.current, totalSteps: prog.total });
                }
              }
            }
            return;
          }

          // Structured metric event from final training → loss chart
          if (d.phase === "full_training_metric") {
            const step = d.step as number;
            const loss = d.loss as number | undefined;
            if (step != null && loss != null) {
              setFullTrainMetrics((prev) => {
                const metric = {
                  step,
                  loss,
                  eval_loss: d.eval_loss as number | undefined,
                  epoch: d.epoch as number | undefined,
                  learning_rate: d.learning_rate as number | undefined,
                };
                return prev.some((m) => m.step === metric.step)
                  ? prev.map((m) => m.step === metric.step ? metric : m)
                  : [...prev, metric].sort((a, b) => a.step - b.step);
              });
            }
            return;
          }

          if (d.phase === "exploration") {
            // Auto-transition: if ar_started was missed (WS connected late), switch phase here
            setPhase((prev) => (prev === "idle" ? "exploration" : prev));
            const trialNum = d.trial as number;   // 1-based
            const total = d.total_trials as number;
            const trialIdx = trialNum - 1;         // 0-based

            if (d.status === "trial_done") {
              const loss = d.final_loss as number;
              addLog(
                `Trial ${trialNum}/${total} 완료 — loss: ${isFinite(loss) ? loss.toFixed(4) : "∞"} (${(d.duration_seconds as number)?.toFixed(1)}s)`,
                isFinite(loss) ? "success" : "error"
              );
              const doneState: TrialState = {
                trial_id: trialIdx,
                status: "done",
                config: (d.config as Record<string, unknown>) || {},
                final_loss: d.final_loss as number,
                eval_loss: d.eval_loss as number | undefined,
                duration_seconds: d.duration_seconds as number,
                currentStep: undefined,
                totalSteps: undefined,
                reasoning: typeof d.reasoning === "string" ? (d.reasoning as string) : undefined,
                strategy: (d.strategy as "preset" | "llm" | undefined) ?? (trialIdx >= 3 ? "llm" : "preset"),
              };
              setTrials((prev) => {
                const exists = prev.find((t) => t.trial_id === trialIdx);
                if (exists) return prev.map((t) => t.trial_id === trialIdx ? doneState : t);
                // trial_starting was missed (WS connected late) — insert in order
                const insertAt = prev.findIndex((t) => t.trial_id > trialIdx);
                return insertAt === -1
                  ? [...prev, doneState]
                  : [...prev.slice(0, insertAt), doneState, ...prev.slice(insertAt)];
              });
              setCurrentTrialId(trialNum < total ? trialNum : null);
            } else if (d.status === "trial_failed") {
              addLog(`Trial ${trialNum}/${total} 실패: ${d.error}`, "error");
              updateTrial(trialIdx, {
                status: "failed",
                config: (d.config as Record<string, unknown>) || {},
                reasoning: typeof d.reasoning === "string" ? (d.reasoning as string) : undefined,
                strategy: (d.strategy as "preset" | "llm" | undefined) ?? (trialIdx >= 3 ? "llm" : "preset"),
              });
            } else {
              // trial starting — add new card
              setCurrentTrialId(trialIdx);
              const cfg = d.config as Record<string, unknown>;
              const strategy = (d.strategy as "preset" | "llm" | undefined) ?? (trialIdx >= 3 ? "llm" : "preset");
              const reasoning = typeof d.reasoning === "string" ? (d.reasoning as string) : undefined;
              addLog(
                `Trial ${trialNum}/${total} 시작 [${strategy === "llm" ? "🧠 LLM 결정" : "사전 설계"}] — lr=${(cfg?.learning_rate as number)?.toExponential(1)}, lora_r=${cfg?.lora_r}, batch=${cfg?.per_device_train_batch_size}`,
                "info"
              );
              if (reasoning && strategy === "llm") {
                addLog(`  ↳ ${reasoning}`, "info");
              }
              setTrials((prev) => {
                const exists = prev.find((t) => t.trial_id === trialIdx);
                const next: TrialState = {
                  trial_id: trialIdx,
                  status: "running",
                  config: cfg || {},
                  currentStep: 0,
                  totalSteps: job.steps_per_trial,
                  reasoning,
                  strategy,
                };
                if (exists) return prev.map((t) => t.trial_id === trialIdx ? next : t);
                return [...prev, next];
              });
            }
          }

          if (d.phase === "full_training") {
            setPhase("full_training");
            setBestConfig(d.best_config as Record<string, unknown>);
            setBestLoss(d.best_loss as number);
            addLog(`최적 설정 선택 완료 — loss: ${(d.best_loss as number)?.toFixed(4)}. 최종 훈련 시작...`, "success");
          }
        }

        if (type === "ar_completed") {
          setPhase("completed");
          const result = data.result as Record<string, unknown>;
          setFinalResult(result);
          setBestConfig(result.best_config as Record<string, unknown>);
          setBestLoss(result.best_trial_loss as number);
          if (Array.isArray(result.final_training_metrics)) {
            setFullTrainMetrics(result.final_training_metrics as TrainingMetric[]);
          }
          addLog(`AutoResearch 완료! 최종 loss: ${(result.final_loss as number)?.toFixed(4)}`, "success");
          if (onComplete) onComplete(result);
          ws.close();
        }

        if (type === "ar_cancelled") {
          setPhase("failed");
          addLog("AutoResearch 중지됨 (사용자 요청)", "error");
          ws.close();
        }

        if (type === "ar_error") {
          setPhase("failed");
          addLog(`오류 발생: ${data.error}`, "error");
          ws.close();
        }
      },
      () => setWsConnected(false),
    );

    setWsConnected(true);
    return () => ws.close();
  }, [job.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const doneTrial = phase === "completed"
    ? totalTrials
    : trials.filter((t) => t.status === "done" || t.status === "failed").length;
  const overallPercent = Math.round((doneTrial / totalTrials) * 100);

  const phaseLabel: Record<typeof phase, string> = {
    idle: "대기 중",
    exploration: "하이퍼파라미터 탐색 중",
    full_training: "최종 모델 훈련 중",
    completed: "완료",
    failed: "실패",
  };

  const phaseBg: Record<typeof phase, string> = {
    idle: "bg-gray-50 border-gray-200",
    exploration: "bg-blue-50 border-blue-200",
    full_training: "bg-indigo-50 border-indigo-200",
    completed: "bg-green-50 border-green-200",
    failed: "bg-red-50 border-red-200",
  };

  return (
    <div className="space-y-4">
      {/* ── Phase header + overall progress ── */}
      <div className={`rounded-xl border p-4 ${phaseBg[phase]}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {phase === "exploration"   && <Loader  className="w-4 h-4 text-blue-500 animate-spin" />}
            {phase === "full_training" && <Loader  className="w-4 h-4 text-indigo-500 animate-spin" />}
            {phase === "completed"     && <Trophy  className="w-4 h-4 text-green-600" />}
            {phase === "failed"        && <XCircle className="w-4 h-4 text-red-500" />}
            {phase === "idle"          && <Zap     className="w-4 h-4 text-gray-400" />}
            <span className="text-sm font-semibold text-gray-800">{phaseLabel[phase]}</span>
            {wsConnected && phase !== "completed" && phase !== "failed" && (
              <span className="flex items-center gap-1 text-xs text-green-600">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
                Live
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onCancel && (phase === "exploration" || phase === "full_training" || phase === "idle") && (
              <button
                onClick={async () => { setCancelling(true); await onCancel(); }}
                disabled={cancelling}
                className={`flex items-center gap-1 px-2 py-1 text-xs font-medium border rounded-lg transition-colors ${
                  cancelling
                    ? "text-red-600 bg-red-50 border-red-200 opacity-70 cursor-not-allowed"
                    : "text-gray-600 bg-gray-50 hover:bg-red-50 hover:text-red-600 hover:border-red-200 border-gray-200"
                }`}
              >
                <XCircle className="w-3 h-3" />{cancelling ? "중단 중..." : "훈련 중단"}
              </button>
            )}
          </div>
        </div>

        {/* Overall trial progress bar */}
        {phase !== "idle" && (
          <div className="mt-3">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>전체 Trial: {doneTrial} / {totalTrials}</span>
              <span>{overallPercent}%</span>
            </div>
            <div className="w-full bg-white rounded-full h-2 border border-gray-200">
              <div
                className={`h-2 rounded-full transition-all duration-500 ${phase === "completed" ? "bg-green-500" : "bg-blue-500"}`}
                style={{ width: `${overallPercent}%` }}
              />
            </div>
          </div>
        )}

        {phase === "full_training" && (
          <div className="mt-2 flex items-center gap-2 text-xs text-indigo-600">
            <div className="h-1.5 w-full bg-indigo-100 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-400 rounded-full animate-pulse w-1/2" />
            </div>
            <span className="whitespace-nowrap">최종 훈련 진행 중...</span>
          </div>
        )}
      </div>

      {/* ── Trial cards (always visible) ── */}
      <div className="grid grid-cols-1 gap-2">
        {trials.map((t) => {
          const isBest = bestLoss !== null && t.final_loss === bestLoss && t.status === "done";
          const stepPct = t.totalSteps && t.totalSteps > 0
            ? Math.round(((t.currentStep ?? 0) / t.totalSteps) * 100)
            : 0;

          return (
            <div
              key={t.trial_id}
              className={`rounded-lg border px-4 py-3 transition-colors ${
                t.status === "running"  ? "bg-blue-50 border-blue-200" :
                t.status === "done"     ? (isBest ? "bg-green-50 border-green-300" : "bg-white border-gray-200") :
                t.status === "failed"   ? "bg-red-50 border-red-200" :
                "bg-gray-50 border-gray-100"
              }`}
            >
              <div className="flex items-center gap-3">
                {/* Status icon */}
                <div className="flex-shrink-0 w-5 flex justify-center">
                  {t.status === "pending" && <span className="w-4 h-4 rounded-full border-2 border-gray-300 inline-block" />}
                  {t.status === "running" && <Loader className="w-4 h-4 text-blue-500 animate-spin" />}
                  {t.status === "done"    && <CheckCircle className={`w-4 h-4 ${isBest ? "text-green-600" : "text-green-400"}`} />}
                  {t.status === "failed"  && <XCircle className="w-4 h-4 text-red-400" />}
                </div>

                {/* Trial number + label */}
                <div className="w-24 flex-shrink-0">
                  <span className={`text-xs font-semibold ${
                    t.status === "running" ? "text-blue-700" :
                    t.status === "done"    ? (isBest ? "text-green-700" : "text-gray-700") :
                    t.status === "failed"  ? "text-red-600" : "text-gray-400"
                  }`}>
                    Trial {t.trial_id + 1}
                    {isBest && <Trophy className="w-3 h-3 text-yellow-500 inline ml-1" />}
                  </span>
                  {t.strategy === "llm" && (
                    <span
                      className="ml-1 px-1 py-0.5 text-[9px] font-semibold rounded bg-purple-100 text-purple-700 align-middle"
                      title="LLM 에이전트가 이전 trial 결과를 보고 결정한 조합"
                    >
                      🧠 LLM
                    </span>
                  )}
                </div>

                {/* Hyperparams (once config available) */}
                {t.config && (
                  <div className="flex gap-3 text-xs text-gray-500 font-mono flex-1 min-w-0">
                    <span>lr={((t.config.learning_rate as number) ?? 0).toExponential(1)}</span>
                    <span>r={String(t.config.lora_r ?? "-")}</span>
                    <span>bs={String(t.config.per_device_train_batch_size ?? "-")}</span>
                  </div>
                )}
                {!t.config && t.status === "pending" && (
                  <span className="text-xs text-gray-300 flex-1">대기 중</span>
                )}

                {/* Loss / duration (once done) */}
                {t.status === "done" && (
                  <div className="flex items-center gap-3 text-xs flex-shrink-0">
                    <span className={`font-mono font-semibold ${isBest ? "text-green-700" : "text-gray-700"}`}>
                      loss {t.final_loss !== undefined && isFinite(t.final_loss) ? t.final_loss.toFixed(4) : "∞"}
                    </span>
                    {t.duration_seconds !== undefined && (
                      <span className="text-gray-400 flex items-center gap-0.5">
                        <Clock className="w-3 h-3" />{t.duration_seconds.toFixed(0)}s
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* LLM 결정 근거 (strategy=llm이고 reasoning이 있을 때만) */}
              {t.reasoning && t.strategy === "llm" && (
                <div className="mt-1.5 ml-8 flex items-start gap-1.5 text-xs text-purple-700">
                  <span className="flex-shrink-0">💡</span>
                  <span className="flex-1 min-w-0 italic leading-snug">{t.reasoning}</span>
                </div>
              )}

              {/* Per-trial step progress bar (only while running) */}
              {t.status === "running" && t.totalSteps !== undefined && t.totalSteps > 0 && (
                <div className="mt-2 ml-8">
                  <div className="flex justify-between text-xs text-blue-500 mb-1">
                    <span>Step {t.currentStep ?? 0} / {t.totalSteps}</span>
                    <span>{stepPct}%</span>
                  </div>
                  <div className="w-full bg-blue-100 rounded-full h-1.5">
                    <div
                      className="h-1.5 bg-blue-400 rounded-full transition-all duration-300"
                      style={{ width: `${stepPct}%` }}
                    />
                  </div>
                </div>
              )}
              {/* Running but steps not yet received */}
              {t.status === "running" && (!t.totalSteps || t.totalSteps === 0) && (
                <div className="mt-2 ml-8">
                  <div className="w-full bg-blue-100 rounded-full h-1.5 overflow-hidden">
                    <div className="h-1.5 bg-blue-400 rounded-full animate-pulse w-1/3" />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── System resource stats ── */}
      {(phase === "exploration" || phase === "full_training") && systemStats && (
        <div className="flex flex-wrap items-center gap-4 px-3 py-2 bg-gray-50 rounded-lg border border-gray-100 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-gray-400 font-medium">CPU</span>
            <div className="w-14 bg-gray-200 rounded-full h-1.5">
              <div className="h-1.5 bg-blue-400 rounded-full transition-all duration-500" style={{ width: `${systemStats.cpu_percent}%` }} />
            </div>
            <span className="font-mono text-gray-600 tabular-nums">{systemStats.cpu_percent.toFixed(0)}%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-gray-400 font-medium">RAM</span>
            <div className="w-14 bg-gray-200 rounded-full h-1.5">
              <div className="h-1.5 bg-purple-400 rounded-full transition-all duration-500" style={{ width: `${systemStats.ram_percent}%` }} />
            </div>
            <span className="font-mono text-gray-600 tabular-nums">{systemStats.ram_used_gb.toFixed(0)}/{systemStats.ram_total_gb.toFixed(0)}GB</span>
          </div>
          {systemStats.gpu_allocated_gb !== undefined && (
            <div className="flex items-center gap-1.5">
              <span className="text-gray-400 font-medium">GPU</span>
              <span className="font-mono text-gray-600 tabular-nums">{systemStats.gpu_allocated_gb.toFixed(1)}GB</span>
              {systemStats.gpu_driver_gb !== undefined && (
                <span className="text-gray-400">/ {systemStats.gpu_driver_gb.toFixed(1)}GB</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Final training loss chart ── */}
      {fullTrainMetrics.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-indigo-700 mb-1 flex items-center gap-1 px-1">
            <Zap className="w-3 h-3" />최종 훈련 Loss 곡선
          </p>
          <MetricsChart metrics={fullTrainMetrics} />
        </div>
      )}

      {/* ── Best config (when found) ── */}
      {bestConfig && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4">
          <p className="text-xs font-semibold text-green-700 mb-2 flex items-center gap-1">
            <Trophy className="w-3.5 h-3.5" />최적 하이퍼파라미터 (loss: {bestLoss?.toFixed(4)})
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Object.entries(bestConfig).map(([k, v]) => (
              <div key={k} className="bg-white rounded-lg px-2 py-1.5 border border-green-100">
                <p className="text-xs text-gray-500">{k}</p>
                <p className="text-xs font-mono font-medium text-gray-800">
                  {typeof v === "number" && v < 0.01 ? (v as number).toExponential(1) : String(v)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Final result ── */}
      {finalResult && (
        <div className="rounded-xl border border-green-300 bg-green-50 p-4">
          <p className="text-sm font-semibold text-green-700 mb-1">훈련 완료</p>
          <div className="flex gap-4 text-xs text-green-600">
            {finalResult.final_loss !== null && (
              <span>최종 loss: <strong>{(finalResult.final_loss as number)?.toFixed(4)}</strong></span>
            )}
            {finalResult.total_trials !== null && (
              <span>총 {finalResult.total_trials as number}회 시도</span>
            )}
            {finalResult.duration_seconds !== null && (
              <span>소요 시간: {Math.round((finalResult.duration_seconds as number) / 60)}분</span>
            )}
          </div>
          {!!finalResult.final_model_path && (
            <p className="text-xs text-green-500 mt-1 font-mono truncate">
              저장 경로: {String(finalResult.final_model_path)}
            </p>
          )}
        </div>
      )}

      {/* ── Log output ── */}
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-gray-900">
          <span className="text-xs font-medium text-gray-300">로그 출력</span>
          <span className="text-xs text-gray-500">{logs.length}줄</span>
        </div>
        <div className="bg-gray-950 px-4 py-3 h-40 overflow-y-auto font-mono">
          {logs.length === 0 ? (
            <p className="text-xs text-gray-500">대기 중...</p>
          ) : (
            logs.map((l, i) => (
              <div key={i} className="flex gap-2 text-xs leading-5">
                <span className="text-gray-600 shrink-0">{l.ts}</span>
                <span className={
                  l.type === "success" ? "text-green-400"
                  : l.type === "error" ? "text-red-400"
                  : "text-gray-300"
                }>{l.text}</span>
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
};

export default AutoResearchMonitor;
