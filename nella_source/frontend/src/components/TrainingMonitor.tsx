import React, { useEffect, useRef, useState } from "react";
import { CheckCircle, XCircle, Loader, BarChart2, Clock, Cpu } from "lucide-react";
import { TrainingJob, TrainingMetric, createTrainingWebSocket } from "../services/api";
import MetricsChart from "./MetricsChart";
import { formatDate } from "../lib/utils";

interface LogLine {
  ts: string;
  text: string;
  type: "info" | "success" | "error";
  overwrite?: boolean; // tqdm-style: replace previous overwrite line
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

interface TrainingMonitorProps {
  job: TrainingJob;
  onUpdate?: (job: TrainingJob) => void;
}

const TrainingMonitor: React.FC<TrainingMonitorProps> = ({ job, onUpdate }) => {
  const [metrics, setMetrics] = useState<TrainingMetric[]>(job.training_metrics || []);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [connected, setConnected] = useState(false);
  const [currentStep, setCurrentStep] = useState<number | null>(null);
  const [totalSteps, setTotalSteps] = useState<number | null>(null);
  const [currentEpoch, setCurrentEpoch] = useState<number | null>(null);
  const [totalEpochs, setTotalEpochs] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [threadId, setThreadId] = useState<number | null>(null);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addLog = (text: string, type: LogLine["type"] = "info", overwrite = false) => {
    const ts = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs((prev) => {
      if (overwrite && prev.length > 0 && prev[prev.length - 1].overwrite) {
        // tqdm 줄 갱신: 마지막 overwrite 줄을 교체
        const updated = [...prev];
        updated[updated.length - 1] = { ts, text, type, overwrite: true };
        return updated;
      }
      return [...prev, { ts, text, type, overwrite }];
    });
    setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  // elapsed timer
  useEffect(() => {
    if (job.status === "running") {
      timerRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000);
      addLog(`훈련 시작: ${job.name}`, "info");
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [job.id, job.status]);

  useEffect(() => {
    if (job.status !== "running") return;

    const ws = createTrainingWebSocket(
      job.id,
      (data) => {
        const msg = data as TrainingMetric & {
          type?: string;
          text?: string;
          error?: string;
          result?: Record<string, unknown>;
          total_steps?: number;
        };

        if (msg.type === "completed") {
          if (timerRef.current) clearInterval(timerRef.current);
          addLog("✓ 훈련 완료", "success");
          setConnected(false);
          return;
        }
        if (msg.type === "cancelled") {
          if (timerRef.current) clearInterval(timerRef.current);
          addLog("⚠ 훈련 취소됨", "error");
          setConnected(false);
          return;
        }
        if (msg.type === "error") {
          if (timerRef.current) clearInterval(timerRef.current);
          addLog(`✗ 오류: ${msg.error}`, "error");
          setConnected(false);
          return;
        }

        if (msg.type === "system_stats") {
          setSystemStats(msg as unknown as SystemStats);
          return;
        }

        // 훈련 도구 (TRL / transformers / PEFT 등) 실시간 로그
        if (msg.type === "log") {
          if (msg.text) {
            const overwrite = !!(msg as unknown as { overwrite?: boolean }).overwrite;
            addLog(msg.text as string, "info", overwrite);
          }
          return;
        }

        if (msg.type === "thread_id") {
          const tid = (msg as unknown as { thread_id: number }).thread_id;
          setThreadId(tid);
          addLog(`🧵 스레드 ID: ${tid}  (터미널: kill -9 ${tid})`, "info");
          return;
        }

        if (msg.total_steps) setTotalSteps(msg.total_steps);
        if ((msg as unknown as { total_epochs?: number }).total_epochs) {
          setTotalEpochs((msg as unknown as { total_epochs: number }).total_epochs);
        }

        if (msg.step !== undefined) {
          setCurrentStep(msg.step);
          const epochInt = msg.epoch != null ? Math.ceil(msg.epoch) : null;
          if (epochInt != null) setCurrentEpoch(epochInt);
          const parts: string[] = [`[step ${msg.step}]`];
          if (epochInt != null) parts.push(`epoch=${epochInt}`);
          if (msg.loss != null) parts.push(`loss=${msg.loss.toFixed(4)}`);
          if (msg.eval_loss != null) parts.push(`eval_loss=${msg.eval_loss.toFixed(4)}`);
          if (msg.learning_rate != null) parts.push(`lr=${msg.learning_rate.toExponential(2)}`);
          addLog(parts.join("  "), "success");

          setMetrics((prev) => {
            const updated = [...prev, data as TrainingMetric];
            if (onUpdate) onUpdate({ ...job, training_metrics: updated });
            return updated;
          });
        }
      },
      () => setConnected(false)
    );

    ws.onopen = () => { setConnected(true); addLog("WebSocket 연결됨", "info"); };
    ws.onclose = () => setConnected(false);

    return () => ws.close();
  }, [job.id, job.status]);

  // initial logs from completed/failed jobs
  useEffect(() => {
    if (job.status === "completed" && logs.length === 0) {
      addLog(`훈련 완료: ${job.name}`, "success");
      if (job.final_loss) addLog(`최종 loss: ${job.final_loss.toFixed(4)}`, "success");
      if (job.output_dir) addLog(`저장 경로: ${job.output_dir}`, "info");
    }
    if (job.status === "failed" && logs.length === 0) {
      addLog(`훈련 실패: ${job.error_message ?? "알 수 없는 오류"}`, "error");
    }
  }, []);

  const displayMetrics = metrics.length > 0 ? metrics : (job.training_metrics || []);
  const latestMetric = displayMetrics[displayMetrics.length - 1];
  const progress = totalSteps && currentStep ? Math.round((currentStep / totalSteps) * 100) : null;

  const fmtTime = (sec: number) => {
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {job.status === "running" && <Loader className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0" />}
        {job.status === "completed" && <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />}
        {(job.status === "failed" || job.status === "cancelled") && <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />}

        <span className="text-xs text-gray-500">{job.method?.toUpperCase() ?? "SFT"}</span>

        {job.status === "running" && (
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${connected ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
            <span className="text-xs text-gray-500">{connected ? "Live" : "연결 중..."}</span>
          </div>
        )}

        {job.status === "running" && elapsedSec > 0 && (
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <Clock className="w-3 h-3" />{fmtTime(elapsedSec)}
          </span>
        )}

        {latestMetric?.loss != null && (
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <BarChart2 className="w-3 h-3" />loss {latestMetric.loss.toFixed(4)}
          </span>
        )}

        {job.status === "running" && threadId && (
          <span
            className="flex items-center gap-1 text-xs text-gray-400 font-mono cursor-pointer hover:text-gray-600"
            title={`터미널 강제 종료: kill -9 ${threadId}`}
            onClick={() => navigator.clipboard.writeText(`kill -9 ${threadId}`)}
          >
            <Cpu className="w-3 h-3" />tid:{threadId}
          </span>
        )}

        <span className="ml-auto text-xs text-gray-400">{formatDate(job.created_at)}</span>
      </div>

      {/* Progress bar */}
      {job.status === "running" && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-400">
            <div className="flex items-center gap-3">
              <span className="font-medium">{progress !== null ? `${progress}%` : "준비 중..."}</span>
              {totalEpochs != null && currentEpoch != null && (
                <span>epoch {currentEpoch} / {totalEpochs}</span>
              )}
            </div>
            {currentStep !== null && (
              <span>step {currentStep}{totalSteps ? ` / ${totalSteps}` : ""}</span>
            )}
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
            <div
              className="h-2 bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: progress !== null ? `${progress}%` : "5%" }}
            />
          </div>
          {/* 에폭별 미니 마커 */}
          {totalEpochs != null && totalEpochs > 1 && (
            <div className="flex gap-0.5 mt-0.5">
              {Array.from({ length: totalEpochs }, (_, i) => (
                <div
                  key={i}
                  className={`flex-1 h-1 rounded-full transition-colors duration-300 ${
                    currentEpoch != null && i < currentEpoch ? "bg-blue-400" : "bg-gray-200"
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* System resource stats */}
      {job.status === "running" && systemStats && (
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
              {systemStats.gpu_reserved_gb !== undefined && (
                <span className="text-gray-400">/ {systemStats.gpu_reserved_gb.toFixed(1)}GB</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Config chips — running/pending 상태에서 설정 미리보기 */}
      {job.config && job.status !== "completed" && job.status !== "failed" && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(job.config)
            .filter(([, v]) => v !== null && v !== -1 && v !== undefined)
            .slice(0, 8)
            .map(([key, value]) => (
              <span key={key} className="px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-600">
                <span className="text-gray-400">{key}=</span>
                {typeof value === "number" && value < 0.01 ? (value as number).toExponential(1) : String(value)}
              </span>
            ))}
        </div>
      )}

      {/* Loss chart */}
      {displayMetrics.length > 0 && <MetricsChart metrics={displayMetrics} />}

      {/* 완료: 결과 + 설정 함께 표시 */}
      {job.status === "completed" && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-green-700">훈련 완료</p>
          <div className="flex flex-wrap gap-4 text-xs text-green-600">
            {job.final_loss && <span>최종 loss: <strong>{job.final_loss.toFixed(4)}</strong></span>}
            {job.completed_at && job.started_at && (
              <span>소요: {Math.round((new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 60000)}분</span>
            )}
          </div>
          {job.output_dir && (
            <p className="text-xs text-green-500 font-mono truncate">{job.output_dir}</p>
          )}
          {/* 훈련 설정 */}
          {job.config && (
            <div className="border-t border-green-200 pt-2 flex flex-wrap gap-1.5">
              {Object.entries(job.config)
                .filter(([, v]) => v !== null && v !== -1 && v !== undefined)
                .map(([key, value]) => (
                  <span key={key} className="px-1.5 py-0.5 bg-green-100 rounded text-xs text-green-700">
                    <span className="text-green-500">{key}=</span>
                    {typeof value === "number" && value < 0.01 ? (value as number).toExponential(1) : String(value)}
                  </span>
                ))}
            </div>
          )}
        </div>
      )}

      {/* 취소: 부분 결과 + 설정 */}
      {job.status === "cancelled" && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-orange-700">훈련 취소됨</p>
          {job.final_loss && (
            <p className="text-xs text-orange-600">중단 시점 loss: <strong>{job.final_loss.toFixed(4)}</strong></p>
          )}
          {job.config && (
            <div className="border-t border-orange-200 pt-2 flex flex-wrap gap-1.5">
              {Object.entries(job.config)
                .filter(([, v]) => v !== null && v !== -1 && v !== undefined)
                .map(([key, value]) => (
                  <span key={key} className="px-1.5 py-0.5 bg-orange-100 rounded text-xs text-orange-700">
                    <span className="text-orange-500">{key}=</span>
                    {typeof value === "number" && value < 0.01 ? (value as number).toExponential(1) : String(value)}
                  </span>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Error result */}
      {job.status === "failed" && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-red-700">오류 발생</p>
          {job.error_message && (
            <p className="text-xs text-red-600 font-mono whitespace-pre-wrap break-all">{job.error_message}</p>
          )}
          {job.config && (
            <div className="border-t border-red-200 pt-2 flex flex-wrap gap-1.5">
              {Object.entries(job.config)
                .filter(([, v]) => v !== null && v !== -1 && v !== undefined)
                .map(([key, value]) => (
                  <span key={key} className="px-1.5 py-0.5 bg-red-100 rounded text-xs text-red-700">
                    <span className="text-red-400">{key}=</span>
                    {typeof value === "number" && value < 0.01 ? (value as number).toExponential(1) : String(value)}
                  </span>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Log output — fixed height */}
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-gray-900">
          <span className="text-xs font-medium text-gray-300">로그 출력</span>
          <span className="text-xs text-gray-500">{logs.length}줄</span>
        </div>
        <div className="bg-gray-950 px-4 py-3 h-72 overflow-y-auto font-mono">
          {logs.length === 0 ? (
            <p className="text-xs text-gray-500">대기 중...</p>
          ) : (
            logs.map((l, i) => (
              <div key={i} className="flex gap-2 text-xs leading-5">
                <span className="text-gray-600 shrink-0">{l.ts}</span>
                <span className={
                  l.type === "success" ? "text-green-400"
                  : l.type === "error"   ? "text-red-400"
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

export default TrainingMonitor;
