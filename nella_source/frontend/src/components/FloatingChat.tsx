import React, { useState, useRef, useEffect } from "react";
import { useProviderModels } from "../hooks/useProviderModels";
import { MessageSquare, X, Minus, Bot, User, Send, Loader } from "lucide-react";
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


const FloatingChat: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  // Provider / model state
  const [providerInfo, setProviderInfo] = useState<ProviderInfo | null>(null);
  const [mode, setMode] = useState<ProviderMode>("openai");
  // Live model list for the selected provider (see constants/models.ts).
  const { models: presetModels } = useProviderModels(mode);
  const [providerModel, setProviderModel] = useState("");
  const [localModels, setLocalModels] = useState<Array<{ path: string; name: string }>>([]);
  const [localModelPath, setLocalModelPath] = useState("");
  const [localModelName, setLocalModelName] = useState("");
  const [modelReady, setModelReady] = useState(false);
  const [loadingModel, setLoadingModel] = useState(false);
  const [setupDone, setSetupDone] = useState(false);

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Fetch provider info once on first open
  useEffect(() => {
    if (isOpen && !setupDone) {
      fetchSetup();
    }
  }, [isOpen]);

  const fetchSetup = async () => {
    try {
      const [pRes, mRes, trRes] = await Promise.all([
        api.get<ProviderInfo>("/settings/available-providers"),
        modelsApi.listDownloaded(),
        trainingApi.listTrainedModels(),
      ]);
      const p = pRes.data;
      setProviderInfo(p);

      // Pick best default mode
      const best: ProviderMode =
        (["openai", "anthropic", "ollama"] as ProviderMode[]).find((m) => p[m as keyof ProviderInfo]) as ProviderMode
        ?? "local";

      let initModel = "";
      if (best === "openai") initModel = p.openai_model;
      else if (best === "anthropic") initModel = p.anthropic_model;
      else if (best === "ollama") initModel = p.ollama_model;

      setMode(best);
      setProviderModel(initModel);
      if (best !== "local") setModelReady(true);

      // Build local model list
      const locals: Array<{ path: string; name: string }> = [];
      for (const m of mRes.data) {
        if (m.local_path) locals.push({ path: m.local_path, name: m.name });
      }
      for (const t of trRes.data) {
        const path = (t as { merged_dir?: string; output_dir?: string }).merged_dir
          || (t as { output_dir?: string }).output_dir;
        if (path && t.status === "completed") {
          locals.push({ path, name: t.name });
        }
      }
      setLocalModels(locals);
    } catch {
      // silently fail — user can still try
    } finally {
      setSetupDone(true);
    }
  };

  useEffect(() => {
    if (isOpen && !isMinimized) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen, isMinimized]);

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
      const msg = e instanceof Error ? e.message : "응답을 가져오지 못했습니다.";
      setError(msg);
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
    ...(providerInfo?.openai ? ["openai" as ProviderMode] : []),
    ...(providerInfo?.anthropic ? ["anthropic" as ProviderMode] : []),
    ...(providerInfo?.ollama ? ["ollama" as ProviderMode] : []),
    "local",
  ];

  const assistantCount = messages.filter((m) => m.role === "assistant").length;

  return (
    <>
      {/* Floating toggle button — always visible when panel is closed */}
      {!isOpen && (
        <button
          onClick={() => { setIsOpen(true); setIsMinimized(false); }}
          className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-xl flex items-center justify-center z-50 transition-transform hover:scale-105"
          title="AI 어시스턴트 열기"
        >
          <MessageSquare className="w-6 h-6" />
          {assistantCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[20px] h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
              {assistantCount}
            </span>
          )}
        </button>
      )}

      {/* Chat panel */}
      {isOpen && (
        <div
          className={`fixed bottom-6 right-6 w-96 bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col z-50 overflow-hidden transition-all duration-200 ${
            isMinimized ? "h-[52px]" : "h-[560px]"
          }`}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 bg-blue-600 text-white flex-shrink-0">
            <Bot className="w-4 h-4 flex-shrink-0" />
            <span className="font-semibold text-sm flex-1 min-w-0 truncate">
              {modelReady && !isMinimized
                ? mode === "local"
                  ? localModelName || "로컬 모델"
                  : `${PROVIDER_LABELS[mode]} · ${providerModel}`
                : "AI 어시스턴트"}
            </span>
            {messages.length > 0 && (
              <span className="text-[10px] bg-blue-500 px-1.5 py-0.5 rounded-full flex-shrink-0">
                {messages.length}
              </span>
            )}
            <button
              onClick={() => setIsMinimized((v) => !v)}
              className="p-1 hover:bg-blue-500 rounded transition-colors flex-shrink-0"
              title={isMinimized ? "펼치기" : "최소화"}
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-blue-500 rounded transition-colors flex-shrink-0"
              title="닫기"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {!isMinimized && (
            <>
              {/* Provider / model bar */}
              <div className="px-3 pt-2 pb-2 border-b border-gray-100 bg-gray-50 flex-shrink-0 space-y-1.5">
                {/* Provider tabs */}
                <div className="flex gap-1 flex-wrap">
                  {(setupDone ? enabledModes : (["openai", "anthropic", "ollama", "local"] as ProviderMode[])).map((m) => (
                    <button
                      key={m}
                      onClick={() => handleModeChange(m)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                        mode === m
                          ? "bg-blue-600 text-white"
                          : "bg-white text-gray-600 border border-gray-200 hover:border-blue-300 hover:text-blue-600"
                      }`}
                    >
                      {PROVIDER_LABELS[m]}
                    </button>
                  ))}
                </div>

                {/* Model selector for preset-model providers */}
                {mode !== "local" && mode !== "ollama" && presetModels.length > 0 && (
                  <select
                    value={providerModel}
                    onChange={(e) => setProviderModel(e.target.value)}
                    className="w-full text-[11px] border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                  >
                    {presetModels.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                )}

                {/* Ollama model input */}
                {mode === "ollama" && (
                  <input
                    type="text"
                    value={providerModel}
                    onChange={(e) => setProviderModel(e.target.value)}
                    placeholder="Ollama 모델명 (예: llama3.2)"
                    className="w-full text-[11px] border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                )}

                {/* Local model selector */}
                {mode === "local" && (
                  <select
                    value={localModelPath}
                    onChange={(e) => {
                      const loc = localModels.find((x) => x.path === e.target.value);
                      if (loc) loadLocalModel(loc.path, loc.name);
                    }}
                    className="w-full text-[11px] border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                    disabled={loadingModel}
                  >
                    <option value="">모델 선택...</option>
                    {localModels.map((m) => (
                      <option key={m.path} value={m.path}>{m.name}</option>
                    ))}
                  </select>
                )}

                {loadingModel && (
                  <p className="text-[11px] text-blue-600 animate-pulse flex items-center gap-1">
                    <Loader className="w-3 h-3 animate-spin" /> 모델 로딩 중...
                  </p>
                )}
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <Bot className="w-10 h-10 text-gray-200 mb-2" />
                    <p className="text-xs text-gray-400">
                      {modelReady
                        ? "메시지를 입력해 대화를 시작하세요"
                        : mode === "local"
                        ? "로컬 모델을 선택해주세요"
                        : "AI 서비스가 준비됐습니다"}
                    </p>
                  </div>
                )}

                {messages.map((msg, idx) => (
                  <div key={idx} className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                        msg.role === "user" ? "bg-blue-600" : "bg-gray-200"
                      }`}
                    >
                      {msg.role === "user" ? (
                        <User className="w-3 h-3 text-white" />
                      ) : (
                        <Bot className="w-3 h-3 text-gray-600" />
                      )}
                    </div>
                    <div
                      className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                        msg.role === "user"
                          ? "bg-blue-600 text-white rounded-tr-sm"
                          : "bg-gray-100 text-gray-800 rounded-tl-sm"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                      <p
                        className={`text-[10px] mt-0.5 ${
                          msg.role === "user" ? "text-blue-200" : "text-gray-400"
                        }`}
                      >
                        {msg.ts.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                ))}

                {sending && (
                  <div className="flex gap-2">
                    <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center">
                      <Bot className="w-3 h-3 text-gray-600" />
                    </div>
                    <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-3 py-2.5">
                      <Loader className="w-3 h-3 text-gray-400 animate-spin" />
                    </div>
                  </div>
                )}

                {error && !sending && (
                  <p className="text-[11px] text-red-500 text-center bg-red-50 px-3 py-1.5 rounded-lg">
                    {error}
                  </p>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="border-t border-gray-100 p-3 flex-shrink-0">
                <div className="flex gap-2 items-end">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={
                      modelReady
                        ? "메시지 입력... (Enter 전송)"
                        : mode === "local"
                        ? "로컬 모델을 먼저 선택하세요"
                        : "메시지 입력..."
                    }
                    rows={1}
                    disabled={!modelReady || sending}
                    className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 max-h-20 disabled:bg-gray-50 disabled:text-gray-400"
                  />
                  <button
                    onClick={sendMessage}
                    disabled={!modelReady || !input.trim() || sending}
                    className="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
                {messages.length > 0 && (
                  <button
                    onClick={() => { setMessages([]); setError(null); }}
                    className="text-[10px] text-gray-400 hover:text-gray-500 mt-1.5 w-full text-center"
                  >
                    대화 초기화
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
};

export default FloatingChat;
