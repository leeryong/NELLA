/**
 * API service for communicating with LLMOps backend.
 */
import axios from "axios";
import type { AxiosRequestConfig } from "axios";

const BASE_URL = import.meta.env.VITE_API_URL || "/api";

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 1200000, // 20 minutes for long operations (model eval/training)
});

// Types
export interface Document {
  id: number;
  filename: string;
  original_path: string;
  extracted_path?: string;
  file_type: string;
  file_size: number;
  status: "pending" | "processing" | "completed" | "failed";
  page_count?: number;
  word_count?: number;
  char_count?: number;
  error_message?: string;
  extractor?: string;
  thumbnail_path?: string;
  rag_indexed?: boolean;
  rag_chunk_count?: number;
  rag_indexed_at?: string;
  started_at?: string;
  created_at: string;
  updated_at?: string;
}

export interface Dataset {
  id: number;
  name: string;
  document_id?: number;
  data_type: string;
  train_path?: string;
  test_path?: string;
  train_count: number;
  test_count: number;
  train_ratio: number;
  llm_provider?: string;
  created_at: string;
}

export interface ModelRecord {
  id: number;
  hf_model_id: string;
  name: string;
  description?: string;
  task_type?: string;
  size_category?: string;
  parameter_count?: string;
  download_size_gb?: number;
  supports_vision?: boolean;
  is_downloaded?: boolean;
  local_path?: string;
  created_at: string;
  updated_at?: string;
}

export interface ModelInfo {
  hf_model_id: string;
  name: string;
  description: string;
  task_type?: string;
  size_category: string;
  parameter_count: string;
  download_size_gb?: number;
  supports_vision?: boolean;
  is_downloaded: boolean;
  local_path?: string;
  tags: string[];
  license?: string;
}

export interface TrainingJob {
  id: number;
  name: string;
  dataset_id: number;
  base_model_id: number;
  method: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  config?: Record<string, unknown>;
  output_dir?: string;
  final_loss?: number;
  training_metrics?: TrainingMetric[];
  started_at?: string;
  completed_at?: string;
  error_message?: string;
  created_at: string;
}

export interface TrainingMetric {
  step: number;
  loss?: number;
  eval_loss?: number;
  learning_rate?: number;
  epoch?: number;
}

export interface TrainedModelRecord {
  id: number;
  name: string;
  record_type?: "autoresearch";
  status: "completed" | "cancelled" | "failed";
  method: string;
  config?: Record<string, unknown>;
  output_dir?: string;
  merged_dir?: string;
  final_loss?: number;
  training_metrics?: TrainingMetric[];
  error_message?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  model_size_bytes?: number;
  // AutoResearch 전용
  max_trials?: number;
  steps_per_trial?: number;
  trial_results?: Array<{
    trial_id: number;
    config: Record<string, unknown>;
    final_loss: number;
    eval_loss?: number;
    steps: number;
    duration_seconds: number;
  }>;
  model?: {
    id: number;
    hf_model_id: string;
    name: string;
    parameter_count?: string;
    local_path?: string;
  };
  dataset?: {
    id: number;
    name: string;
    data_type: string;
    train_count: number;
    test_count: number;
    llm_provider?: string;
  };
}

export interface EvaluationResult {
  id: number;
  training_job_id: number;
  model_path: string;
  bleu_score?: number;
  rouge1_score?: number;
  rouge2_score?: number;
  rougeL_score?: number;
  perplexity?: number;
  llm_judge_score?: number;
  sample_count?: number;
  created_at: string;
  status?: string;
  metrics_detail?: { completed?: boolean; error?: string | null; predictions_sample?: unknown[] } | null;
}

export interface ScoutValidationPrediction {
  rank: number;
  candidate_dataset_dir: string;
  model: string;
  predicted_delta: number;
  predicted_delta_std?: number;
  base_judge_score?: number | null;
  estimated_final_score?: number | null;
  tcm_path: string;
}

export interface ScoutValidationResult {
  dataset_id: number;
  dataset_ids?: number[];
  dataset_name: string;
  dataset_names?: string[];
  selection_mode: "final_score" | "improvement";
  judge_provider?: string | null;
  sample_limit: number;
  meta: Record<string, unknown>;
  predictions: ScoutValidationPrediction[];
  artifacts: {
    raw_tcm_dir: string;
    resampled_tcm_dir: string;
    prediction_dir: string;
  };
}

