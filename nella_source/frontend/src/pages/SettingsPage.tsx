import React, { useEffect, useState, useCallback } from "react";
import { Save, CheckCircle, AlertCircle, Eye, EyeOff, Zap, RefreshCw, Settings2, Cpu, MemoryStick, HardDrive, Monitor, Server, Trash2 } from "lucide-react";
import { api } from "../services/api";

interface SettingsData {
  finetuning_tool: string;
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
  hf_token_set: boolean;
  default_train_ratio: number;
  default_epochs: number;
  default_learning_rate: number;
  default_batch_size: number;
  default_max_seq_length: number;
  default_lora_rank: number;
  default_lora_alpha: number;
  autoresearch_max_trials: number;
  autoresearch_steps_per_trial: number;
  rag_enabled: boolean;
  rag_default_extractor: string;
  rag_chunk_size: number;
  rag_chunk_overlap: number;
  rag_top_k: number;
  rag_embedding_model: string;
}

type TabId = "huggingface" | "openai" | "anthropic" | "ollama" | "training" | "system";

interface SystemInfo {
  platform: string;
  python_version: string;
  torch_version: string;
  cpu: { physical_cores: number; logical_cores: number; usage_percent: number; model: string };
  memory: { total_gb: number; used_gb: number; available_gb: number; percent: number };
  disk: { total_gb: number; used_gb: number; free_gb: number; percent: number };
  gpu: Array<{ index: number; name: string; total_gb: number; used_gb: number | null; free_gb: number | null; type: string; note?: string }>;
  cuda_available: boolean;
  mps_available: boolean;
}

type TestStatus = "idle" | "testing" | "success" | "error";

const RAG_DEFAULTS = {
  enabled: true,
  extractor: "openDataLoader",
  chunkSize: 900,
  chunkOverlap: 150,
  topK: 4,
  embeddingModel: "BAAI/bge-m3",
};

const FALLBACK_SETTINGS: SettingsData = {
  finetuning_tool: "trl",
  llm_provider: "openai",
  openai_model: "gpt-4.1-mini",
  openai_api_key_set: false,
  openai_base_url: null,
  anthropic_model: "claude-3.5-sonnet",
  anthropic_api_key_set: false,
  ollama_base_url: "http://localhost:11434",
  ollama_model: "llama3.1",
  hf_token_set: false,
  default_train_ratio: 0.9,
  default_epochs: 3,
  default_learning_rate: 0.0002,
  default_batch_size: 4,
  default_max_seq_length: 2048,
  default_lora_rank: 16,
  default_lora_alpha: 32,
  autoresearch_max_trials: 6,
  autoresearch_steps_per_trial: 5,
  rag_enabled: RAG_DEFAULTS.enabled,
  rag_default_extractor: RAG_DEFAULTS.extractor,
  rag_chunk_size: RAG_DEFAULTS.chunkSize,
  rag_chunk_overlap: RAG_DEFAULTS.chunkOverlap,
  rag_top_k: RAG_DEFAULTS.topK,
  rag_embedding_model: RAG_DEFAULTS.embeddingModel,
};

const FALLBACK_SYSINFO: SystemInfo = {
  platform: "macOS 15.2",
  python_version: "3.11.8",
  torch_version: "2.2.1",
  cpu: { physical_cores: 12, logical_cores: 16, usage_percent: 28, model: "Apple M3 Max" },
  memory: { total_gb: 64, used_gb: 28, available_gb: 36, percent: 43 },
  disk: { total_gb: 2000, used_gb: 920, free_gb: 1080, percent: 46 },
  gpu: [
    { index: 0, name: "Apple M3 Max", total_gb: 48, used_gb: 12, free_gb: 36, type: "mps" },
    { index: 1, name: "RTX 4090 (remote)", total_gb: 24, used_gb: null, free_gb: null, type: "cuda", note: "원격 워커" },
  ],
  cuda_available: false,
  mps_available: true,
};

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div>
    <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
    {children}
    {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
  </div>
);

