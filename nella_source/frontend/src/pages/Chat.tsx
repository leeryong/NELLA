import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAgentPolling } from "../hooks/useAgentPolling";
import { useAgentToolResult } from "../hooks/useAgentToolResult";
import { MessageSquare } from "lucide-react";
import { useLocation, useSearchParams } from "react-router-dom";

const OWNED_PATH = "/chat";
import { trainingApi, chatApi, modelsApi, ModelRecord, TrainedModelRecord, api } from "../services/api";
import ChatWindow from "../components/ChatWindow";
import PageHelp from "../components/PageHelp";

type ProviderMode = "local" | "openai" | "anthropic" | "ollama";

interface AvailableProviders {
  openai: boolean; anthropic: boolean; ollama: boolean; default: string;
  openai_model: string; anthropic_model: string; ollama_model: string;
}

const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  anthropic: ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-7"],
  ollama: [],
};

// ── Chat page ──────────────────────────────────────────
const Chat: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [completedJobs, setCompletedJobs] = useState<TrainedModelRecord[]>([]);
  const [downloadedModels, setDownloadedModels] = useState<ModelRecord[]>([]);
  const [availableProviders, setAvailableProviders] = useState<AvailableProviders | null>(null);
  const [mode, setMode] = useState<ProviderMode>("local");
  const [selectedModelPath, setSelectedModelPath] = useState("");
  const [selectedModelName, setSelectedModelName] = useState("");
  const [providerModel, setProviderModel] = useState("");
  const [ragEnabled, setRagEnabled] = useState(false);
  const [ragTopK, setRagTopK] = useState(4);
  const [ragDefaultExtractor, setRagDefaultExtractor] = useState("openDataLoader");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoLoadRef = useRef(false);
  const autoProviderRef = useRef(false);
  const toolProviderModelRef = useRef<string | null>(null);

  const loadModels = useCallback(async () => {
    const [jobs, models, providers, settings] = await Promise.allSettled([
      trainingApi.listTrainedModels(true), modelsApi.listDownloaded(),
      api.get<AvailableProviders>("/settings/available-providers"),
      api.get<{ rag_top_k: number; rag_default_extractor: string }>("/settings"),
    ]);
    if (jobs.status === "fulfilled")      setCompletedJobs((jobs.value.data ?? []).filter((j: TrainedModelRecord) => j.status === "completed" && j.output_dir));
    if (models.status === "fulfilled")    setDownloadedModels(models.value.data ?? []);
    if (providers.status === "fulfilled") setAvailableProviders(providers.value.data);
    if (settings.status === "fulfilled") {
      setRagTopK(settings.value.data.rag_top_k ?? 4);
      setRagDefaultExtractor(settings.value.data.rag_default_extractor ?? "openDataLoader");
    }
  }, []);
  const isActive = useLocation().pathname === OWNED_PATH;
  const [injectQA, setInjectQA] = useState<{ question: string; answer: string; ts: number } | null>(null);
  useAgentPolling(loadModels, { idle: 3_000, active: 2_000, enabled: isActive });
  useAgentToolResult(
    ["test_model_chat", "merge_adapter", "wait_for_merge"],
    (detail) => {
      if (detail.name === "test_model_chat" && detail.result) {
        const q = detail.result.question;
        const a = detail.result.answer;
        if (typeof q === "string" && typeof a === "string" && q && a) {
          setInjectQA({ question: q, answer: a, ts: Date.now() });
        }
        const provider = typeof detail.result.provider === "string" ? detail.result.provider : undefined;
        if (provider === "openai" || provider === "anthropic" || provider === "ollama") {
          setMode(provider);
          const model =
            typeof detail.args?.provider_model === "string" ? detail.args.provider_model :
            typeof detail.result.provider_model === "string" && detail.result.provider_model !== "(기본값)" ? detail.result.provider_model :
            provider === "openai" ? availableProviders?.openai_model :
            provider === "anthropic" ? availableProviders?.anthropic_model :
            availableProviders?.ollama_model;
          if (model) {
            toolProviderModelRef.current = model;
            setProviderModel(model);
          }
          setSelectedModelPath("");
          setSelectedModelName("");
          setReady(true);
          setError(null);
        } else if (typeof detail.result.model_path === "string" && detail.result.model_path) {
          const path = detail.result.model_path;
          const matched = completedJobs.find((j) => j.output_dir === path);
          const name =
            matched?.name ??
            (detail.args?.autoresearch_job_id ? `AutoResearch #${detail.args.autoresearch_job_id}` :
             detail.args?.job_id ? `훈련 모델 #${detail.args.job_id}` :
             path);
          setMode("local");
          setSelectedModelPath(path);
          setSelectedModelName(String(name));
          setReady(true);
          setError(null);
        }
      }
      void loadModels();
    },
    isActive,
  );

  useEffect(() => {
    if (!availableProviders) return;
    if (toolProviderModelRef.current) {
      setProviderModel(toolProviderModelRef.current);
      toolProviderModelRef.current = null;
      return;
    }
    if (mode === "openai")    setProviderModel(availableProviders.openai_model);
    if (mode === "anthropic") setProviderModel(availableProviders.anthropic_model);
    if (mode === "ollama")    setProviderModel(availableProviders.ollama_model);
  }, [mode, availableProviders]);

  useEffect(() => {
    const path = searchParams.get("model_path");
    const name = searchParams.get("model_name");
    if (path) activateLocal(path, name || path);
  }, [searchParams]);

  // 설정에서 구성된 기본 프로바이더로 자동 선택 (최초 1회, URL 파라미터 없을 때)
  useEffect(() => {
    if (!availableProviders || autoProviderRef.current || searchParams.get("model_path")) return;
    const def = availableProviders.default as ProviderMode;
    if (def === "openai" && availableProviders.openai) {
      autoProviderRef.current = true;
      setMode("openai"); setProviderModel(availableProviders.openai_model); setReady(true);
    } else if (def === "anthropic" && availableProviders.anthropic) {
      autoProviderRef.current = true;
      setMode("anthropic"); setProviderModel(availableProviders.anthropic_model); setReady(true);
    } else if (def === "ollama" && availableProviders.ollama) {
      autoProviderRef.current = true;
      setMode("ollama"); setProviderModel(availableProviders.ollama_model); setReady(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableProviders]);

  // 최신 완료 훈련 모델 자동 로드 (최초 1회, URL 파라미터 없을 때)
  useEffect(() => {
    if (autoLoadRef.current || ready || completedJobs.length === 0) return;
    if (searchParams.get("model_path")) return; // URL 파라미터 우선
    autoLoadRef.current = true;
    const latest = completedJobs.reduce((a, b) => (a.id > b.id ? a : b));
    if (latest.output_dir) {
      activateLocal(latest.output_dir, latest.name ?? `모델 #${latest.id}`);
    }
  }, [completedJobs]);

  const activateLocal = async (path: string, name: string) => {
    setReady(false); setError(null); setLoading(true);
    try {
      await chatApi.loadModel(path);
      setSelectedModelPath(path); setSelectedModelName(name); setReady(true);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail ?? "모델 로드에 실패했습니다. 경로를 확인하세요.");
    } finally { setLoading(false); }
  };

  const activateExternal = () => { setReady(true); setError(null); };

  const handleModeChange = (m: ProviderMode) => {
    setMode(m); setReady(false); setError(null); setSelectedModelPath(""); setSelectedModelName("");
  };

  const enabledProviders: { value: ProviderMode; label: string }[] = [
    { value: "local", label: "로컬 모델" },
    ...(availableProviders?.openai    ? [{ value: "openai"    as ProviderMode, label: "OpenAI" }]           : []),
    ...(availableProviders?.anthropic ? [{ value: "anthropic" as ProviderMode, label: "Anthropic Claude" }] : []),
    ...(availableProviders?.ollama    ? [{ value: "ollama"    as ProviderMode, label: "Ollama" }]           : []),
  ];

  const displayName = mode === "local"
    ? selectedModelName
    : `${enabledProviders.find((p) => p.value === mode)?.label ?? mode} / ${providerModel}`;

  const modelOptions = PROVIDER_MODELS[mode] || [];

  return (
    /* 전체 페이지: 뷰포트 높이, flex-col */
    <div className="flex flex-col p-6 gap-4" style={{ height: "100vh", maxWidth: 1200, margin: "0 auto" }}>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="w-7 h-7 rounded-md bg-blue-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">9</span>
        <MessageSquare className="w-5 h-5 text-blue-600 flex-shrink-0" />
        <div>
          <div className="flex items-center gap-1"><h1 className="text-xl font-bold text-gray-900">대화 테스트</h1><PageHelp pageKey="chat" /></div>
          <p className="text-xs text-gray-500">훈련된 모델로 직접 대화 테스트</p>
        </div>
      </div>

      {/* 메인 영역: 왼쪽(모델선택+채팅) + 오른쪽(문서업로드) */}
      <div className="flex gap-4 flex-1 min-h-0">

        {/* ── 왼쪽 컬럼 ── */}
        <div className="flex flex-col gap-4 flex-1 min-w-0">

          {/* 모델 선택 패널 */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4 flex-shrink-0">
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">대화 방식 선택</p>
              <div className="flex gap-2 flex-wrap">
                {enabledProviders.map((opt) => (
                  <button key={opt.value} onClick={() => handleModeChange(opt.value)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      mode === opt.value ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                    }`}>
                    {opt.label}
                  </button>
                ))}
              </div>
              {availableProviders && enabledProviders.length === 1 && (
                <p className="text-xs text-yellow-600 mt-1">
                  외부 AI 서비스를 사용하려면 <strong>설정</strong>에서 API Key를 저장하세요.
                </p>
              )}
            </div>

            <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <div>
                <p className="text-xs font-medium text-gray-700">RAG 사용</p>
                <p className="text-xs text-gray-400">업로드 문서를 VectorDB에서 검색해 답변 컨텍스트로 사용합니다.</p>
              </div>
              <button
                type="button"
                onClick={() => setRagEnabled((v) => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${ragEnabled ? "bg-blue-600" : "bg-gray-300"}`}
                aria-pressed={ragEnabled}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${ragEnabled ? "translate-x-5" : "translate-x-1"}`} />
              </button>
            </div>

            {mode === "local" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-600">다운로드된 기반 모델</label>
                  <select onChange={(e) => { const m = downloadedModels.find((x) => String(x.id) === e.target.value); if (m?.local_path) activateLocal(m.local_path, m.name); }}
                    value={downloadedModels.find((m) => m.local_path === selectedModelPath)?.id ?? ""}
                    className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    <option value="">선택...</option>
                    {downloadedModels.map((m) => <option key={m.id} value={m.id} disabled={!m.local_path}>{m.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">훈련 완료 모델</label>
                  <select onChange={(e) => { const j = completedJobs.find((x) => x.output_dir === e.target.value); if (j?.output_dir) activateLocal(j.output_dir, j.name); }}
                    value={completedJobs.find((j) => j.output_dir === selectedModelPath)?.output_dir ?? ""}
                    className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    <option value="">선택...</option>
                    {completedJobs.map((j) => <option key={`${j.record_type ?? "job"}-${j.id}`} value={j.output_dir || ""}>{j.record_type === "autoresearch" ? `[AR] ${j.name}` : j.name} (#{j.id})</option>)}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs font-medium text-gray-600">경로 직접 입력</label>
                  <div className="flex gap-2 mt-1">
                    <input type="text" value={selectedModelPath}
                      onChange={(e) => { setSelectedModelPath(e.target.value); setReady(false); }}
                      placeholder="/path/to/model"
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      onKeyDown={(e) => e.key === "Enter" && activateLocal(selectedModelPath, selectedModelPath)} />
                    <button onClick={() => activateLocal(selectedModelPath, selectedModelPath)}
                      disabled={!selectedModelPath || loading}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">Load</button>
                  </div>
                </div>
              </div>
            )}

            {mode !== "local" && (
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <label className="text-xs font-medium text-gray-600">모델 선택</label>
                  {modelOptions.length > 0 ? (
                    <select value={providerModel} onChange={(e) => setProviderModel(e.target.value)}
                      className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm">
                      {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  ) : (
                    <input type="text" value={providerModel} onChange={(e) => setProviderModel(e.target.value)}
                      placeholder="모델명 입력 (예: llama3.2)"
                      className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  )}
                </div>
                <button onClick={activateExternal}
                  className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 mb-0.5">시작</button>
              </div>
            )}

            {loading && (
              <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <p className="text-xs text-blue-700 font-medium">모델 로딩 중... <span className="font-normal text-blue-500">{selectedModelName || selectedModelPath}</span></p>
              </div>
            )}
            {error   && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            {ready   && (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                <p className="text-xs text-green-700">모델 준비 완료: <span className="font-semibold">{displayName}</span></p>
              </div>
            )}
          </div>

          {/* 채팅 창 */}
          <div className="flex-1 min-h-0">
            {ready ? (
              <ChatWindow
                modelPath={selectedModelPath}
                provider={mode === "local" ? undefined : mode}
                providerModel={mode !== "local" ? providerModel : undefined}
                modelName={displayName}
                ragEnabled={ragEnabled}
                ragTopK={ragTopK}
                ragDefaultExtractor={ragDefaultExtractor}
                injectQA={injectQA}
                onInjectedQA={() => setInjectQA(null)}
              />
            ) : (
              <div className="h-full flex items-center justify-center bg-white rounded-xl border border-dashed border-gray-200">
                <p className="text-gray-400 text-sm">위에서 모델 또는 AI 서비스를 선택하세요</p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default Chat;