// Documents API
export const documentsApi = {
  upload: (file: File, extractor: string = "openDataLoader", extractImages = false, onUploadProgress?: (pct: number) => void) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post<Document>("/documents/upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
      params: { extractor, extract_images: extractImages },
      onUploadProgress: onUploadProgress
        ? (e) => { onUploadProgress(e.total ? Math.round((e.loaded / e.total) * 100) : 0); }
        : undefined,
    });
  },

  list: (skip = 0, limit = 50) =>
    api.get<Document[]>("/documents/", { params: { skip, limit } }),

  get: (id: number) => api.get<Document>(`/documents/${id}`),

  getText: (id: number, maxChars = 5000) =>
    api.get<{ text: string; total_chars: number; truncated: boolean }>(
      `/documents/${id}/text`,
      { params: { max_chars: maxChars } }
    ),

  delete: (id: number) => api.delete(`/documents/${id}`),

  deleteAll: () => api.delete("/documents/all"),
};

// Training Data API
export const trainingDataApi = {
  generateSFT: (params: {
    document_id: number;
    num_pairs?: number;
    dataset_name?: string;
    train_ratio?: number;
    llm_provider?: string;
    system_prompt?: string;
    user_prompt_template?: string;
  }) => api.post<Dataset>("/training-data/generate/sft", params),

  generateDPO: (params: {
    document_id: number;
    num_pairs?: number;
    dataset_name?: string;
    train_ratio?: number;
    system_prompt?: string;
    user_prompt_template?: string;
  }) => api.post<Dataset>("/training-data/generate/dpo", params),

  generateCoT: (params: {
    document_id: number;
    num_pairs?: number;
    dataset_name?: string;
    train_ratio?: number;
    llm_provider?: string;
    system_prompt?: string;
    user_prompt_template?: string;
  }) => api.post<Dataset>("/training-data/generate/cot", params),

  generateToT: (params: {
    document_id: number;
    num_pairs?: number;
    dataset_name?: string;
    train_ratio?: number;
    llm_provider?: string;
    system_prompt?: string;
    user_prompt_template?: string;
  }) => api.post<Dataset>("/training-data/generate/tot", params),

  generateGoT: (params: {
    document_id: number;
    num_pairs?: number;
    dataset_name?: string;
    train_ratio?: number;
    llm_provider?: string;
    system_prompt?: string;
    user_prompt_template?: string;
  }) => api.post<Dataset>("/training-data/generate/got", params),

  upload: (file: File, datasetName: string, trainRatio = 0.9) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post<Dataset>("/training-data/upload", formData, {
      params: { dataset_name: datasetName, train_ratio: trainRatio },
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  list: () => api.get<Dataset[]>("/training-data/"),

  get: (id: number) => api.get<Dataset>(`/training-data/${id}`),

  cancel: (id: number) => api.post(`/training-data/${id}/cancel`),

  delete: (id: number) => api.delete(`/training-data/${id}`),

  deleteAll: () => api.delete("/training-data/all"),

  activeIds: () => api.get<{ active_ids: number[] }>("/training-data/active-ids"),

  filter: (
    datasetId: number,
    params: {
      min_length?: number;
      max_length?: number;
      filter_duplicates?: boolean;
      filter_low_quality?: boolean;
      new_name?: string;
    },
    config?: AxiosRequestConfig
  ) => api.post<Dataset>(`/training-data/${datasetId}/filter`, params, config),

  cancelValidation: (id: number) => api.post(`/training-data/${id}/cancel-validation`),

  validate: (
    datasetId: number,
    params: {
      provider?: string;
      sample_method?: "all" | "representative";
      sample_count?: number;
      min_score?: number;
      new_name?: string;
      criteria?: Record<string, boolean>;
    },
    config?: AxiosRequestConfig
  ) => api.post(`/training-data/${datasetId}/validate`, params, config),

  preview: (id: number, split: "train" | "test" = "train", numSamples = 5, maxFieldChars = 2000) =>
    api.get<{ samples: unknown[] }>(`/training-data/${id}/preview`, {
      params: { split, num_samples: numSamples, max_field_chars: maxFieldChars },
    }),

  previewBoth: (id: number, numSamples = 10, maxFieldChars = 2000) =>
    api.get<{ samples: unknown[]; train_samples: unknown[]; test_samples: unknown[] }>(
      `/training-data/${id}/preview`,
      { params: { split: "both", num_samples: numSamples, max_field_chars: maxFieldChars } },
    ),
};

export interface HFModelInfo {
  hf_model_id: string;
  name: string;
  description: string;
  task_type?: string;
  size_category: string;
  parameter_count: string;
  download_size_gb?: number;
  supports_vision?: boolean;
  is_downloaded: boolean;
  local_path?: string;
  tags: string[];
  downloads?: number;
  likes?: number;
  last_modified?: string;
}

// Models API
export const modelsApi = {
  listCurated: (params?: {
    size_category?: string;
    task_type?: string;
    search?: string;
  }) => api.get<ModelInfo[]>("/models/curated", { params }),

  trending: (params?: {
    task?: string;
    max_results?: number;
    sort?: "downloads" | "likes" | "lastModified";
    direction?: -1 | 1;
    search?: string;
  }) =>
    api.get<{ results: HFModelInfo[]; count: number }>("/models/trending", {
      params,
    }),

  download: (modelId: string) =>
    api.post<{ status: string; message: string }>("/models/download", {
      model_id: modelId,
    }),

  listDownloaded: () => api.get<ModelRecord[]>("/models/downloaded"),

  deleteModel: (recordId: number, deleteFiles = true) =>
    api.delete<{ status: string; message: string }>(`/models/${recordId}`, {
      params: { delete_files: deleteFiles },
    }),

  search: (query: string, task = "text-generation", maxResults = 20) =>
    api.get<{ results: HFModelInfo[]; count: number }>("/models/search", {
      params: { query, task, max_results: maxResults },
    }),

  downloadStatus: (modelId: string) =>
    api.get<{
      model_id: string;
      status: "idle" | "preparing" | "downloading" | "completed" | "failed" | "cancelled" | "cancelling";
      percent: number;
      downloaded_bytes: number;
      total_bytes: number;
      downloaded_str: string;
      total_str: string | null;
      files_total: number;
      error: string | null;
    }>(`/models/download-status/${encodeURIComponent(modelId)}`),

  activeDownloads: () =>
    api.get<Array<{
      model_id: string;
      status: string;
      percent: number;
      downloaded_bytes: number;
      total_bytes: number;
    }>>(`/models/active-downloads`),

  cancelDownload: (modelId: string) =>
    api.post<{ status: string; message: string }>(
      `/models/cancel-download/${encodeURIComponent(modelId)}`
    ),

  deleteAllDownloaded: (deleteFiles = true) =>
    api.delete<{ status: string; message: string }>("/models/downloaded/all", {
      params: { delete_files: deleteFiles },
    }),
};

// AutoResearch job type
export interface ARJob {
  id: number;
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  max_trials: number;
  steps_per_trial: number;
  best_loss?: number;
  best_config?: Record<string, unknown>;
  trial_results?: Array<{
    trial_id: number;
    config: Record<string, unknown>;
    final_loss: number;
    eval_loss?: number;
    steps: number;
    duration_seconds: number;
    metrics_history: Array<Record<string, unknown>>;
  }>;
  final_training_metrics?: TrainingMetric[];
  created_at: string;
}

// Training API
export const trainingApi = {
  startSFT: (params: {
    name?: string;
    dataset_ids: number[];
    model_id: string;
    method?: string;
    num_train_epochs?: number;
    learning_rate?: number;
    batch_size?: number;
    max_seq_length?: number;
    lora_r?: number;
    lora_alpha?: number;
    max_steps?: number;
  }) => api.post<TrainingJob>("/training/sft", params),

  startDPO: (params: {
    name?: string;
    dataset_ids: number[];
    model_id: string;
    learning_rate?: number;
    num_train_epochs?: number;
    beta?: number;
    max_steps?: number;
  }) => api.post<TrainingJob>("/training/dpo", params),

  startAutoResearch: (params: {
    name?: string;
    dataset_ids: number[];
    model_id: string;
    method?: string;
    max_trials?: number;
    steps_per_trial?: number;
    final_epochs?: number;
  }) => api.post("/training/autoresearch", params),

  listJobs: (skip = 0, limit = 50) =>
    api.get<TrainingJob[]>("/training/jobs", { params: { skip, limit } }),

  getJob: (id: number) => api.get<TrainingJob>(`/training/jobs/${id}`),

  cancelJob: (id: number) =>
    api.post<{ status: string }>(`/training/jobs/${id}/cancel`),

  deleteJob: (id: number) =>
    api.delete<{ status: string; job_id: number }>(`/training/jobs/${id}`),

  deleteAllJobs: () =>
    api.delete<{ status: string; count: number }>("/training/jobs"),

  listARJobs: () => api.get<ARJob[]>("/training/autoresearch-jobs"),

  cancelARJob: (jobId: number) =>
    api.post(`/training/autoresearch-jobs/${jobId}/cancel`),

  deleteARJob: (jobId: number) =>
    api.delete<{ status: string; job_id: number }>(`/training/autoresearch-jobs/${jobId}`),

  deleteAllARJobs: () =>
    api.delete<{ status: string; count: number }>("/training/autoresearch-jobs"),

  listTrainedModels: (minimal = false) =>
    api.get<TrainedModelRecord[]>(`/training/trained-models${minimal ? "?minimal=true" : ""}`),

  downloadModel: (jobId: number) => {
    // 브라우저 네이티브 다운로드 (대용량 파일 스트리밍)
    const url = `${BASE_URL}/training/jobs/${jobId}/download`;
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.click();
  },

  getJobThread: (id: number) =>
    api.get<{ job_id: number; thread_id: number | null; kill_command: string | null }>(
      `/training/jobs/${id}/thread`
    ),

  killJob: (id: number) =>
    api.post<{ status: string; message: string }>(`/training/jobs/${id}/kill`),

  mergeAdapter: (jobId: number) =>
    api.post<{ status: string; message: string }>(`/training/jobs/${jobId}/merge`),

  getMergedDownloadUrl: (jobId: number) =>
    `${BASE_URL}/training/jobs/${jobId}/merged-download`,
};

function _wsHost(): string {
  // 백엔드와 프론트엔드가 다른 호스트일 수도 있음. window 호스트가 :5173 (Vite dev)이면 :8000으로 강제.
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.hostname || "localhost";
  // Vite dev 서버일 때만 :8000으로 보냄. 같은 호스트로 reverse-proxy 중이면 그대로.
  const port = window.location.port === "5173" ? ":8000" : (window.location.port ? `:${window.location.port}` : "");
  return `${proto}//${host}${port}`;
}

export function createARWebSocket(
  jobId: number,
  onMessage: (data: Record<string, unknown>) => void,
  onClose?: () => void,
): WebSocket {
  const wsUrl = `${_wsHost()}/api/training/autoresearch-jobs/${jobId}/ws`;
  // eslint-disable-next-line no-console
  console.info(`[AR WS] connecting jobId=${jobId} → ${wsUrl}`);
  const ws = new WebSocket(wsUrl);
  ws.onopen = () => {
    // eslint-disable-next-line no-console
    console.info(`[AR WS] open jobId=${jobId}`);
  };
  ws.onerror = (ev) => {
    // eslint-disable-next-line no-console
    console.warn(`[AR WS] error jobId=${jobId}`, ev);
  };
  ws.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data)); } catch { /* ignore */ }
  };
  ws.onclose = (ev) => {
    // eslint-disable-next-line no-console
    console.info(`[AR WS] close jobId=${jobId} code=${ev.code}`);
    onClose?.();
  };
  const ping = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send("ping");
    else clearInterval(ping);
  }, 30000);
  return ws;
}

