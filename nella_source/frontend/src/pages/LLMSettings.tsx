import React, { useEffect, useState } from "react";
import {
  Bot,
  Eye,
  EyeOff,
  CheckCircle,
  XCircle,
  Loader2,
  RefreshCw,
  Save,
  ChevronDown,
} from "lucide-react";
import { settingsApi } from "../services/api";
import PageHelp from "../components/PageHelp";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProviderState {
  apiKey: string;          // blank = unchanged (masked)
  model: string;
  baseUrl: string;
  dirty: boolean;
  saving: boolean;
  testing: boolean;
  testResult: { ok: boolean; message: string } | null;
}

type Provider = "openai" | "anthropic" | "ollama";

const INITIAL: ProviderState = {
  apiKey: "",
  model: "",
  baseUrl: "",
  dirty: false,
  saving: false,
  testing: false,
  testResult: null,
};

// ─── KeyInput ─────────────────────────────────────────────────────────────────

const KeyInput: React.FC<{
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}> = ({ value, placeholder, onChange }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
};

// ─── ModelSelect (for Ollama) ──────────────────────────────────────────────────

const OllamaModelSelect: React.FC<{
  value: string;
  models: string[];
  loading: boolean;
  onChange: (v: string) => void;
  onRefresh: () => void;
}> = ({ value, models, loading, onChange, onRefresh }) => {
  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        {models.length > 0 ? (
          <>
            <select
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="w-full appearance-none border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {!models.includes(value) && value && (
                <option value={value}>{value}</option>
              )}
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </>
        ) : (
          <input
            type="text"
            value={value}
            placeholder="예: llama3.2, qwen2.5:7b"
            onChange={(e) => onChange(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        )}
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={loading}
        title="서버에서 모델 목록 불러오기"
        className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 text-gray-600 whitespace-nowrap"
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <RefreshCw className="w-3.5 h-3.5" />
        )}
        목록
      </button>
    </div>
  );
};

// ─── TestResultBadge ──────────────────────────────────────────────────────────

const TestResultBadge: React.FC<{ result: { ok: boolean; message: string } }> = ({
  result,
}) => (
  <div
    className={`flex items-start gap-2 text-sm rounded-lg p-3 ${
      result.ok
        ? "bg-green-50 text-green-800 border border-green-200"
        : "bg-red-50 text-red-800 border border-red-200"
    }`}
  >
    {result.ok ? (
      <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
    ) : (
      <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
    )}
    <span className="break-all">{result.message}</span>
  </div>
);

// ─── ProviderCard ─────────────────────────────────────────────────────────────

interface ProviderCardProps {
  provider: Provider;
  title: string;
  icon: React.ReactNode;
  accentColor: string;
  isDefault: boolean;
  isConfigured: boolean;
  state: ProviderState;
  ollamaModels?: string[];
  ollamaModelsLoading?: boolean;
  onFetchOllamaModels?: () => void;
  onChange: (partial: Partial<ProviderState>) => void;
  onTest: () => void;
  onSave: () => void;
  onSetDefault: () => void;
  showApiKey: boolean;
  showBaseUrl: boolean;
  apiKeyPlaceholder?: string;
  modelPlaceholder?: string;
  baseUrlPlaceholder?: string;
  modelOptions?: string[];
}

