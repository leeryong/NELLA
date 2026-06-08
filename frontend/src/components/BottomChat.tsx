import React, { useState, useRef, useEffect } from "react";
import { Bot, User, Send, Loader, ChevronDown, ChevronUp } from "lucide-react";
import { chatApi, api, trainingApi, modelsApi } from "../services/api";

type ProviderMode = "openai" | "anthropic" | "ollama" | "local";

interface Message {
  role: "user" | "assistant";
  content: string;
  ts: Date;
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
  openai: "OpenAI",
  anthropic: "Claude",
  ollama: "Ollama",
  local: "로컬 모델",
};

const PRESET_MODELS: Record<string, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"],
  anthropic: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-3-5-haiku-20241022"],
};

const BottomChat: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);

  // Provider / model
  const [providerInfo, setProviderInfo] = useState<ProviderInfo | null>(null);
  const [mode, setMode] = useState<ProviderMode>("openai");
  const [providerModel, setProviderModel] = useState("");
  const [localModels, setLocalModels] = useState<Array<{ path: string; name: string }>>([]);
  const [localModelPath, setLocalModelPath] = useState("");
  const [localModelName, setLocalModelName] = useState("");
  const [modelReady, setModelReady] = useState(false);
  const [loadingModel, setLoadingModel] = useState(false);

  // Chat
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetchSetup();
  }, []);

  const fetchSetup = async () => {
    try {
      const [pRes, mRes, trRes] = await Promise.all([
        api.get<ProviderInfo>("/settings/available-providers"),
        modelsApi.listDownloaded(),
        trainingApi.listTrainedModels(),
      ]);
      const p = pRes.data;
      setProviderInfo(p);

      const best: ProviderMode =
        (["openai", "anthropic", "ollama"] as ProviderMode[]).find(
          (m) => p[m as keyof ProviderInfo]
        ) as ProviderMode ?? "local";

      let initModel = "";
      if (best === "openai") initModel = p.openai_model;
      else if (best === "anthropic") initModel = p.anthropic_model;
      else if (best === "ollama") initModel = p.ollama_model;

      setMode(best);
      setProviderModel(initModel);
      if (best !== "local") setModelReady(true);

      const locals: Array<{ path: string; name: string }> = [];
      for (const m of mRes.data) {
        if (m.local_path) locals.push({ path: m.local_path, name: m.name });
      }
      for (const t of trRes.data) {
        const path =
          (t as { merged_dir?: string }).merged_dir ||
          (t as { output_dir?: string }).output_dir;
        if (path && t.status === "completed") locals.push({ path, name: t.name });
      }
      setLocalModels(locals);
    } catch {
      // silently fail
    }
  };

  useEffect(() => {
    if (!collapsed) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, collapsed]);

  const handleModeChange = (newMode: ProviderMode) => {
    if (!providerInfo) return;
    setMode(newMode);
    setError(null);
    setModelReady(false);
    setLocalModelPath("");
    setLocalModelName("");
    if (newMode === "openai") {
      setProviderModel(providerInfo.openai_model);
      setModelReady(true);
    } else if (newMode === "anthropic") {
      setProviderModel(providerInfo.anthropic_model);
      setModelReady(true);
    } else if (newMode === "ollama") {
      setProviderModel(providerInfo.ollama_model);
      setModelReady(true);
    }
  };

  const loadLocalModel = async (path: string, name: string) => {
    if (!path) return;
    setLoadingModel(true);
    setError(null);
    setModelReady(false);
    try {
      await chatApi.loadModel(path);
      setLocalModelPath(path);
      setLocalModelName(name);
      setModelReady(true);
    } catch {
      setError("모델 로드에 실패했습니다.");
    } finally {
      setLoadingModel(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || sending || !modelReady) return;
    const text = input.trim();
    setInput("");
    setError(null);
    const userMsg: Message = { role: "user", content: text, ts: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);
    try {
      const apiMessages = [
        { role: "system" as const, content: "You are a helpful AI assistant." },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: text },
      ];
      const res = await chatApi.complete({
        model_path: mode === "local" ? localModelPath : "",
        provider: mode === "local" ? "local" : mode,
        provider_model: mode !== "local" ? providerModel : undefined,
        messages: apiMessages,
        max_new_tokens: 512,
        temperature: 0.7,
      });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.data.response, ts: new Date() },
      ]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "응답 오류가 발생했습니다.");
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const enabledModes: ProviderMode[] = [
    ...(providerInfo?.openai ? (["openai"] as ProviderMode[]) : []),
    ...(providerInfo?.anthropic ? (["anthropic"] as ProviderMode[]) : []),
    ...(providerInfo?.ollama ? (["ollama"] as ProviderMode[]) : []),
    "local",
  ];

  const currentLabel =
    mode === "local"
      ? localModelName || "로컬 모델"
      : `${PROVIDER_LABELS[mode]} · ${providerModel}`;

  return (
    <div
      className={`flex-shrink-0 border-t border-gray-200 bg-white flex flex-col transition-all duration-200 ${
        collapsed ? "h-10" : "h-72"
      }`}
    >
      {/* Header bar — always visible */}
      <div
        className="flex items-center gap-3 px-4 h-10 flex-shrink-0 cursor-pointer select-none bg-gray-50 border-b border-gray-200"
        onClick={() => setCollapsed((v) => !v)}
      >
        <Bot className="w-4 h-4 text-blue-600 flex-shrink-0" />
        <span className="text-sm font-semibold text-gray-700 flex-shrink-0">AI 어시스턴트</span>

        {/* Provider / model tabs — inline in header */}
        {!collapsed && (
          <div
            className="flex items-center gap-1 flex-1 min-w-0"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-gray-300 mx-1">|</span>
            {enabledModes.map((m) => (
              <button
                key={m}
                onClick={() => handleModeChange(m)}
                className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors ${
                  mode === m
                    ? "bg-blue-600 text-white"
                    : "text-gray-500 hover:text-blue-600 hover:bg-blue-50"
                }`}
              >
                {PROVIDER_LABELS[m]}
              </button>
            ))}
            <span className="text-gray-300 mx-1">|</span>

            {/* Model select - compact */}
            {mode !== "local" && mode !== "ollama" && PRESET_MODELS[mode]?.length > 0 && (
              <select
                value={providerModel}
                onChange={(e) => setProviderModel(e.target.value)}
                className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 max-w-[160px]"
              >
                {PRESET_MODELS[mode].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            )}
            {mode === "ollama" && (
              <input
                type="text"
                value={providerModel}
                onChange={(e) => setProviderModel(e.target.value)}
                placeholder="모델명"
                className="text-xs border border-gray-200 rounded px-2 py-0.5 w-28 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            )}
            {mode === "local" && (
              <select
                value={localModelPath}
                onChange={(e) => {
                  const loc = localModels.find((x) => x.path === e.target.value);
                  if (loc) loadLocalModel(loc.path, loc.name);
                }}
                disabled={loadingModel}
                className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 max-w-[180px]"
              >
                <option value="">모델 선택...</option>
                {localModels.map((m) => (
                  <option key={m.path} value={m.path}>{m.name}</option>
                ))}
              </select>
            )}

            {loadingModel && (
              <span className="text-xs text-blue-500 flex items-center gap-1 ml-1">
                <Loader className="w-3 h-3 animate-spin" /> 로딩 중
              </span>
            )}
            {modelReady && !loadingModel && (
              <span className="text-xs text-green-600 ml-1">● 준비됨</span>
            )}
          </div>
        )}

        {collapsed && (
          <span className="text-xs text-gray-400 flex-1">
            {modelReady ? currentLabel : "AI와 대화하세요"}
            {messages.length > 0 && ` · ${messages.length}개 메시지`}
          </span>
        )}

        {messages.length > 0 && !collapsed && (
          <button
            onClick={(e) => { e.stopPropagation(); setMessages([]); setError(null); }}
            className="text-[10px] text-gray-400 hover:text-gray-600 px-2 py-0.5 rounded hover:bg-gray-100"
          >
            초기화
          </button>
        )}

        <button className="text-gray-400 flex-shrink-0 hover:text-gray-600">
          {collapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Body — hidden when collapsed */}
      {!collapsed && (
        <div className="flex flex-1 min-h-0">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
            {messages.length === 0 && (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-gray-400">
                  {modelReady
                    ? "메시지를 입력해 대화를 시작하세요 (Enter 전송)"
                    : mode === "local"
                    ? "위에서 로컬 모델을 선택하세요"
                    : "AI 서비스 준비 완료 — 바로 대화하세요"}
                </p>
              </div>
            )}

            {messages.map((msg, idx) => (
              <div key={idx} className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    msg.role === "user" ? "bg-blue-600" : "bg-gray-200"
                  }`}
                >
                  {msg.role === "user" ? (
                    <User className="w-2.5 h-2.5 text-white" />
                  ) : (
                    <Bot className="w-2.5 h-2.5 text-gray-600" />
                  )}
                </div>
                <div
                  className={`max-w-[70%] rounded-xl px-3 py-1.5 text-xs leading-relaxed ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white rounded-tr-sm"
                      : "bg-gray-100 text-gray-800 rounded-tl-sm"
                  }`}
                >
                  <span className="whitespace-pre-wrap">{msg.content}</span>
                  <span
                    className={`text-[10px] ml-2 ${
                      msg.role === "user" ? "text-blue-200" : "text-gray-400"
                    }`}
                  >
                    {msg.ts.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex gap-2">
                <div className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center">
                  <Bot className="w-2.5 h-2.5 text-gray-600" />
                </div>
                <div className="bg-gray-100 rounded-xl rounded-tl-sm px-3 py-1.5">
                  <Loader className="w-3 h-3 text-gray-400 animate-spin" />
                </div>
              </div>
            )}

            {error && !sending && (
              <p className="text-[11px] text-red-500 bg-red-50 px-3 py-1 rounded-lg text-center">
                {error}
              </p>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input — vertical separator + right column */}
          <div className="w-80 border-l border-gray-100 p-3 flex flex-col justify-end flex-shrink-0">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                modelReady
                  ? "메시지 입력... (Enter 전송, Shift+Enter 줄바꿈)"
                  : "모델을 선택해주세요"
              }
              rows={4}
              disabled={!modelReady || sending}
              className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
            />
            <button
              onClick={sendMessage}
              disabled={!modelReady || !input.trim() || sending}
              className="mt-2 w-full py-2 bg-blue-600 text-white rounded-xl text-xs font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
            >
              <Send className="w-3 h-3" />
              전송
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BottomChat;
