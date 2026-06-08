import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  FlaskConical, RefreshCw, Plus, X, CheckCircle, AlertCircle,
  Loader, ChevronRight, Trophy, Trash2, Download,
} from "lucide-react";
import { useLocation } from "react-router-dom";
import { api, modelsApi, trainingDataApi, modelValidationApi, settingsApi, ModelRecord, Dataset, ScoutValidationPrediction } from "../services/api";
import { useAgentPolling } from "../hooks/useAgentPolling";

const OWNED_PATH = "/model-validation";
import { emitPipelineEvent } from "../pipelineEvent";
import PageHelp from "../components/PageHelp";

const AGENT_TOOL_RESULT_EVENT = "nella-agent-tool-result";
const AGENT_PAGE_START_EVENT = "nella-agent-page-start";
const SS_AGENT_ACTIVE_PAGE = "nella.agent.activePage";

// SFT 계열(QA/CoT/ToT/GoT)은 동일한 학습 경로를 공유하므로 모델 검증에서도 함께 후보로 본다.
const SFT_FAMILY = new Set(["sft", "sft_alpaca", "cot", "tot", "got"]);
const isSftFamily = (t: string | undefined | null) => !!t && SFT_FAMILY.has(t);
const DT_LABEL: Record<string, string> = {
  sft: "QA", sft_alpaca: "QA", qa: "QA",
  cot: "CoT", tot: "ToT", got: "GoT", dpo: "DPO",
};
const dtLabel = (t: string) => DT_LABEL[t] ?? t.toUpperCase();

interface AgentValidationProgress {
  status: "idle" | "running" | "completed" | "error";
  phase?: string;
  percent?: number;
  ts?: number;
  message?: string;
  current_model?: string;
  current_model_index?: number;
  total_models?: number;
  completed_models?: string[];
}

interface ModelResult {
  order: number;
  predictedDelta: number;
  predictedDeltaStd?: number;
  baseJudgeScore?: number | null;
  estimatedFinalScore?: number | null;
  recommendation: string;
}

const rankBadge = (rank: string) => {
  if (rank === "추천")
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full"><CheckCircle className="w-3 h-3" />추천</span>;
  if (rank === "보통")
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs font-medium rounded-full"><AlertCircle className="w-3 h-3" />보통</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 text-xs font-medium rounded-full"><X className="w-3 h-3" />비추천</span>;
};

const modelShortName = (modelId: string) => modelId.split("/").pop() || modelId;

const filterPredictionsForModels = (
  predictions: ScoutValidationPrediction[],
  modelIds: string[],
) => {
  if (modelIds.length === 0) return predictions;
  const fullIds = new Set(modelIds);
  const byShort = new Map(modelIds.map((id) => [modelShortName(id), id]));
  return predictions
    .filter((row) => fullIds.has(row.model) || byShort.has(row.model))
    .map((row) => ({ ...row, model: byShort.get(row.model) || row.model }))
    .sort((a, b) => a.rank - b.rank)
    .map((row, idx) => ({ ...row, rank: idx + 1 }));
};