// Evaluation API
export const evaluationApi = {
  run: (params: {
    training_job_id: number;
    use_llm_judge?: boolean;
    sample_limit?: number;
    dataset_id?: number;
  }) => api.post<EvaluationResult>("/evaluation/run", params),

  runAR: (params: {
    autoresearch_job_id: number;
    use_llm_judge?: boolean;
    sample_limit?: number;
    dataset_id?: number;
  }) => api.post<{ eval_id: number; status: string; model_path: string }>(
    "/evaluation/run-ar",
    null,
    { params }
  ),

  list: () => api.get<EvaluationResult[]>("/evaluation/"),

  getJobEvals: (jobId: number) =>
    api.get<EvaluationResult[]>(`/evaluation/job/${jobId}`),

  get: (id: number) => api.get<EvaluationResult>(`/evaluation/${id}`),

  getProgress: (evalId: number) =>
    api.get<{ pct: number; step: string; done: boolean; error?: boolean }>(
      `/evaluation/progress/${evalId}`
    ),

  listActive: () =>
    api.get<Array<{ eval_id: number; pct: number; step: string; done: boolean }>>(
      `/evaluation/active`
    ),

  getReport: (id: number) =>
    api.get<{ report: string; metrics: Record<string, unknown> }>(
      `/evaluation/${id}/report`
    ),

  cancel: (id: number) => api.post(`/evaluation/${id}/cancel`),

  delete: (id: number) => api.delete(`/evaluation/${id}`),
  deleteAll: () => api.delete("/evaluation/"),
};