const ProviderCard: React.FC<ProviderCardProps> = ({
  provider,
  title,
  icon,
  accentColor,
  isDefault,
  isConfigured,
  state,
  ollamaModels,
  ollamaModelsLoading,
  onFetchOllamaModels,
  onChange,
  onTest,
  onSave,
  onSetDefault,
  showApiKey,
  showBaseUrl,
  apiKeyPlaceholder,
  modelPlaceholder,
  baseUrlPlaceholder,
  modelOptions,
}) => {
  return (
    <div
      className={`bg-white rounded-xl border-2 transition-colors ${
        isDefault ? `border-${accentColor}-400` : "border-gray-200"
      } p-6`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center bg-${accentColor}-50`}
          >
            {icon}
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{title}</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  isConfigured ? "bg-green-500" : "bg-gray-300"
                }`}
              />
              <span className="text-xs text-gray-500">
                {isConfigured ? "설정됨" : "미설정"}
              </span>
            </div>
          </div>
        </div>
        <button
          onClick={onSetDefault}
          className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
            isDefault
              ? `bg-${accentColor}-100 text-${accentColor}-700 border-${accentColor}-300`
              : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
          }`}
        >
          {isDefault ? "기본 공급자" : "기본으로 설정"}
        </button>
      </div>

      {/* Fields */}
      <div className="space-y-3">
        {showApiKey && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              API Key
            </label>
            <KeyInput
              value={state.apiKey}
              placeholder={apiKeyPlaceholder || "sk-..."}
              onChange={(v) => onChange({ apiKey: v, dirty: true, testResult: null })}
            />
          </div>
        )}

        {showBaseUrl && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Base URL
            </label>
            <input
              type="text"
              value={state.baseUrl}
              placeholder={baseUrlPlaceholder || "http://localhost:11434"}
              onChange={(e) =>
                onChange({ baseUrl: e.target.value, dirty: true, testResult: null })
              }
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            모델
          </label>
          {provider === "ollama" && ollamaModels !== undefined ? (
            <OllamaModelSelect
              value={state.model}
              models={ollamaModels}
              loading={ollamaModelsLoading ?? false}
              onChange={(v) => onChange({ model: v, dirty: true, testResult: null })}
              onRefresh={onFetchOllamaModels!}
            />
          ) : modelOptions && modelOptions.length > 0 ? (
            <div className="relative">
              <select
                value={state.model}
                onChange={(e) =>
                  onChange({ model: e.target.value, dirty: true, testResult: null })
                }
                className="w-full appearance-none border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                {modelOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          ) : (
            <input
              type="text"
              value={state.model}
              placeholder={modelPlaceholder || "모델명 입력"}
              onChange={(e) =>
                onChange({ model: e.target.value, dirty: true, testResult: null })
              }
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
        </div>
      </div>

      {/* Test result */}
      {state.testResult && (
        <div className="mt-4">
          <TestResultBadge result={state.testResult} />
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 mt-5">
        <button
          onClick={onTest}
          disabled={state.testing || state.saving}
          className="flex items-center gap-1.5 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 text-gray-700"
        >
          {state.testing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <CheckCircle className="w-4 h-4" />
          )}
          연결 테스트
        </button>
        <button
          onClick={onSave}
          disabled={!state.dirty || state.saving || state.testing}
          className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"
        >
          {state.saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          저장
        </button>
      </div>
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

const OPENAI_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4-turbo",
  "gpt-4",
  "gpt-3.5-turbo",
];
const ANTHROPIC_MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-haiku-20241022",
];

const LLMSettings: React.FC = () => {
  const [defaultProvider, setDefaultProvider] = useState("openai");
  const [openaiConfigured, setOpenaiConfigured] = useState(false);
  const [anthropicConfigured, setAnthropicConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [globalSaveMsg, setGlobalSaveMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Provider>("openai");

  const [openai, setOpenai] = useState<ProviderState>({ ...INITIAL });
  const [anthropic, setAnthropic] = useState<ProviderState>({ ...INITIAL });
  const [ollama, setOllama] = useState<ProviderState>({ ...INITIAL });
  const [openaiKeyMasked, setOpenaiKeyMasked] = useState<string>("sk-...");
  const [anthropicKeyMasked, setAnthropicKeyMasked] = useState<string>("sk-ant-...");
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaModelsLoading, setOllamaModelsLoading] = useState(false);

  // Load current settings on mount
  useEffect(() => {
    settingsApi
      .get()
      .then((res) => {
        const s = res.data as {
          llm_provider: string;
          openai_model: string;
          openai_api_key_set: boolean;
          openai_api_key_masked?: string;
          openai_base_url: string | null;
          anthropic_model: string;
          anthropic_api_key_set: boolean;
          anthropic_api_key_masked?: string;
          ollama_base_url: string;
          ollama_model: string;
        };
        setDefaultProvider(s.llm_provider || "openai");
        setOpenaiConfigured(s.openai_api_key_set);
        setAnthropicConfigured(s.anthropic_api_key_set);
        if (s.openai_api_key_masked) setOpenaiKeyMasked(s.openai_api_key_masked);
        if (s.anthropic_api_key_masked) setAnthropicKeyMasked(s.anthropic_api_key_masked);
        setOpenai((p) => ({
          ...p,
          model: s.openai_model || "gpt-4o-mini",
          baseUrl: s.openai_base_url || "",
        }));
        setAnthropic((p) => ({
          ...p,
          model: s.anthropic_model || "claude-sonnet-4-6",
        }));
        setOllama((p) => ({
          ...p,
          baseUrl: s.ollama_base_url || "http://localhost:11434",
          model: s.ollama_model || "llama3.2",
        }));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const fetchOllamaModels = async (baseUrl?: string) => {
    setOllamaModelsLoading(true);
    try {
      const res = await settingsApi.getOllamaModels(baseUrl || ollama.baseUrl || undefined);
      setOllamaModels(res.data.models);
      if (res.data.models.length > 0 && !ollama.model) {
        setOllama((p) => ({ ...p, model: res.data.models[0] }));
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "연결 실패";
      setOllama((p) => ({
        ...p,
        testResult: { ok: false, message: msg },
      }));
    } finally {
      setOllamaModelsLoading(false);
    }
  };

  const handleSetDefault = async (provider: Provider) => {
    setDefaultProvider(provider);
    try {
      await settingsApi.update({ llm_provider: provider });
      setGlobalSaveMsg(`기본 공급자를 ${provider}로 변경했습니다.`);
      setTimeout(() => setGlobalSaveMsg(null), 3000);
    } catch {}
  };

  const handleTest = async (provider: Provider) => {
    const setState = provider === "openai" ? setOpenai : provider === "anthropic" ? setAnthropic : setOllama;
    const state = provider === "openai" ? openai : provider === "anthropic" ? anthropic : ollama;

    setState((p) => ({ ...p, testing: true, testResult: null }));
    try {
      const res = await settingsApi.testProvider(
        provider,
        state.apiKey || undefined,
        state.model || undefined,
        state.baseUrl || undefined,
      );
      const d = res.data as { response?: string; model?: string };
      setState((p) => ({
        ...p,
        testing: false,
        testResult: {
          ok: true,
          message: `연결 성공 (${d.model || state.model}): ${d.response || "OK"}`,
        },
      }));
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "연결 실패";
      setState((p) => ({ ...p, testing: false, testResult: { ok: false, message: msg } }));
    }
  };

  const handleSave = async (provider: Provider) => {
    const setState = provider === "openai" ? setOpenai : provider === "anthropic" ? setAnthropic : setOllama;
    const state = provider === "openai" ? openai : provider === "anthropic" ? anthropic : ollama;

    setState((p) => ({ ...p, saving: true }));
    const payload: Record<string, unknown> = {};

    if (provider === "openai") {
      if (state.apiKey) payload.openai_api_key = state.apiKey;
      if (state.model) payload.openai_model = state.model;
      if (state.baseUrl !== undefined) payload.openai_base_url = state.baseUrl;
    } else if (provider === "anthropic") {
      if (state.apiKey) payload.anthropic_api_key = state.apiKey;
      if (state.model) payload.anthropic_model = state.model;
    } else {
      if (state.baseUrl) payload.ollama_base_url = state.baseUrl;
      if (state.model) payload.ollama_model = state.model;
    }

    try {
      await settingsApi.update(payload);
      if (provider === "openai" && state.apiKey) setOpenaiConfigured(true);
      if (provider === "anthropic" && state.apiKey) setAnthropicConfigured(true);
      setState((p) => ({ ...p, saving: false, dirty: false, apiKey: "" }));
      setGlobalSaveMsg("설정이 저장되었습니다.");
      setTimeout(() => setGlobalSaveMsg(null), 3000);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "저장 실패";
      setState((p) => ({ ...p, saving: false, testResult: { ok: false, message: msg } }));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Bot className="w-7 h-7 text-blue-600" />
        <div>
          <div className="flex items-center"><h1 className="text-xl font-bold text-gray-900">LLM 설정</h1><PageHelp pageKey="llmSettings" /></div>
          <p className="text-sm text-gray-500">
            학습데이터 생성 및 검증에 사용할 LLM 공급자를 설정합니다.
          </p>
        </div>
      </div>

      {/* Global save message */}
      {globalSaveMsg && (
        <div className="mb-4 flex items-center gap-2 bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg px-4 py-3">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {globalSaveMsg}
        </div>
      )}

      {/* ── 기본 LLM 공급자 선택 ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
        <p className="text-sm font-semibold text-gray-700 mb-1">기본 LLM 공급자</p>
        <p className="text-xs text-gray-400 mb-3">학습데이터 생성·검증·NELLA 어시스턴트에 기본으로 사용할 공급자를 선택합니다.</p>
        <div className="grid grid-cols-3 gap-3">
          {([
            { id: "openai" as Provider,    label: "OpenAI",  sub: "GPT-4o",     configured: openaiConfigured },
            { id: "anthropic" as Provider, label: "Claude",  sub: "Haiku/Sonnet", configured: anthropicConfigured },
            { id: "ollama" as Provider,    label: "Ollama",  sub: "로컬 실행",   configured: true },
          ]).map((p) => (
            <button
              key={p.id}
              onClick={() => handleSetDefault(p.id)}
              className={`flex flex-col items-center gap-2 py-4 px-3 rounded-xl border-2 transition-all ${
                defaultProvider === p.id
                  ? "border-blue-500 bg-blue-50 shadow-sm"
                  : "border-gray-200 hover:border-blue-300 hover:bg-blue-50/40"
              }`}
            >
              <span className={`w-2.5 h-2.5 rounded-full ${p.configured ? "bg-green-500" : "bg-gray-300"}`} />
              <span className={`text-sm font-bold ${defaultProvider === p.id ? "text-blue-700" : "text-gray-700"}`}>
                {p.label}
              </span>
              <span className="text-[10px] text-gray-400">{p.sub}</span>
              {defaultProvider === p.id && (
                <span className="text-[10px] bg-blue-600 text-white px-2 py-0.5 rounded-full font-semibold">기본값</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Provider tabs */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-gray-200">
          {([
            { id: "openai" as Provider,    label: "OpenAI",  configured: openaiConfigured },
            { id: "anthropic" as Provider, label: "Claude",  configured: anthropicConfigured },
            { id: "ollama" as Provider,    label: "Ollama",  configured: true },
          ]).map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors relative ${
                activeTab === t.id ? "text-blue-600" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${t.configured ? "bg-green-500" : "bg-gray-300"}`} />
              {t.label}
              {defaultProvider === t.id && (
                <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full leading-none">기본</span>
              )}
              {activeTab === t.id && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-t" />
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-5">
          {activeTab === "openai" && (
            <ProviderCard
              provider="openai"
              title="OpenAI"
              icon={<span className="text-green-600 font-bold text-sm">GPT</span>}
              accentColor="green"
              isDefault={defaultProvider === "openai"}
              isConfigured={openaiConfigured}
              state={openai}
              onChange={(p) => setOpenai((prev) => ({ ...prev, ...p }))}
              onTest={() => handleTest("openai")}
              onSave={() => handleSave("openai")}
              onSetDefault={() => handleSetDefault("openai")}
              showApiKey
              showBaseUrl
              apiKeyPlaceholder={openaiKeyMasked}
              baseUrlPlaceholder="(비워두면 OpenAI 기본 URL 사용)"
              modelOptions={OPENAI_MODELS}
            />
          )}
          {activeTab === "anthropic" && (
            <ProviderCard
              provider="anthropic"
              title="Anthropic (Claude)"
              icon={<span className="text-purple-600 font-bold text-xs">ANT</span>}
              accentColor="purple"
              isDefault={defaultProvider === "anthropic"}
              isConfigured={anthropicConfigured}
              state={anthropic}
              onChange={(p) => setAnthropic((prev) => ({ ...prev, ...p }))}
              onTest={() => handleTest("anthropic")}
              onSave={() => handleSave("anthropic")}
              onSetDefault={() => handleSetDefault("anthropic")}
              showApiKey
              showBaseUrl={false}
              apiKeyPlaceholder={anthropicKeyMasked}
              modelOptions={ANTHROPIC_MODELS}
            />
          )}
          {activeTab === "ollama" && (
            <ProviderCard
              provider="ollama"
              title="Ollama (로컬)"
              icon={<span className="text-orange-600 font-bold text-xs">OLL</span>}
              accentColor="orange"
              isDefault={defaultProvider === "ollama"}
              isConfigured={true}
              state={ollama}
              ollamaModels={ollamaModels}
              ollamaModelsLoading={ollamaModelsLoading}
              onFetchOllamaModels={() => fetchOllamaModels(ollama.baseUrl || undefined)}
              onChange={(p) => setOllama((prev) => ({ ...prev, ...p }))}
              onTest={() => handleTest("ollama")}
              onSave={() => handleSave("ollama")}
              onSetDefault={() => handleSetDefault("ollama")}
              showApiKey={false}
              showBaseUrl
              baseUrlPlaceholder="http://localhost:11434"
              modelPlaceholder="예: llama3.2, qwen2.5:7b"
            />
          )}
        </div>
      </div>

      <p className="mt-2 text-xs text-gray-400">
        * API 키는 서버에 저장되며 화면에 표시되지 않습니다. 변경 시에만 입력하세요.
      </p>
    </div>
  );
};

export default LLMSettings;
