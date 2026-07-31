import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAgentPolling } from "../hooks/useAgentPolling";
import { useAgentToolResult } from "../hooks/useAgentToolResult";
import { MessageSquare } from "lucide-react";
import { useLocation, useSearchParams } from "react-router-dom";

const OWNED_PATH = "/chat";
import { Link } from "react-router-dom";
import { trainingApi, chatApi, modelsApi, ragDbApi, ModelRecord, TrainedModelRecord, RagCollection, api } from "../services/api";
import ChatWindow from "../components/ChatWindow";
import PageHelp from "../components/PageHelp";
import { useT } from "../i18n";

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
  const { t } = useT();
  const [searchParams] = useSearchParams();
  const [completedJobs, setCompletedJobs] = useState<TrainedModelRecord[]>([]);
  const [downloadedModels, setDownloadedModels] = useState<ModelRecord[]>([]);
  const [availableProviders, setAvailableProviders] = useState<AvailableProviders | null>(null);
  const [mode, setMode] = useState<ProviderMode>("local");
  const [selectedModelPath, setSelectedModelPath] = useState("");
  const [selectedModelName, setSelectedModelName] = useState("");
  const [providerModel, setProviderModel] = useState("");
  const [ragTopK, setRagTopK] = useState(4);
  const [ragDefaultExtractor, setRagDefaultExtractor] = useState("openDataLoader");
  const [ragCollections, setRagCollections] = useState<RagCollection[]>([]);
  const [ragCollectionIds, setRagCollectionIds] = useState<number[]>([]);
  const ragEnabled = ragCollectionIds.length > 0;
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoProviderRef = useRef(false);
  const toolProviderModelRef = useRef<string | null>(null);

  const loadModels = useCallback(async () => {
    const [jobs, models, providers, settings, ragCols] = await Promise.allSettled([
      trainingApi.listTrainedModels(true), modelsApi.listDownloaded(),
      api.get<AvailableProviders>("/settings/available-providers"),
      api.get<{ rag_top_k: number; rag_default_extractor: string }>("/settings"),
      ragDbApi.list(),
    ]);
    if (jobs.status === "fulfilled")      setCompletedJobs((jobs.value.data ?? []).filter((j: TrainedModelRecord) => j.status === "completed" && j.output_dir));
    if (models.status === "fulfilled")    setDownloadedModels(models.value.data ?? []);
    if (providers.status === "fulfilled") setAvailableProviders(providers.value.data);
    if (settings.status === "fulfilled") {
      setRagTopK(settings.value.data.rag_top_k ?? 4);
      setRagDefaultExtractor(settings.value.data.rag_default_extractor ?? "openDataLoader");
    }
    if (ragCols.status === "fulfilled") {
      const list = ragCols.value.data ?? [];
      setRagCollections(list);
    }
  }, []);
  const isActive = useLocation().pathname === OWNED_PATH;
  const [injectQA, setInjectQA] = useState<{ question: string; answer: string; ts: number } | null>(null);
  // NELLA가 test_model_chat을 실행 중일 때 UI에 파라미터/현황을 반영하기 위한 상태
  const [agentChatProgress, setAgentChatProgress] = useState<{
    phase: "preparing" | "generating" | "done" | "error";
    percent?: number;
    message?: string;
    provider?: string | null;
    provider_model?: string;
    use_rag?: boolean;
    rag_collection_ids?: number[];
    model_path?: string;
    question?: string;
    answer_preview?: string;
    ts?: number;
  } | null>(null);
  const lastAppliedAgentTsRef = useRef<number>(0);
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
        // 에이전트가 use_rag=true로 호출했으면 체크박스도 실제로 체크한다.
        const argsUseRag = detail.args?.use_rag === true;
        const rawIds = detail.args?.rag_collection_ids;
        if (argsUseRag && Array.isArray(rawIds) && rawIds.length > 0) {
          const ids = rawIds.map((v) => Number(v)).filter((v) => Number.isFinite(v));
          if (ids.length > 0) setRagCollectionIds(ids);
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

  // NELLA 에이전트가 test_model_chat을 실행할 때 /chat/agent-progress/chat 폴링해서
  // 파라미터(프로바이더/모델/RAG DB 선택 등)를 화면에 자동 반영한다.
  useEffect(() => {
    if (!isActive) return;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await api.get<{
          status?: string;
          phase?: "preparing" | "generating" | "done" | "error";
          percent?: number;
          message?: string;
          provider?: string | null;
          provider_model?: string;
          use_rag?: boolean;
          rag_collection_ids?: number[];
          model_path?: string;
          question?: string;
          answer_preview?: string;
          ts?: number;
        }>("/chat/agent-progress/chat");
        if (stopped) return;
        const p = res.data;
        if (!p || p.status === "idle" || !p.phase) {
          setAgentChatProgress(null);
          return;
        }
        setAgentChatProgress({
          phase: p.phase,
          percent: p.percent,
          message: p.message,
          provider: p.provider,
          provider_model: p.provider_model,
          use_rag: p.use_rag,
          rag_collection_ids: p.rag_collection_ids,
          model_path: p.model_path,
          question: p.question,
          answer_preview: p.answer_preview,
          ts: p.ts,
        });
        // 새 진행 상황(ts 갱신)일 때만 UI 옵션을 한 번 자동 세팅한다 (사용자가 이후 클릭한 걸 매 폴링마다 되돌리지 않도록).
        // phase 필터를 걸지 않는 이유: 도구가 빨리 끝나면 preparing/generating을 놓치고 done만 볼 수 있어서
        // 그때도 UI를 반영해야 한다. error phase일 때만 UI 세팅을 건너뛴다.
        const newTs = Number(p.ts || 0);
        if (newTs > lastAppliedAgentTsRef.current && p.phase !== "error") {
          lastAppliedAgentTsRef.current = newTs;
          if (p.provider === "openai" || p.provider === "anthropic" || p.provider === "ollama") {
            setMode(p.provider);
            if (p.provider_model) {
              toolProviderModelRef.current = p.provider_model;
              setProviderModel(p.provider_model);
            }
            setReady(true);
            setError(null);
          } else if (p.model_path) {
            setMode("local");
            setSelectedModelPath(p.model_path);
            setReady(true);
            setError(null);
          }
          // use_rag=true이고 실제 id가 있을 때만 체크박스를 덮어쓴다.
          // (agent가 RAG 안 쓰면 사용자가 이미 선택한 것 유지)
          if (p.use_rag && Array.isArray(p.rag_collection_ids) && p.rag_collection_ids.length > 0) {
            setRagCollectionIds(p.rag_collection_ids);
          }
        }
      } catch {
        // 서버 잠깐 끊김 등은 무시
      }
    };
    void poll();
    const interval = setInterval(poll, 2000);
    return () => { stopped = true; clearInterval(interval); };
  }, [isActive]);

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

  // 로컬 모델 자동 로드는 하지 않음 — 사용자가 명시적으로 드롭다운/URL 파라미터로 선택했을 때만 로드.
  // (?model_path=... URL 파라미터 경로는 위 useEffect에서 이미 처리)

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
        <span className="w-7 h-7 rounded-md bg-blue-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">10</span>
        <MessageSquare className="w-5 h-5 text-blue-600 flex-shrink-0" />
        <div>
          <div className="flex items-center gap-1"><h1 className="text-xl font-bold text-gray-900">{t("page.chat.title")}</h1><PageHelp pageKey="chat" /></div>
          <p className="text-xs text-gray-500">{t("page.chat.desc")}</p>
        </div>
      </div>

      {/* NELLA 에이전트 실행 배너 (test_model_chat 진행 중일 때만 노출) */}
      {agentChatProgress && agentChatProgress.phase !== "done" && agentChatProgress.phase !== "error" && (
        <div className="flex-shrink-0 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-blue-800">
                🤖 NELLA 대화 테스트 실행 중
                {agentChatProgress.provider && <span className="ml-1 text-blue-600">· {agentChatProgress.provider}{agentChatProgress.provider_model ? ` / ${agentChatProgress.provider_model}` : ""}</span>}
                {agentChatProgress.rag_collection_ids && agentChatProgress.rag_collection_ids.length > 0 && (
                  <span className="ml-1 text-blue-600">· RAG {agentChatProgress.rag_collection_ids.length}개</span>
                )}
              </p>
              {agentChatProgress.question && (
                <p className="text-xs text-blue-700 mt-0.5 truncate">
                  <span className="text-blue-500">Q:</span> {agentChatProgress.question}
                </p>
              )}
              {agentChatProgress.message && (
                <p className="text-[11px] text-blue-500 mt-0.5">{agentChatProgress.message}</p>
              )}
              {typeof agentChatProgress.percent === "number" && (
                <div className="mt-1.5 h-1 bg-blue-100 rounded overflow-hidden">
                  <div className="h-full bg-blue-500 transition-all" style={{ width: `${agentChatProgress.percent}%` }} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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

            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-gray-700">
                    RAG DB
                    {ragEnabled ? (
                      <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold">ON · {ragCollectionIds.length}개</span>
                    ) : (
                      <span className="ml-1.5 text-[10px] text-gray-400">OFF</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400">체크한 DB로 검색해 답변 컨텍스트로 사용합니다. 아무것도 체크하지 않으면 RAG를 사용하지 않습니다.</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {ragCollections.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setRagCollectionIds(
                          ragCollections
                            .filter((c) => c.status === "completed" && c.document_count > 0)
                            .map((c) => c.id)
                        )}
                        className="text-[10px] text-blue-600 hover:underline"
                      >모두 선택</button>
                      <span className="text-gray-300 text-[10px]">·</span>
                      <button
                        type="button"
                        onClick={() => setRagCollectionIds([])}
                        className="text-[10px] text-gray-500 hover:underline"
                      >해제</button>
                    </>
                  )}
                  <Link to="/rag-db" className="text-[10px] text-gray-500 hover:text-blue-600 hover:underline whitespace-nowrap">관리</Link>
                </div>
              </div>
              {ragCollections.length === 0 ? (
                <div className="text-xs text-amber-600">
                  아직 만든 RAG DB가 없습니다. <Link to="/rag-db" className="font-semibold text-blue-600 hover:underline">→ 9단계에서 생성</Link>
                </div>
              ) : (
                <div className="border border-gray-200 rounded-md bg-white max-h-36 overflow-y-auto divide-y divide-gray-50">
                  {ragCollections.map((c) => {
                    const checked = ragCollectionIds.includes(c.id);
                    const ready = c.status === "completed" && c.document_count > 0;
                    return (
                      <label
                        key={c.id}
                        className={`flex items-center gap-2 px-2.5 py-1.5 text-xs cursor-pointer ${
                          checked ? "bg-blue-50" : ready ? "hover:bg-gray-50" : "opacity-60 cursor-not-allowed"
                        }`}
                      >
                        <input
                          type="checkbox"
                          disabled={!ready}
                          checked={checked}
                          onChange={(e) => {
                            setRagCollectionIds((prev) =>
                              e.target.checked
                                ? [...prev, c.id]
                                : prev.filter((x) => x !== c.id)
                            );
                          }}
                          className="w-3.5 h-3.5 accent-blue-600 flex-shrink-0"
                        />
                        <span className="flex-1 min-w-0 truncate font-medium text-gray-800">{c.name}</span>
                        <span className="text-[10px] text-gray-400 flex-shrink-0">
                          {c.document_count}문서 · {c.chunk_count.toLocaleString()}청크
                        </span>
                        {c.status !== "completed" && (
                          <span className={`text-[10px] px-1 py-0.5 rounded flex-shrink-0 ${
                            c.status === "failed" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                          }`}>
                            {c.status === "failed" ? "실패" : "진행중"}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
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
                ragEnabled={ragEnabled && ragCollectionIds.length > 0}
                ragCollectionIds={ragCollectionIds}
                ragTopK={ragTopK}
                ragDefaultExtractor={ragDefaultExtractor}
                injectQA={injectQA}
                onInjectedQA={() => setInjectQA(null)}
                pendingUserMessage={
                  agentChatProgress && agentChatProgress.question && agentChatProgress.ts
                    ? { question: agentChatProgress.question, ts: agentChatProgress.ts }
                    : null
                }
                agentThinking={agentChatProgress?.phase === "generating"}
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
