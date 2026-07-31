import React, { useEffect, useState, useCallback } from "react";
import { Save, CheckCircle, AlertCircle, Eye, EyeOff, RefreshCw, Settings2, Cpu, MemoryStick, HardDrive, Monitor, Trash2 } from "lucide-react";
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

type TabId = "huggingface" | "rag" | "system" | "reset";

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

// ─── Main Component ────────────────────────────────────────────────────────────

const SettingsPage: React.FC = () => {
  const [data, setData] = useState<SettingsData | null>(null);
  const [tab, setTab] = useState<TabId>("huggingface");
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [sysLoading, setSysLoading] = useState(false);
  const [resetStage, setResetStage] = useState<"idle" | "confirm" | "resetting">("idle");

  const [hfToken, setHfToken] = useState("");

  const [ragEnabled, setRagEnabled] = useState(true);
  const [ragExtractor, setRagExtractor] = useState("openDataLoader");
  const [ragChunkSize, setRagChunkSize] = useState("");
  const [ragChunkOverlap, setRagChunkOverlap] = useState("");
  const [ragTopK, setRagTopK] = useState("");

  // Save state per tab
  const [saving, setSaving] = useState<Record<string, boolean>>({});

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
    setRagEnabled(d.rag_enabled ?? RAG_DEFAULTS.enabled);
    setRagExtractor(d.rag_default_extractor || RAG_DEFAULTS.extractor);
    setRagChunkSize(String(d.rag_chunk_size ?? RAG_DEFAULTS.chunkSize));
    setRagChunkOverlap(String(d.rag_chunk_overlap ?? RAG_DEFAULTS.chunkOverlap));
    setRagTopK(String(d.rag_top_k ?? RAG_DEFAULTS.topK));
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
    } else if (tabId === "rag") {
      payload.rag_enabled = ragEnabled;
      payload.rag_default_extractor = ragExtractor;
      payload.rag_chunk_size = parseInt(ragChunkSize) || RAG_DEFAULTS.chunkSize;
      payload.rag_chunk_overlap = parseInt(ragChunkOverlap) || RAG_DEFAULTS.chunkOverlap;
      payload.rag_top_k = parseInt(ragTopK) || RAG_DEFAULTS.topK;
    }
    await api.patch("/settings", payload);
    if (tabId === "huggingface") setHfToken("");
    await load();
    setSaving((s) => ({ ...s, [tabId]: false }));
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
  };

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    );
  }

  const TABS: { id: TabId; label: string }[] = [
    { id: "huggingface", label: "Hugging Face" },
    { id: "rag", label: "RAG" },
    { id: "system", label: "시스템 정보" },
    { id: "reset", label: "초기화" },
  ];

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Settings2 className="w-5 h-5 text-gray-500" />
        <h1 className="text-xl font-bold text-gray-900">설정</h1>
      </div>

      {/* Tab bar */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex border-b border-gray-200">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors relative ${
                tab === t.id ? "text-blue-600" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {t.label}
              {tab === t.id && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-t" />
              )}
            </button>
          ))}
        </div>

        <div className="p-5">
          {tab === "huggingface" && (
            <div className="space-y-5">
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
          )}

          {tab === "rag" && (
            <div className="space-y-5">
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
              </div>
              <div className="flex justify-end pt-2 border-t border-gray-100">
                <SaveButton saving={!!saving["rag"]} onClick={() => saveTab("rag")} />
              </div>
            </div>
          )}

          {tab === "system" && (
            <div className="space-y-5">
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
          )}

          {tab === "reset" && (
            <div>
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
          )}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