export const modelValidationApi = {
  runScout: (params: {
    dataset_id?: number;
    dataset_ids?: number[];
    model_ids: string[];
    selection_mode: "final_score" | "improvement";
    judge_provider?: "openai" | "anthropic" | "ollama" | "mock";
    sample_limit?: number;
  }, config?: AxiosRequestConfig) => api.post<ScoutValidationResult>("/model-validation/scout", params, config),
  cancelScout: (dataset_id: number) =>
    api.post<{ status: string; dataset_id: number }>("/model-validation/scout/cancel", { dataset_id }),
};

// ── Benchmark (lm-evaluation-harness) ────────────────────────────────
export interface BenchmarkRunRow {
  id: number;
  group_id: string;
  model_hf_id: string;
  model_name: string;
  tasks: string[];
  results: Record<string, number | null> | null;
  status: "pending" | "running" | "completed" | "failed";
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string | null;
  // Live progress while status === "running": populated from streamed lm_eval output.
  progress_percent?: number | null;
  progress_message?: string | null;
}

export const benchmarkApi = {
  run: (params: {
    model_ids: string[];
    tasks: string[];
    limit?: number;
    batch_size?: string;
  }) => api.post<{
    group_id: string;
    run_ids: number[];
    model_ids: string[];
    tasks: string[];
  }>("/benchmark/run", params),
  cancel: (group_id: string) =>
    api.post<{ status: string; group_id: string }>("/benchmark/cancel", { group_id }),
  list: (limit = 50) =>
    api.get<BenchmarkRunRow[]>(`/benchmark/runs?limit=${limit}`),
};