const ModelValidation: React.FC = () => {
  // ── 데이터 로딩 ───────────────────────────────────
  const [downloadedModels, setDownloadedModels] = useState<ModelRecord[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [modelsRes, dsRes] = await Promise.all([
        modelsApi.listDownloaded(),
        trainingDataApi.list(),
      ]);
      setDownloadedModels(modelsRes.data ?? []);
      setDatasets(dsRes.data ?? []);
    } catch { /* ignore */ } finally { setLoadingModels(false); }
  }, []);
  const isActive = useLocation().pathname === OWNED_PATH;
  useAgentPolling(fetchData, { idle: 10_000, active: 2_000, enabled: isActive });

  // ── 폼 상태 ───────────────────────────────────────
  // 다중 데이터셋 체크박스 (Training 페이지와 동일 패턴)
  const [selectedDatasetIds, setSelectedDatasetIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState<"final_score" | "improvement">("improvement");
  const [numSamples, setNumSamples] = useState(0);
  const [scoringProvider, setScoringProvider] = useState<"openai" | "anthropic" | "ollama" | "mock">("openai");

  useEffect(() => {
    settingsApi.get()
      .then((res) => {
        const provider = res.data?.llm_provider;
        if (provider === "openai" || provider === "anthropic" || provider === "ollama") {
          setScoringProvider(provider);
        }
      })
      .catch(() => { /* keep OpenAI fallback */ });
  }, []);

  const selectedDatasetRecords = datasets.filter((d) => selectedDatasetIds.includes(String(d.id)));
  const totalSampleSum = selectedDatasetRecords.reduce((s, d) => s + (d.train_count ?? 0), 0);
  const sampleMax = Math.max(1, totalSampleSum || 200);
  const defaultSampleCount = Math.max(1, Math.round(sampleMax * 0.10));
  const clampedNumSamples = Math.max(1, Math.min(numSamples || 1, sampleMax));

  // 데이터셋 선택이 바뀌면 평가 샘플 수를 합계 train_count의 10% 기본값으로 자동 조정.
  useEffect(() => {
    if (selectedDatasetIds.length === 0) {
      setNumSamples(0);
      return;
    }
    setNumSamples(defaultSampleCount);
    // defaultSampleCount는 selectedDatasetIds로부터 파생되므로 deps에 추가하지 않아도 충분.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDatasetIds]);

  const toggleDataset = (id: string) => {
    setSelectedDatasetIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  // 다운로드된 모델 체크박스 선택
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  // 직접 입력한 추가 모델
  const [extraModels, setExtraModels] = useState<string[]>([]);
  const [newModelInput, setNewModelInput] = useState("");

  const toggleCheck = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleAddExtra = () => {
    const t = newModelInput.trim();
    if (!t || extraModels.includes(t) || checkedIds.has(t)) return;
    setExtraModels((p) => [...p, t]);
    setNewModelInput("");
  };

  const handleRemoveExtra = (m: string) => {
    setExtraModels((p) => p.filter((x) => x !== m));
    setResults((p) => { const n = { ...p }; delete n[m]; return n; });
  };

  // All selected candidate models
  const candidateModels: string[] = [
    ...Array.from(checkedIds),
    ...extraModels,
  ];

  // ── 평가 ──────────────────────────────────────────
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [results, setResults] = useState<Record<string, ModelResult>>({});
  const [agentProgress, setAgentProgress] = useState<AgentValidationProgress | null>(null);
  const evaluationAbortRef = useRef<AbortController | null>(null);
  const lastAgentProgressRef = useRef<AgentValidationProgress | null>(null);
  const processedProgressResultRef = useRef<number | null>(null);

  const toRankLabel = (row: ScoutValidationPrediction) => {
    const value = selectionMode === "final_score" ? row.estimated_final_score : row.predicted_delta;
    if ((value ?? 0) >= (selectionMode === "final_score" ? 8 : 0.1)) return "추천";
    if ((value ?? 0) >= (selectionMode === "final_score" ? 6.5 : 0)) return "보통";
    return "비추천";
  };

  const handleStartEvaluation = async () => {
    if (isEvaluating) {
      evaluationAbortRef.current?.abort();
      evaluationAbortRef.current = null;
      // Server keeps running the subprocess pipeline after the client aborts.
      // Tell the backend to cancel the actual run (and kill its subprocesses).
      const primaryId = selectedDatasetIds.length > 0 ? Number(selectedDatasetIds[0]) : null;
      if (primaryId !== null && Number.isFinite(primaryId)) {
        modelValidationApi.cancelScout(primaryId).catch(() => {});
      }
      setIsEvaluating(false);
      setAgentProgress(null);
      emitPipelineEvent({ kind: "cancel", label: "🔬 모델 검증 중단", detail: "사용자 요청으로 중단됨" });
      return;
    }
    if (selectedDatasetIds.length === 0 || candidateModels.length === 0) return;
    setIsEvaluating(true);
    setResults({});
    const controller = new AbortController();
    evaluationAbortRef.current = controller;
    const dsLabel = selectedDatasetIds.length > 1
      ? `${selectedDatasetIds.length}개 데이터셋 병합 · ${candidateModels.length}개 후보 모델`
      : `${candidateModels.length}개 후보 모델`;
    emitPipelineEvent({ kind: "start", label: "🔬 모델 검증 시작", detail: dsLabel });
    try {
      const res = await modelValidationApi.runScout({
        dataset_ids: selectedDatasetIds.map(Number),
        model_ids: candidateModels,
        selection_mode: selectionMode,
        judge_provider: selectionMode === "final_score" ? scoringProvider : undefined,
        sample_limit: clampedNumSamples,
      }, { signal: controller.signal });
      const filteredPredictions = filterPredictionsForModels(res.data.predictions, candidateModels);
      const next: Record<string, ModelResult> = {};
      filteredPredictions.forEach((row) => {
        next[row.model] = {
          order: row.rank,
          predictedDelta: row.predicted_delta,
          predictedDeltaStd: row.predicted_delta_std,
          baseJudgeScore: row.base_judge_score,
          estimatedFinalScore: row.estimated_final_score,
          recommendation: toRankLabel(row),
        };
      });
      emitPipelineEvent({ kind: "complete", label: "🔬 모델 검증 완료", detail: `${filteredPredictions.length}개 모델 평가됨` });
      setResults(next);
    } catch (e) {
      if ((e as { code?: string; name?: string })?.code === "ERR_CANCELED" || (e as { name?: string })?.name === "CanceledError") {
        return;
      }
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "모델 검증 실패";
      emitPipelineEvent({ kind: "failed", label: "🔬 모델 검증 실패", detail: msg });
      alert(msg);
    } finally {
      evaluationAbortRef.current = null;
      setIsEvaluating(false);
    }
  };

  const applyAgentModelValidation = useCallback((rawResult: Record<string, unknown>, ts = Date.now()) => {
    const rawPredictions = (rawResult.predictions as Array<Record<string, unknown>> | undefined) ?? [];
    if (rawPredictions.length === 0) return;

    const dsIdsArr = Array.isArray(rawResult.dataset_ids)
      ? (rawResult.dataset_ids as unknown[]).map((x) => String(x)).filter(Boolean)
      : [];
    if (dsIdsArr.length > 0) {
      setSelectedDatasetIds(dsIdsArr);
    } else {
      const datasetId = rawResult.dataset_id ?? rawResult.datasetId;
      if (datasetId != null) setSelectedDatasetIds([String(datasetId)]);
    }

    const mode = rawResult.selection_mode;
    if (mode === "final_score" || mode === "improvement") {
      setSelectionMode(mode);
    }
    const sampleLimit = Number(rawResult.sample_limit ?? rawResult.sampleLimit ?? 0);
    if (sampleLimit > 0) setNumSamples(sampleLimit);

    const requestedModelIds = (rawResult.model_ids as string[] | undefined) ?? [];
    const candidateIds = (requestedModelIds.length > 0 ? requestedModelIds : rawPredictions
      .map((row) => String(row.model ?? row.hf_model_id ?? ""))
      .filter(Boolean));
    const allowedPredictions: Array<Record<string, unknown>> = rawPredictions
      .filter((row) => {
        if (requestedModelIds.length === 0) return true;
        const model = String(row.model ?? row.hf_model_id ?? "");
        const short = modelShortName(model);
        return requestedModelIds.some((id) => id === model || modelShortName(id) === short);
      })
      .map((row) => {
        const model = String(row.model ?? row.hf_model_id ?? "");
        const full = requestedModelIds.find((id) => id === model || modelShortName(id) === modelShortName(model));
        return { ...row, model: full ?? model };
      });
    const candidateIdsForDisplay = candidateIds
      .filter(Boolean);
    const downloaded = new Set(downloadedModels.map((m) => m.hf_model_id));
    setCheckedIds(new Set(candidateIdsForDisplay.filter((id) => downloaded.has(id))));
    setExtraModels(candidateIdsForDisplay.filter((id) => !downloaded.has(id)));

    setIsEvaluating(true);
    setResults({});
    window.setTimeout(() => {
      const next: Record<string, ModelResult> = {};
      allowedPredictions.forEach((row) => {
        const model = String(row.model ?? row.hf_model_id ?? "");
        if (!model) return;
        const pred: ScoutValidationPrediction = {
          rank: Number(row.rank ?? 999),
          candidate_dataset_dir: String(row.candidate_dataset_dir ?? ""),
          model,
          predicted_delta: Number(row.predicted_delta ?? 0),
          predicted_delta_std: row.predicted_delta_std != null ? Number(row.predicted_delta_std) : undefined,
          base_judge_score: row.base_judge_score != null ? Number(row.base_judge_score) : null,
          estimated_final_score: row.estimated_final_score != null ? Number(row.estimated_final_score) : null,
          tcm_path: String(row.tcm_path ?? ""),
        };
        next[model] = {
          order: pred.rank,
          predictedDelta: pred.predicted_delta,
          predictedDeltaStd: pred.predicted_delta_std,
          baseJudgeScore: pred.base_judge_score,
          estimatedFinalScore: pred.estimated_final_score,
          recommendation: toRankLabel(pred),
        };
      });
      setResults(next);
      setIsEvaluating(false);
      setAgentProgress(null);
      emitPipelineEvent({ kind: "complete", label: "🔬 모델 검증 완료", detail: `${allowedPredictions.length}개 모델 평가됨` });
    }, Math.max(600, Math.min(1800, Date.now() - ts + 600)));
  }, [downloadedModels, selectionMode]);

  useEffect(() => {
    const handleAgentResult = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string; result?: Record<string, unknown> }>).detail;
      if (detail?.name === "run_model_validation" && detail.result) {
        applyAgentModelValidation(detail.result);
      }
    };
    window.addEventListener(AGENT_TOOL_RESULT_EVENT, handleAgentResult);
    try {
      const stored = window.sessionStorage.getItem("nella.agent.lastToolResult");
      if (stored) {
        const parsed = JSON.parse(stored) as { name?: string; result?: Record<string, unknown>; ts?: number };
        if (parsed.name === "run_model_validation" && parsed.result && parsed.ts && Date.now() - parsed.ts < 10_000) {
          applyAgentModelValidation(parsed.result, parsed.ts);
        }
      }
    } catch { /* ignore */ }
    return () => window.removeEventListener(AGENT_TOOL_RESULT_EVENT, handleAgentResult);
  }, [applyAgentModelValidation]);

  const handleReset = () => setResults({});

  useEffect(() => {
    const setMonotonicAgentProgress = (next: AgentValidationProgress) => {
      setAgentProgress((prev) => {
        if (!prev || prev.status === "completed" || prev.status === "error") {
          return next;
        }
        const prevPercent = prev?.percent ?? 0;
        const nextPercent = next.percent ?? prevPercent;
        const prevTs = prev?.ts ?? 0;
        const nextTs = next.ts ?? Date.now() / 1000;

        if (
          prev?.status === "running" &&
          next.status === "running" &&
          next.phase === "preparing" &&
          prev.phase &&
          prev.phase !== "preparing"
        ) {
          return prev;
        }
        if (
          prev?.status === "running" &&
          next.status === "running" &&
          nextPercent < prevPercent &&
          nextTs <= prevTs + 1
        ) {
          return { ...prev, ...next, phase: prev.phase, percent: prevPercent, message: prev.message };
        }
        return { ...next, percent: Math.max(prevPercent, nextPercent) };
      });
      lastAgentProgressRef.current = next;
    };

    const applyCandidateIds = (ids: string[]) => {
      if (ids.length === 0) return;
      const downloaded = new Set(downloadedModels.map((m) => m.hf_model_id));
      setCheckedIds(new Set(ids.filter((id) => downloaded.has(id))));
      setExtraModels(ids.filter((id) => !downloaded.has(id)));
    };

    const handleAgentPageStart = (event: Event) => {
      const detail = (event as CustomEvent<{ page?: string; label?: string; ts?: number }>).detail;
      if (detail?.page !== "/model-validation") return;
      if (lastAgentProgressRef.current?.status === "running") return;
      setIsEvaluating(true);
      setResults({});
      setMonotonicAgentProgress({
        status: "running",
        phase: "preparing",
        percent: 8,
        message: detail.label || "모델 검증을 준비하고 있습니다.",
      });
    };

    const pollProgress = window.setInterval(async () => {
      try {
        const res = await api.get<AgentValidationProgress & {
          dataset_id?: number | string;
          model_ids?: string[];
          predictions?: Array<Record<string, unknown>>;
          selection_mode?: "final_score" | "improvement";
          sample_limit?: number;
          judge_provider?: "openai" | "anthropic" | "ollama" | "mock" | null;
        }>("/chat/agent-progress/model-validation");
        const progress = res.data;
        if (!progress || progress.status === "idle") return;
        setMonotonicAgentProgress(progress);
        const progressDsIds = Array.isArray((progress as { dataset_ids?: unknown[] }).dataset_ids)
          ? ((progress as { dataset_ids?: unknown[] }).dataset_ids as unknown[]).map((x) => String(x)).filter(Boolean)
          : [];
        if (progressDsIds.length > 0) {
          setSelectedDatasetIds(progressDsIds);
        } else if (progress.dataset_id != null) {
          setSelectedDatasetIds([String(progress.dataset_id)]);
        }
        if (progress.selection_mode === "final_score" || progress.selection_mode === "improvement") {
          setSelectionMode(progress.selection_mode);
        }
        if (progress.sample_limit) setNumSamples(Number(progress.sample_limit));
        if (progress.judge_provider && ["openai", "anthropic", "ollama", "mock"].includes(progress.judge_provider)) {
          setScoringProvider(progress.judge_provider);
        }
        if (Array.isArray(progress.model_ids)) applyCandidateIds(progress.model_ids);
        if (
          progress.status === "completed" &&
          Array.isArray(progress.predictions) &&
          progress.predictions.length > 0 &&
          processedProgressResultRef.current !== progress.ts
        ) {
          processedProgressResultRef.current = progress.ts ?? Date.now();
          applyAgentModelValidation(progress as unknown as Record<string, unknown>, (progress.ts ?? Date.now() / 1000) * 1000);
        }
        if (progress.status === "running") setIsEvaluating(true);
        if (progress.status === "error") setIsEvaluating(false);
      } catch { /* ignore progress polling errors */ }
    }, 2000);

    window.addEventListener(AGENT_PAGE_START_EVENT, handleAgentPageStart);
    try {
      const active = window.sessionStorage.getItem(SS_AGENT_ACTIVE_PAGE);
      if (active) {
        const parsed = JSON.parse(active) as { page?: string; label?: string; ts?: number };
        if (parsed.page === "/model-validation" && parsed.ts && Date.now() - parsed.ts < 60_000) {
          handleAgentPageStart(new CustomEvent(AGENT_PAGE_START_EVENT, { detail: parsed }));
        }
      }
    } catch { /* ignore */ }
    return () => {
      window.clearInterval(pollProgress);
      window.removeEventListener(AGENT_PAGE_START_EVENT, handleAgentPageStart);
    };
  }, [downloadedModels]);

  const hasResults = Object.keys(results).length > 0;
  const bestModel = hasResults
    ? Object.entries(results).reduce((b, [m, r]) => r.order < b[1].order ? [m, r] : b)[0]
    : null;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="w-7 h-7 rounded-md bg-blue-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">5</span>
          <FlaskConical className="w-5 h-5 text-blue-600 flex-shrink-0" />
          <div>
            <div className="flex items-center gap-1"><h1 className="text-xl font-bold text-gray-900">모델 검증</h1><PageHelp pageKey="modelValidation" /><span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-semibold rounded-full">Beta</span></div>
            <p className="text-xs text-gray-500">후보 모델 적합성 평가 및 비교</p>
          </div>
        </div>
        <button onClick={handleReset} className="p-2 hover:bg-gray-100 rounded-lg" title="초기화">
          <RefreshCw className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
        <p className="text-sm text-gray-600 leading-relaxed">
          파인튜닝 전에 여러 후보 베이스 모델을 학습 데이터셋에 대해 비교 평가하고, 가장 적합한 모델을 선택하세요.
          내부 반응 기반 개선율 예측과 선택적 LLM Judge 평가로 후보 기반 모델의 순위를 매깁니다.
        </p>
      </div>

      {/* ── 상단: 평가 설정 + 후보 모델 선택 나란히 ── */}
      <div className="grid grid-cols-12 gap-6 items-start lg:items-stretch">
        {/* 평가 설정 */}
        <div className="col-span-12 lg:col-span-6">
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4 h-full">
            <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <ChevronRight className="w-4 h-4 text-purple-500" />평가 설정
            </h2>

            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1 flex items-center gap-1.5">
                평가 데이터셋 (다중 선택 가능)
                <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-blue-100 text-blue-700">SFT</span>
              </label>
              {(() => {
                const sftDatasets = datasets.filter((d) => isSftFamily(d.data_type));
                if (sftDatasets.length === 0) {
                  return (
                    <div className="w-full border border-amber-200 bg-amber-50 rounded-lg px-3 py-2 text-xs text-amber-700">
                      SFT 계열(QA/CoT/ToT/GoT) 데이터셋이 없습니다. 먼저 데이터 생성 단계에서 만들어 주세요.
                    </div>
                  );
                }
                return (
                  <div className="border border-gray-200 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                    {sftDatasets.map((d) => {
                      const checked = selectedDatasetIds.includes(String(d.id));
                      const ready = (d.train_count ?? 0) > 0;
                      return (
                        <label key={d.id}
                          className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors border-b border-gray-100 last:border-0 ${
                            checked ? "bg-purple-50" : ready ? "hover:bg-gray-50" : "opacity-50 cursor-not-allowed"
                          }`}>
                          <input type="checkbox" disabled={!ready}
                            checked={checked}
                            onChange={() => toggleDataset(String(d.id))}
                            className="w-3.5 h-3.5 rounded accent-purple-500 flex-shrink-0" />
                          <span className="flex-1 min-w-0">
                            <span className="text-xs font-medium text-gray-800 truncate block">
                              <span className="text-gray-400 mr-1">[{dtLabel(d.data_type)}]</span>{d.name}
                            </span>
                            <span className="text-[10px] text-gray-400">{ready ? `${d.train_count}개 학습샘플` : "생성 중..."}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                );
              })()}
              {selectedDatasetIds.length > 1 && (
                <p className="text-[10px] text-purple-600 mt-1">✓ {selectedDatasetIds.length}개 데이터셋 선택됨 — 검증 시 자동 병합</p>
              )}
            </div>

            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1.5">기반 모델 선정 방식</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setSelectionMode("final_score")}
                  className={`px-3 py-2 rounded-lg text-xs font-medium border text-left ${selectionMode === "final_score" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
                  A: 최종 점수 기반
                </button>
                <button type="button" onClick={() => setSelectionMode("improvement")}
                  className={`px-3 py-2 rounded-lg text-xs font-medium border text-left ${selectionMode === "improvement" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
                  B: 개선율 기반
                </button>
              </div>
              <div className="mt-1.5 space-y-0.5 text-xs text-gray-400 leading-relaxed">
                <p>A: 시간이 더 걸리지만, 지금 잘하는 정도와 학습 후 좋아질 가능성을 함께 보고 고릅니다.</p>
                <p>B: 더 간단하게, 별도 평가 없이 학습했을 때 가장 많이 좋아질 모델을 고릅니다.</p>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">
                평가 샘플 수 (기본 10% · {defaultSampleCount}개 / 최대 {sampleMax}개)
              </label>
              <input type="number" value={numSamples === 0 ? "" : Math.min(numSamples, sampleMax)} min={1} max={sampleMax}
                disabled={selectedDatasetRecords.length === 0}
                onChange={(e) => {
                  const value = e.target.value;
                  setNumSamples(value === "" ? 0 : Math.max(1, Math.min(Number(value), sampleMax)));
                }}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300" />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1.5">LLM 평가 제공자</label>
              <div className="flex gap-2">
                {[{ id: "openai", label: "OpenAI" }, { id: "anthropic", label: "Claude" }, { id: "ollama", label: "Ollama" }].map((p) => (
                  <button key={p.id} onClick={() => setScoringProvider(p.id as "openai" | "anthropic" | "ollama")}
                    disabled={selectionMode !== "final_score"}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      selectionMode !== "final_score" ? "bg-gray-100 text-gray-300 border-gray-200 cursor-not-allowed" :
                      scoringProvider === p.id ? "bg-purple-600 text-white border-purple-600" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                    }`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <button onClick={handleStartEvaluation}
              disabled={!isEvaluating && (selectedDatasetIds.length === 0 || candidateModels.length === 0)}
              className={`w-full flex items-center justify-center gap-2 py-2.5 text-white rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${
                isEvaluating ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
              }`}>
              {isEvaluating
                ? <><X className="w-4 h-4" />중단하기</>
                : <><FlaskConical className="w-4 h-4" />검증 시작 ({candidateModels.length}개 모델)</>}
            </button>
          </div>
        </div>

        {/* 후보 모델 선택 */}
        <div className="col-span-12 lg:col-span-6">
          <div className="bg-white border border-gray-200 rounded-xl p-5 h-full max-h-[456px] grid grid-rows-[auto_minmax(0,1fr)_auto_auto] gap-4">
            <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <ChevronRight className="w-4 h-4 text-purple-500" />후보 모델 선택
            </h2>

            {/* 다운로드된 모델 체크박스 */}
            <div className="min-h-0 overflow-hidden">
              <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
                <Download className="w-3.5 h-3.5" />다운로드된 기반 모델
              </p>
              {loadingModels ? (
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <Loader className="w-3.5 h-3.5 animate-spin" />로딩 중...
                </div>
              ) : downloadedModels.length === 0 ? (
                <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
                  다운로드된 모델이 없습니다. 기반모델 선택 페이지에서 먼저 다운로드하세요.
                </p>
              ) : (
                <div className="h-full space-y-1.5 overflow-y-auto pr-1 pb-1">
                  {downloadedModels.map((m) => (
                    <label key={m.hf_model_id}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                        checkedIds.has(m.hf_model_id)
                          ? "border-purple-400 bg-purple-50"
                          : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                      }`}>
                      <input type="checkbox" checked={checkedIds.has(m.hf_model_id)}
                        onChange={() => toggleCheck(m.hf_model_id)}
                        className="w-4 h-4 accent-purple-600 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className={`text-xs font-medium truncate ${checkedIds.has(m.hf_model_id) ? "text-purple-700" : "text-gray-700"}`}>
                          {m.name}
                        </p>
                        <p className="text-xs text-gray-400 truncate font-mono">{m.hf_model_id}</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* 직접 입력 추가 */}
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">HuggingFace 모델 ID 직접 추가</p>
              <div className="flex gap-2">
                <input type="text" value={newModelInput} onChange={(e) => setNewModelInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddExtra()}
                  placeholder="예: Qwen/Qwen2.5-1.5B"
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300" />
                <button onClick={handleAddExtra} disabled={!newModelInput.trim()}
                  className="flex items-center gap-1 px-3 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-40 transition-colors">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              {extraModels.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {extraModels.map((m) => (
                    <li key={m} className="flex items-center justify-between gap-2 px-3 py-1.5 bg-gray-50 rounded-lg border border-gray-200">
                      <span className="text-xs font-mono text-gray-700 truncate">{m}</span>
                      <button onClick={() => handleRemoveExtra(m)} className="p-0.5 text-gray-400 hover:text-red-500 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {candidateModels.length > 0 && (
              <p className="text-xs text-purple-600 font-medium">{candidateModels.length}개 모델 선택됨</p>
            )}
          </div>
        </div>
      </div>

      {/* ── 하단: 평가 결과 전체 폭 ── */}
      <div>
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4 min-h-[300px]">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                <Trophy className="w-4 h-4 text-yellow-500" />평가 결과
              </h2>
              {hasResults && (
                <button onClick={handleReset}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                  <Trash2 className="w-3 h-3" />초기화
                </button>
              )}
            </div>

            {/* Empty */}
            {candidateModels.length === 0 && !isEvaluating && !hasResults && (
              <div className="flex flex-col items-center justify-center h-72 text-center space-y-3">
                <div className="p-4 bg-gray-50 rounded-full">
                  <FlaskConical className="w-8 h-8 text-gray-300" />
                </div>
                <p className="text-sm text-gray-400 max-w-xs">
                  왼쪽에서 비교할 모델을 체크하고 평가를 시작하세요
                </p>
              </div>
            )}

            {/* Selected but not evaluated */}
            {candidateModels.length > 0 && !isEvaluating && !hasResults && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">모델</th>
                      <th className="text-center py-2 px-3 text-xs font-medium text-gray-500">예측 개선율</th>
                      <th className="text-center py-2 px-3 text-xs font-medium text-gray-500">LLM Judge</th>
                      <th className="text-center py-2 px-3 text-xs font-medium text-gray-500">예상 최종점수</th>
                      <th className="text-center py-2 px-3 text-xs font-medium text-gray-500">권장</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidateModels.map((m) => (
                      <tr key={m} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-3 px-3 text-xs font-mono text-gray-700 max-w-[180px] truncate">{m}</td>
                        {[...Array(4)].map((_, i) => <td key={i} className="py-3 px-3 text-center text-xs text-gray-300">—</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Evaluating */}
            {isEvaluating && (
              <div className="space-y-4 py-4">
                <div className="flex items-center gap-2 text-sm text-purple-600 font-medium">
                  <Loader className="w-4 h-4 animate-spin" />
                  {agentProgress?.message || "모델 평가 진행 중..."}
                </div>
                {agentProgress && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>{agentProgress.phase || "running"}</span>
                      <span className="font-mono tabular-nums">{Math.max(0, Math.min(100, agentProgress.percent ?? 35))}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-2 bg-purple-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(4, Math.min(100, agentProgress.percent ?? 35))}%` }}
                      />
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  {(() => {
                    // 추출 단계(8~60%)를 모델 수로 균등 분할 → 현재 모델 구간만 로컬 0~100%로 매핑.
                    // 백엔드가 모델 단위로만 percent를 emit하므로 한 모델이 끝나야 다음 모델 바가 움직임 = 직렬.
                    const total = candidateModels.length || 1;
                    const phase = agentProgress?.phase;
                    const globalPct = Math.max(0, Math.min(100, agentProgress?.percent ?? 0));
                    const extractStart = 8;
                    const extractEnd = 60;
                    const share = (extractEnd - extractStart) / total;
                    const currentIdx0 = (agentProgress?.current_model_index ?? 0) - 1;
                    return candidateModels.map((m, i) => {
                      const completed = agentProgress?.completed_models?.includes(m);
                      const current = agentProgress?.current_model === m && !completed;
                      let localPct = 0;
                      if (completed) {
                        localPct = 100;
                      } else if (current && phase === "extracting") {
                        const base = extractStart + currentIdx0 * share;
                        localPct = Math.max(0, Math.min(100, ((globalPct - base) / share) * 100));
                      } else if (current) {
                        // 추출 외 단계에서는 백엔드가 per-model 진행을 주지 않으므로 단순 활성 표시만.
                        localPct = 50;
                      }
                      return (
                        <div key={m} className={`rounded-lg border px-3 py-2 ${current ? "border-purple-300 bg-purple-50" : completed ? "border-green-200 bg-green-50" : "border-gray-200 bg-white"}`}>
                          <div className="flex items-center justify-between gap-3">
                            <span className={`text-xs font-mono truncate ${current ? "text-purple-700 font-semibold" : completed ? "text-green-700" : "text-gray-500"}`}>{m}</span>
                            <span className={`text-[11px] font-medium whitespace-nowrap ${current ? "text-purple-600" : completed ? "text-green-600" : "text-gray-400"}`}>
                              {completed ? "완료" : current ? `처리 중 ${agentProgress?.current_model_index ?? i + 1}/${agentProgress?.total_models ?? total} · ${Math.round(localPct)}%` : "대기"}
                            </span>
                          </div>
                          <div className="mt-1.5 w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                            <div
                              className={`h-1.5 rounded-full transition-all duration-500 ${completed ? "bg-green-500" : current ? "bg-purple-500" : "bg-gray-200"}`}
                              style={{ width: `${localPct}%` }}
                            />
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}

            {/* Results */}
            {hasResults && !isEvaluating && (
              <div className="space-y-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">모델</th>
                        <th className="text-center py-2 px-3 text-xs font-medium text-gray-500">예측 개선율</th>
                        <th className="text-center py-2 px-3 text-xs font-medium text-gray-500">LLM Judge</th>
                        <th className="text-center py-2 px-3 text-xs font-medium text-gray-500">예상 최종점수</th>
                        <th className="text-center py-2 px-3 text-xs font-medium text-gray-500">권장</th>
                        <th className="py-2 px-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(results).sort((a, b) => a[1].order - b[1].order).map(([m, r]) => {
                        const isBest = m === bestModel;
                        return (
                          <tr key={m} className={`border-b border-gray-50 transition-colors ${isBest ? "bg-yellow-50" : "hover:bg-gray-50"}`}>
                            <td className="py-3 px-3">
                              <div className="flex items-center gap-1.5">
                                {isBest && <Trophy className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />}
                                <span className="text-xs font-mono text-gray-700 truncate max-w-[150px] block">{m}</span>
                              </div>
                            </td>
                            <td className="py-3 px-3 text-center text-xs font-semibold text-gray-700">{(r.predictedDelta * 100).toFixed(1)}%</td>
                            <td className="py-3 px-3 text-center text-xs font-semibold text-gray-700">{r.baseJudgeScore != null ? `${r.baseJudgeScore.toFixed(1)}/10` : "—"}</td>
                            <td className="py-3 px-3 text-center text-xs text-gray-600">{r.estimatedFinalScore != null ? r.estimatedFinalScore.toFixed(2) : "—"}</td>
                            <td className="py-3 px-3 text-center">{rankBadge(r.recommendation)}</td>
                            <td className="py-3 px-3 text-right">
                              {isBest && (
                                <button className="flex items-center gap-1 px-2.5 py-1 bg-yellow-500 text-white rounded-lg text-xs font-medium hover:bg-yellow-600 transition-colors whitespace-nowrap">
                                  <CheckCircle className="w-3 h-3" />최적 선택
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {bestModel && (
                  <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <Trophy className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-yellow-800">
                      <span className="font-semibold">{bestModel}</span> 모델이 현재 선정 방식 기준 1순위입니다.
                      파인튜닝 베이스 모델로 권장합니다.
                    </p>
                  </div>
                )}
              </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default ModelValidation;