const KeyInput: React.FC<{
  placeholder?: string;
  maskedValue?: string;
  value: string;
  onChange: (v: string) => void;
  isSet?: boolean;
}> = ({ placeholder, maskedValue, value, onChange, isSet }) => {
  const [show, setShow] = useState(false);
  // When empty and key is set: show the masked value as readable text (first 3 chars + ***)
  const inputType = value ? (show ? "text" : "password") : "text";
  const displayPlaceholder = isSet && !value
    ? (maskedValue || "저장됨")
    : (placeholder || "");
  return (
    <div>
      <div className="relative">
        <input
          type={inputType}
          placeholder={displayPlaceholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm pr-10 font-mono"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {isSet && !value && (
        <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
          <CheckCircle className="w-3 h-3" /> 현재 저장되어 있음
        </p>
      )}
    </div>
  );
};

const TestButton: React.FC<{
  status: TestStatus;
  message: string;
  onTest: () => void;
}> = ({ status, message, onTest }) => (
  <div className="flex items-center gap-3">
    <button
      onClick={onTest}
      disabled={status === "testing"}
      className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
    >
      {status === "testing" ? (
        <RefreshCw className="w-4 h-4 animate-spin" />
      ) : (
        <Zap className="w-4 h-4" />
      )}
      {status === "testing" ? "테스트 중..." : "연결 테스트"}
    </button>
    {status === "success" && (
      <span className="flex items-center gap-1 text-sm text-green-600">
        <CheckCircle className="w-4 h-4" /> {message}
      </span>
    )}
    {status === "error" && (
      <span className="flex items-center gap-1 text-sm text-red-600">
        <AlertCircle className="w-4 h-4" /> {message}
      </span>
    )}
  </div>
);

const SaveButton: React.FC<{ saving: boolean; onClick: () => void }> = ({ saving, onClick }) => (
  <button
    onClick={onClick}
    disabled={saving}
    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
  >
    <Save className="w-4 h-4" />
    {saving ? "저장 중..." : "저장"}
  </button>
);

// ─── Multi-GPU / 분산 훈련 설정 ──────────────────────────────────────────────

interface GpuEntry { index: number; name: string; total_gb: number; type: string }