// Chat API
export const chatApi = {
  complete: (params: {
    model_path: string;
    provider?: string;
    provider_model?: string;
    messages: { role: string; content: string }[];
    max_new_tokens?: number;
    temperature?: number;
    use_rag?: boolean;
    rag_collection_id?: number;        // legacy: single
    rag_collection_ids?: number[];     // multi-select
    rag_document_ids?: number[];
    rag_top_k?: number;
  }) => api.post<{
    response: string;
    sources?: Array<{
      document_id: number;
      filename: string;
      chunk_index: number;
      score: number;
      content: string;
      collection_id?: number;
      collection_name?: string;
    }>;
  }>("/chat/complete", params),

  /** MCP-enabled agent chat — LLM can call system tools to read live state and navigate pages */
  agent: (params: {
    provider: string;
    provider_model?: string;
    messages: { role: string; content: string }[];
    current_page: string;
    max_tokens?: number;
    temperature?: number;
    plan_mode?: boolean;
    step_mode?: boolean;
    persona?: string;
  }, signal?: AbortSignal) => api.post<{
    response: string;
    tools_used: string[];
    tool_call_details: { name: string; args: Record<string, unknown>; result: string }[];
    navigate_to: string | null;
    is_plan: boolean;
    is_step_confirm: boolean;
    suppress_chat_response?: boolean;
    is_training_wait?: boolean;
    training_wait_job_id?: number | null;
    training_wait_tool?: string | null;
    is_download_wait?: boolean;
    download_wait_model_ids?: string[];
  }>("/chat/agent", params, { signal }),

  stopAgent: () => api.post<{ status: string; cancelled?: Record<string, unknown[]> }>("/chat/agent/stop"),

  getLoadedModels: () => api.get<{ loaded_models: string[] }>("/chat/loaded"),

  loadModel: (modelPath: string) =>
    api.post("/chat/load", null, { params: { model_path: modelPath } }),

  unloadModel: (modelPath: string) =>
    api.post("/chat/unload", null, { params: { model_path: modelPath } }),
};

// Status API
export interface RagCollectionDoc {
  document_id: number;
  filename: string;
  chunk_count: number;
  indexed_at: string | null;
}

export type RagCollectionStatus = "idle" | "pending" | "indexing" | "completed" | "failed";

export interface RagCollection {
  id: number;
  name: string;
  description: string;
  chroma_name: string;
  chunk_count: number;
  embedding_model: string | null;
  document_count: number;
  documents: RagCollectionDoc[];
  status: RagCollectionStatus;
  progress_stage: string | null;
  progress_current: number;
  progress_total: number;
  created_at: string;
  updated_at: string;
}

export const ragDbApi = {
  list: () => api.get<RagCollection[]>("/rag-db"),
  get: (id: number) => api.get<RagCollection>(`/rag-db/${id}`),
  create: (params: { name: string; description: string; document_ids: number[] }) =>
    api.post<RagCollection>("/rag-db", params),
  update: (id: number, params: { name?: string; description?: string; document_ids?: number[] }) =>
    api.patch<RagCollection>(`/rag-db/${id}`, params),
  reindex: (id: number) => api.post<RagCollection>(`/rag-db/${id}/reindex`),
  delete: (id: number) => api.delete(`/rag-db/${id}`),
  download: (id: number) => {
    // 브라우저 네이티브 다운로드 (대용량 zip 스트리밍)
    const url = `${BASE_URL}/rag-db/${id}/download`;
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.click();
  },
};

export const settingsApi = {
  get: () => api.get("/settings"),
  update: (data: Record<string, unknown>) => api.patch("/settings", data),
  testLLM: () => api.post("/settings/test-llm"),
  testProvider: (provider: string, apiKey?: string, model?: string, baseUrl?: string) =>
    api.post("/settings/test-provider", { provider, api_key: apiKey, model, base_url: baseUrl }),
  getOllamaModels: (baseUrl?: string) =>
    api.get<{ status: string; models: string[]; base_url: string }>("/settings/ollama-models", {
      params: baseUrl ? { base_url: baseUrl } : {},
    }),
  // Live model list from the provider. Always 200 — falls back to a curated
  // list (source: "fallback") with `detail` explaining why, rather than erroring.
  getProviderModels: (provider: string, apiKey?: string) =>
    api.get<{
      status: string;
      provider: string;
      models: string[];
      source: "live" | "fallback";
      detail?: string;
    }>("/settings/provider-models", {
      params: { provider, ...(apiKey ? { api_key: apiKey } : {}) },
    }),

};

export const statusApi = {
  get: () =>
    api.get<{
      llm_provider: string;
      llm_model: string;
      has_openai_key: boolean;
      has_anthropic_key: boolean;
      has_hf_token: boolean;
      downloaded_models: number;
    }>("/status"),
};

// Agent chat message persistence API
export const agentMessagesApi = {
  get: (sessionId = "default") =>
    api.get<{ id: number; session_id: string; role: string; content: string; metadata: Record<string, unknown> | null; created_at: string }[]>(
      `/agent-messages/${sessionId}`
    ),
  add: (msg: { session_id?: string; role: string; content: string; metadata?: Record<string, unknown> | null }) =>
    api.post(`/agent-messages`, msg),
  addBulk: (msgs: { session_id?: string; role: string; content: string; metadata?: Record<string, unknown> | null }[]) =>
    api.post(`/agent-messages/bulk`, msgs),
  update: (msgId: number, content: string) =>
    api.patch<{ id: number }>(`/agent-messages/${msgId}`, { content }),
  clear: (sessionId = "default") =>
    api.delete(`/agent-messages/${sessionId}`),
};

// WebSocket helper
export function createTrainingWebSocket(
  jobId: number,
  onMessage: (data: TrainingMetric) => void,
  onError?: (error: Event) => void
): WebSocket {
  const wsUrl = `${_wsHost()}/api/training/jobs/${jobId}/ws`;
  // eslint-disable-next-line no-console
  console.info(`[Training WS] connecting jobId=${jobId} → ${wsUrl}`);
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    // eslint-disable-next-line no-console
    console.info(`[Training WS] open jobId=${jobId}`);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch (e) {
      console.error("WS message parse error:", e);
    }
  };

  ws.onerror = onError || ((e) => console.error("WS error:", e));

  ws.onclose = (ev) => {
    // eslint-disable-next-line no-console
    console.info(`[Training WS] close jobId=${jobId} code=${ev.code}`);
  };

  // Keep alive ping
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send("ping");
    } else {
      clearInterval(pingInterval);
    }
  }, 30000);

  return ws;
}