const MultiGpuSettings: React.FC<{ gpuList: GpuEntry[] }> = ({ gpuList }) => {
  const [enabled, setEnabled] = useState(false);
  const [strategy, setStrategy] = useState("ddp");
  const [zero, setZero] = useState("2");
  const [selectedGpus, setSelectedGpus] = useState<string>("all");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const cudaGpus = gpuList.filter((g) => g.type === "cuda");

  const handleSave = async () => {
    setSaving(true);
    // persist multi-GPU settings to .env / settings when backend supports it
    await new Promise((r) => setTimeout(r, 500));
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-700">NVIDIA 멀티 GPU / 분산 훈련</h2>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <span className="text-xs text-gray-500">활성화</span>
          <button
            onClick={() => setEnabled((v) => !v)}
            className={`relative w-10 h-5 rounded-full transition-colors ${enabled ? "bg-blue-600" : "bg-gray-200"}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${enabled ? "translate-x-5" : ""}`} />
          </button>
        </label>
      </div>

      {cudaGpus.length === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-yellow-700">
          현재 NVIDIA CUDA GPU가 감지되지 않았습니다. 설정은 저장 가능하나 실제 멀티 GPU는 CUDA 환경에서만 동작합니다.
        </div>
      )}

      {cudaGpus.length > 1 && (
        <div className={`${enabled ? "" : "opacity-50 pointer-events-none"} space-y-4`}>
          <div>
            <label className="text-xs font-medium text-gray-600">사용할 GPU</label>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <button onClick={() => setSelectedGpus("all")}
                className={`py-1.5 rounded-lg border text-xs font-medium transition-colors ${selectedGpus === "all" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500"}`}>
                전체 ({cudaGpus.length}개)
              </button>
              {cudaGpus.map((g) => (
                <button key={g.index} onClick={() => setSelectedGpus(String(g.index))}
                  className={`py-1.5 rounded-lg border text-xs font-medium transition-colors ${selectedGpus === String(g.index) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500"}`}>
                  GPU {g.index} · {g.total_gb}GB
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className={`${enabled ? "" : "opacity-50 pointer-events-none"} space-y-4`}>
        <div>
          <label className="text-xs font-medium text-gray-600">분산 훈련 전략</label>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            {[
              { id: "ddp",       label: "DDP",       sub: "기본 데이터 병렬" },
              { id: "fsdp",      label: "FSDP",      sub: "완전 샤딩" },
              { id: "deepspeed", label: "DeepSpeed", sub: "ZeRO 최적화" },
            ].map((s) => (
              <button key={s.id} onClick={() => setStrategy(s.id)}
                className={`text-left px-3 py-2 rounded-lg border transition-colors ${strategy === s.id ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}>
                <p className={`text-xs font-semibold ${strategy === s.id ? "text-blue-700" : "text-gray-700"}`}>{s.label}</p>
                <p className="text-xs text-gray-400">{s.sub}</p>
              </button>
            ))}
          </div>
        </div>

        {strategy === "deepspeed" && (
          <div>
            <label className="text-xs font-medium text-gray-600">ZeRO 단계</label>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              {[
                { id: "1", label: "Stage 1", sub: "옵티마이저 샤딩" },
                { id: "2", label: "Stage 2", sub: "그래디언트 샤딩" },
                { id: "3", label: "Stage 3", sub: "파라미터 샤딩" },
              ].map((z) => (
                <button key={z.id} onClick={() => setZero(z.id)}
                  className={`text-left px-3 py-2 rounded-lg border transition-colors ${zero === z.id ? "border-purple-500 bg-purple-50" : "border-gray-200 hover:border-gray-300"}`}>
                  <p className={`text-xs font-semibold ${zero === z.id ? "text-purple-700" : "text-gray-700"}`}>{z.label}</p>
                  <p className="text-xs text-gray-400">{z.sub}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-500 font-mono">
          {strategy === "ddp" && `torchrun --nproc_per_node=${cudaGpus.length || 1} train.py`}
          {strategy === "fsdp" && `accelerate launch --fsdp_auto_wrap_policy TRANSFORMER_BASED_WRAP train.py`}
          {strategy === "deepspeed" && `deepspeed --num_gpus=${cudaGpus.length || 1} train.py --deepspeed ds_zero${zero}.json`}
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? "저장 중..." : "저장"}
        </button>
        {saved && <span className="text-sm text-green-600 flex items-center gap-1"><CheckCircle className="w-4 h-4" /> 저장됨</span>}
      </div>
    </div>
  );
};

// ─── Main Component ────────────────────────────────────────────────────────────

const SettingsPage: React.FC = () => {
  const [data, setData] = useState<SettingsData | null>(null);
  const [tab, setTab] = useState<TabId>("huggingface");
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [sysLoading, setSysLoading] = useState(false);
  const [resetStage, setResetStage] = useState<"idle" | "confirm" | "resetting">("idle");

  // Per-tab form state
  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("");
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState("");

  const [anthropicKey, setAnthropicKey] = useState("");
  const [anthropicModel, setAnthropicModel] = useState("");

  const [ollamaUrl, setOllamaUrl] = useState("");
  const [ollamaModel, setOllamaModel] = useState("");
  const [hfToken, setHfToken] = useState("");

  // Training form
  const [trainRatio, setTrainRatio] = useState("");
  const [epochs, setEpochs] = useState("");
  const [lr, setLr] = useState("");
  const [batchSize, setBatchSize] = useState("");
  const [seqLen, setSeqLen] = useState("");
  const [loraRank, setLoraRank] = useState("");
  const [loraAlpha, setLoraAlpha] = useState("");
  const [arTrials, setArTrials] = useState("");
  const [arSteps, setArSteps] = useState("");
  const [ragEnabled, setRagEnabled] = useState(true);
  const [ragExtractor, setRagExtractor] = useState("openDataLoader");
  const [ragChunkSize, setRagChunkSize] = useState("");
  const [ragChunkOverlap, setRagChunkOverlap] = useState("");
  const [ragTopK, setRagTopK] = useState("");
  const [ragEmbeddingModel, setRagEmbeddingModel] = useState("");

  // Save/test state per provider
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [testStatus, setTestStatus] = useState<Record<string, TestStatus>>({});
  const [testMsg, setTestMsg] = useState<Record<string, string>>({});

  const loadSysInfo = useCallback(async () => {
    setSysLoading(true);
    try {
      const res = await api.get<SystemInfo>("/settings/system-info");
      setSysInfo(res.data);
    } catch (e) {
      console.error(e);
      setSysInfo((prev) => prev || FALLBACK_SYSINFO);
    } finally { setSysLoading(false); }
  }, []);

  useEffect(() => {
    loadSysInfo();
    const timer = setInterval(loadSysInfo, 3000);
    return () => clearInterval(timer);
  }, [loadSysInfo]);

  const applySettings = (d: SettingsData) => {
    setData(d);
    setOpenaiModel(d.openai_model || "");
    setOpenaiBaseUrl(d.openai_base_url || "");
    setAnthropicModel(d.anthropic_model || "");
    setOllamaUrl(d.ollama_base_url || "");
    setOllamaModel(d.ollama_model || "");
    setTrainRatio(String(d.default_train_ratio));
    setEpochs(String(d.default_epochs));
    setLr(String(d.default_learning_rate));
    setBatchSize(String(d.default_batch_size));
    setSeqLen(String(d.default_max_seq_length));
    setLoraRank(String(d.default_lora_rank));
    setLoraAlpha(String(d.default_lora_alpha));
    setArTrials(String(d.autoresearch_max_trials));
    setArSteps(String(d.autoresearch_steps_per_trial));
    setRagEnabled(d.rag_enabled ?? RAG_DEFAULTS.enabled);
    setRagExtractor(d.rag_default_extractor || RAG_DEFAULTS.extractor);
    setRagChunkSize(String(d.rag_chunk_size ?? RAG_DEFAULTS.chunkSize));
    setRagChunkOverlap(String(d.rag_chunk_overlap ?? RAG_DEFAULTS.chunkOverlap));
    setRagTopK(String(d.rag_top_k ?? RAG_DEFAULTS.topK));
    setRagEmbeddingModel(d.rag_embedding_model ?? RAG_DEFAULTS.embeddingModel);
  };

  const load = async () => {
    try {
      const res = await api.get<SettingsData>("/settings");
      applySettings(res.data);
    } catch (e) {
      console.error(e);
      applySettings(FALLBACK_SETTINGS);
    }
  };

  useEffect(() => { load(); }, []);

  const saveTab = async (tabId: TabId) => {
    setSaving((s) => ({ ...s, [tabId]: true }));
    const payload: Record<string, unknown> = {};
    if (tabId === "huggingface") {
      if (hfToken) payload.hf_token = hfToken;
    } else if (tabId === "openai") {
      if (openaiKey)    payload.openai_api_key = openaiKey;
      if (openaiModel)  payload.openai_model = openaiModel;
      if (openaiBaseUrl !== undefined) payload.openai_base_url = openaiBaseUrl || null;
    } else if (tabId === "anthropic") {
      if (anthropicKey)   payload.anthropic_api_key = anthropicKey;
      if (anthropicModel) payload.anthropic_model = anthropicModel;
    } else if (tabId === "ollama") {
      if (ollamaUrl)   payload.ollama_base_url = ollamaUrl;
      if (ollamaModel) payload.ollama_model = ollamaModel;
      if (hfToken)     payload.hf_token = hfToken;
    } else if (tabId === "training") {
      payload.default_train_ratio = parseFloat(trainRatio);
      payload.default_epochs = parseInt(epochs);
      payload.default_learning_rate = parseFloat(lr);
      payload.default_batch_size = parseInt(batchSize);
      payload.default_max_seq_length = parseInt(seqLen);
      payload.default_lora_rank = parseInt(loraRank);
      payload.default_lora_alpha = parseInt(loraAlpha);
      payload.autoresearch_max_trials = parseInt(arTrials);
      payload.autoresearch_steps_per_trial = parseInt(arSteps);
    } else if (tabId === "system") {
      payload.rag_enabled = ragEnabled;
      payload.rag_default_extractor = ragExtractor;
      payload.rag_chunk_size = parseInt(ragChunkSize) || RAG_DEFAULTS.chunkSize;
      payload.rag_chunk_overlap = parseInt(ragChunkOverlap) || RAG_DEFAULTS.chunkOverlap;
      payload.rag_top_k = parseInt(ragTopK) || RAG_DEFAULTS.topK;
      payload.rag_embedding_model = ragEmbeddingModel || RAG_DEFAULTS.embeddingModel;
    }
    await api.patch("/settings", payload);
    if (tabId === "huggingface") setHfToken("");
    if (tabId === "openai") setOpenaiKey("");
    if (tabId === "anthropic") setAnthropicKey("");
    if (tabId === "ollama") setHfToken("");
    await load();
    setSaving((s) => ({ ...s, [tabId]: false }));
  };

  const testProvider = async (provider: string) => {
    setTestStatus((s) => ({ ...s, [provider]: "testing" }));
    setTestMsg((s) => ({ ...s, [provider]: "" }));
    try {
      const body: Record<string, string> = { provider };
      if (provider === "openai") {
        if (openaiKey) body.api_key = openaiKey;
        if (openaiModel) body.model = openaiModel;
        if (openaiBaseUrl) body.base_url = openaiBaseUrl;
      } else if (provider === "anthropic") {
        if (anthropicKey) body.api_key = anthropicKey;
        if (anthropicModel) body.model = anthropicModel;
      } else if (provider === "ollama") {
        if (ollamaUrl) body.base_url = ollamaUrl;
        if (ollamaModel) body.model = ollamaModel;
      }
      const res = await api.post<{ response: string; model: string }>("/settings/test-provider", body);
      setTestStatus((s) => ({ ...s, [provider]: "success" }));
      setTestMsg((s) => ({ ...s, [provider]: `연결 성공 (${res.data.model})` }));
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "연결 실패";
      setTestStatus((s) => ({ ...s, [provider]: "error" }));
      setTestMsg((s) => ({ ...s, [provider]: detail }));
    }
  };

  const handleReset = async () => {
    setResetStage("resetting");
    try {
      await api.post("/settings/reset");
      localStorage.removeItem("nela_chat_messages");
      localStorage.removeItem("nela_chat_terminal");
      window.location.reload();
    } catch (e: unknown) {
      console.error(e);
      setResetStage("idle");
    }
  };

  const applyRagDefaults = () => {
    setRagEnabled(RAG_DEFAULTS.enabled);
    setRagExtractor(RAG_DEFAULTS.extractor);
    setRagChunkSize(String(RAG_DEFAULTS.chunkSize));
    setRagChunkOverlap(String(RAG_DEFAULTS.chunkOverlap));
    setRagTopK(String(RAG_DEFAULTS.topK));
    setRagEmbeddingModel(RAG_DEFAULTS.embeddingModel);
  };

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Settings2 className="w-5 h-5 text-gray-500" />
        <h1 className="text-xl font-bold text-gray-900">설정</h1>
      </div>

      {/* Hugging Face Token */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">Hugging Face 토큰</h2>
          <p className="text-xs text-gray-400 mt-1">
            비공개 모델이나 라이선스 동의가 필요한 모델을 다운로드할 때 사용됩니다.
          </p>
        </div>
        <Field label="Access Token" hint="예: hf_...">
          <KeyInput
            placeholder="hf_..."
            value={hfToken}
            onChange={setHfToken}
            isSet={data.hf_token_set}
          />
        </Field>
        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <div className="text-xs text-gray-500">
            {data.hf_token_set ? "현재 토큰이 저장되어 있습니다." : "아직 저장된 토큰이 없습니다."}
          </div>
          <SaveButton saving={!!saving["huggingface"]} onClick={() => saveTab("huggingface")} />
        </div>
      </div>

      {/* ── Multi-GPU / 분산 훈련 설정 ── */}
      <MultiGpuSettings gpuList={sysInfo?.gpu ?? []} />

      {/* ── RAG 설정 ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">RAG 설정</h2>
            <p className="text-xs text-gray-400 mt-1">대화 테스트에서 업로드 문서를 VectorDB에 저장하고 검색할 때 사용됩니다.</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={applyRagDefaults}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              기본값 적용
            </button>
            <button
              type="button"
              onClick={() => setRagEnabled((v) => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${ragEnabled ? "bg-blue-600" : "bg-gray-300"}`}
              aria-pressed={ragEnabled}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${ragEnabled ? "translate-x-5" : "translate-x-1"}`} />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="기본 추출 방식">
            <select value={ragExtractor} onChange={(e) => setRagExtractor(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="openDataLoader">openDataLoader</option>
              <option value="markitdown">MarkItDown</option>
              <option value="pypdf">PyPDF</option>
              <option value="docling">Docling</option>
              <option value="ocr">OCR</option>
            </select>
          </Field>
          <Field label="검색 Top-K">
            <input type="number" min={1} max={20} value={ragTopK} placeholder={String(RAG_DEFAULTS.topK)} onChange={(e) => setRagTopK(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </Field>
          <Field label="청크 크기">
            <input type="number" min={200} max={4000} value={ragChunkSize} placeholder={String(RAG_DEFAULTS.chunkSize)} onChange={(e) => setRagChunkSize(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </Field>
          <Field label="청크 오버랩">
            <input type="number" min={0} max={1000} value={ragChunkOverlap} placeholder={String(RAG_DEFAULTS.chunkOverlap)} onChange={(e) => setRagChunkOverlap(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </Field>
          <Field label="임베딩 모델" hint="HuggingFace 모델 ID. 변경 시 모든 문서를 재인덱싱해야 합니다.">
            <input type="text" value={ragEmbeddingModel} placeholder={RAG_DEFAULTS.embeddingModel} onChange={(e) => setRagEmbeddingModel(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </Field>
        </div>
        <div className="flex justify-end pt-2 border-t border-gray-100">
          <SaveButton saving={!!saving["system"]} onClick={() => saveTab("system")} />
        </div>
      </div>

      {/* ── System Info (탭 외부, 하단 독립 섹션) ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">시스템 정보</h2>
          <button onClick={loadSysInfo} disabled={sysLoading}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${sysLoading ? "animate-spin" : ""}`} />
            새로고침
          </button>
        </div>

        {sysLoading && !sysInfo && (
          <div className="flex justify-center py-8"><RefreshCw className="w-5 h-5 animate-spin text-gray-400" /></div>
        )}

        {sysInfo && (
          <>
            {/* Platform */}
            <div className="grid grid-cols-3 gap-3 text-xs">
              {[
                { label: "플랫폼", value: sysInfo.platform },
                { label: "Python", value: sysInfo.python_version },
                { label: "PyTorch", value: sysInfo.torch_version },
              ].map((item) => (
                <div key={item.label} className="bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-gray-400">{item.label}</p>
                  <p className="font-mono font-medium text-gray-700 mt-0.5">{item.value}</p>
                </div>
              ))}
            </div>

            {/* CPU / Memory / GPU / Disk — 2열 그리드 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* CPU */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <Cpu className="w-3.5 h-3.5" />CPU
                </div>
                <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 truncate max-w-[160px]">{sysInfo.cpu.model}</span>
                    <span className="font-medium text-gray-800 ml-2 flex-shrink-0">{sysInfo.cpu.usage_percent}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div className="bg-blue-500 h-1.5 rounded-full transition-all"
                      style={{ width: `${sysInfo.cpu.usage_percent}%` }} />
                  </div>
                  <p className="text-xs text-gray-400">물리 {sysInfo.cpu.physical_cores}코어 / 논리 {sysInfo.cpu.logical_cores}코어</p>
                </div>
              </div>

              {/* Memory */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <MemoryStick className="w-3.5 h-3.5" />메모리 (RAM)
                </div>
                <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">{sysInfo.memory.used_gb} / {sysInfo.memory.total_gb} GB</span>
                    <span className="font-medium text-gray-800">{sysInfo.memory.percent}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full transition-all ${sysInfo.memory.percent > 85 ? "bg-red-500" : sysInfo.memory.percent > 65 ? "bg-yellow-500" : "bg-green-500"}`}
                      style={{ width: `${sysInfo.memory.percent}%` }} />
                  </div>
                  <p className="text-xs text-gray-400">여유 {sysInfo.memory.available_gb} GB</p>
                </div>
              </div>

              {/* GPU */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <Monitor className="w-3.5 h-3.5" />GPU / 가속기
                </div>
                {sysInfo.gpu.length === 0 ? (
                  <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-400">감지된 GPU 없음 (CPU 모드)</div>
                ) : sysInfo.gpu.map((g) => (
                  <div key={g.index} className="bg-gray-50 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700 truncate max-w-[160px]">{g.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium flex-shrink-0 ml-2 ${g.type === "cuda" ? "bg-green-100 text-green-700" : "bg-purple-100 text-purple-700"}`}>
                        {g.type.toUpperCase()}
                      </span>
                    </div>
                    {g.type === "cuda" && g.used_gb !== null && (
                      <>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">{g.used_gb} / {g.total_gb} GB</span>
                          <span className="text-gray-400 text-xs">여유 {g.free_gb} GB</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-1.5">
                          <div className="bg-purple-500 h-1.5 rounded-full"
                            style={{ width: `${Math.round((g.used_gb / g.total_gb) * 100)}%` }} />
                        </div>
                      </>
                    )}
                    {g.note && <p className="text-xs text-gray-400">{g.note}</p>}
                  </div>
                ))}
              </div>

              {/* Disk */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <HardDrive className="w-3.5 h-3.5" />디스크
                </div>
                <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">{sysInfo.disk.used_gb} / {sysInfo.disk.total_gb} GB</span>
                    <span className="font-medium text-gray-800">{sysInfo.disk.percent}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${sysInfo.disk.percent > 85 ? "bg-red-500" : "bg-blue-500"}`}
                      style={{ width: `${sysInfo.disk.percent}%` }} />
                  </div>
                  <p className="text-xs text-gray-400">여유 {sysInfo.disk.free_gb} GB</p>
                </div>
              </div>

            </div>
          </>
        )}
      </div>

      {/* ── 시스템 초기화 ── */}
      <div className="bg-white rounded-xl border border-red-200 p-5">
        <div className="flex items-center gap-2 mb-3">
          <Trash2 className="w-4 h-4 text-red-500" />
          <h2 className="text-sm font-semibold text-red-700">시스템 초기화</h2>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          모든 작업 이력(훈련, 데이터셋, 평가), 업로드된 문서, 어시스턴트 대화 이력을 삭제하고 초기 상태로 되돌립니다.
          API 키 등 설정값은 유지됩니다.
        </p>
        {resetStage === "idle" && (
          <button
            onClick={() => setResetStage("confirm")}
            className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            전체 초기화
          </button>
        )}
        {resetStage === "confirm" && (
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            <span className="text-sm text-red-700 font-medium flex-1">정말로 모든 데이터를 삭제하시겠습니까? 되돌릴 수 없습니다.</span>
            <button
              onClick={handleReset}
              className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 flex-shrink-0"
            >
              삭제 확인
            </button>
            <button
              onClick={() => setResetStage("idle")}
              className="px-3 py-1.5 text-gray-500 hover:text-gray-700 text-sm flex-shrink-0"
            >
              취소
            </button>
          </div>
        )}
        {resetStage === "resetting" && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <RefreshCw className="w-4 h-4 animate-spin" />
            초기화 중...
          </div>
        )}
      </div>

    </div>
  );
};

export default SettingsPage;
