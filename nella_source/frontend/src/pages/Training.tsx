import React, { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useAgentPolling } from "../hooks/useAgentPolling";
import { useAgentToolResult } from "../hooks/useAgentToolResult";
import type { AgentToolResultDetail } from "../hooks/useAgentToolResult";

const OWNED_PATH = "/training";
import { Play, RefreshCw, X, Copy, Check, Terminal, ChevronDown, ChevronUp, ExternalLink, Wand2, Trash2, StopCircle } from "lucide-react";
import { trainingApi, trainingDataApi, modelsApi, settingsApi, TrainingJob, Dataset, ModelRecord, ARJob } from "../services/api";
import { api } from "../services/api";
import TrainingMonitor from "../components/TrainingMonitor";
import AutoResearchMonitor from "../components/AutoResearchMonitor";
import MetricsChart from "../components/MetricsChart";
import { formatDate, statusColor } from "../lib/utils";
import PageHelp from "../components/PageHelp";
import { emitPipelineEvent } from "../pipelineEvent";

// ── 모델 크기 파싱 (소팅용) ──────────────────────────
function parseParamGB(m: ModelRecord): number {
  if (m.download_size_gb != null) return m.download_size_gb;
  const s = m.parameter_count ?? "";
  const n = parseFloat(s);
  if (isNaN(n)) return Infinity;
  if (s.toLowerCase().endsWith("m")) return n / 1000;
  return n; // B 단위
}

// ── 도구 정의 ─────────────────────────────────────────
const TOOLS = [
  { id: "trl",      name: "TRL",     badge: "추천", badgeCls: "bg-blue-100 text-blue-700",   activeCls: "bg-blue-600 text-white border-blue-600", link: "https://huggingface.co/docs/trl" },
  { id: "axolotl",  name: "Axolotl", badge: "고급", badgeCls: "bg-purple-100 text-purple-700", activeCls: "bg-purple-600 text-white border-purple-600", link: "https://axolotl.ai/" },
  { id: "unsloth",  name: "Unsloth", badge: "고속", badgeCls: "bg-orange-100 text-orange-700", activeCls: "bg-orange-500 text-white border-orange-500", link: "https://github.com/unslothai/unsloth" },
];

const TOOL_DESC: Record<string, string> = {
  trl: "Hugging Face 공식 라이브러리. SFT·DPO·PPO 지원.",
  axolotl: "YAML 기반 고급 프레임워크. Flash Attention 지원.",
  unsloth: "2× 빠른 훈련, 60% 메모리 절감. QLoRA 최적화.",
};

// SFT 계열(QA/CoT/ToT/GoT)은 동일한 SFTTrainer 학습 경로를 공유한다 — DPO만 별도.
const SFT_FAMILY = new Set(["sft", "sft_alpaca", "cot", "tot", "got"]);
const isSftFamily = (t: string | undefined | null) => !!t && SFT_FAMILY.has(t);

const DT_LABEL: Record<string, string> = {
  sft: "QA", sft_alpaca: "QA", qa: "QA",
  cot: "CoT", tot: "ToT", got: "GoT", dpo: "DPO",
};
const dtLabel = (t: string) => DT_LABEL[t] ?? t.toUpperCase();

const AGENT_PAGE_START_EVENT = "nella-agent-page-start";
const SS_AGENT_ACTIVE_PAGE = "nella.agent.activePage";

interface AgentTrainingParams {
  toolName: "start_training_job" | "start_autoresearch";
  jobId?: number;
  jobName?: string;
  datasetIds: string[];
  modelId?: string;
  mode: "manual" | "autoresearch";
  method?: "full" | "lora" | "qlora";
  numTrainEpochs?: number;
  learningRate?: number;
  batchSize?: number;
  maxSeqLength?: number;
  loraR?: number;
  loraAlpha?: number;
  maxSteps?: number;
  maxTrials?: number;
  stepsPerTrial?: number;
  ts: number;
}

function asNumber(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asStringIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  const n = asNumber(value);
  return n != null ? [String(n)] : [];
}

function buildAgentTrainingParams(detail: AgentToolResultDetail): AgentTrainingParams | null {
  if (detail.name !== "start_training_job" && detail.name !== "start_autoresearch") return null;
  const args = detail.args ?? {};
  const result = detail.result ?? {};
  const ui = typeof result.ui_params === "object" && result.ui_params !== null
    ? result.ui_params as Record<string, unknown>
    : {};
  const config = typeof result.config === "object" && result.config !== null
    ? result.config as Record<string, unknown>
    : {};

  const datasetIds = asStringIds(ui.dataset_ids).length > 0 ? asStringIds(ui.dataset_ids)
    : asStringIds(result.dataset_ids).length > 0 ? asStringIds(result.dataset_ids)
    : asStringIds(args.dataset_ids).length > 0 ? asStringIds(args.dataset_ids)
    : asStringIds(ui.dataset_id).length > 0 ? asStringIds(ui.dataset_id)
    : asStringIds(result.dataset_id).length > 0 ? asStringIds(result.dataset_id)
    : asStringIds(args.dataset_id);
  const modelId = asString(ui.model_id) ?? asString(result.model_hf_id) ?? asString(result.model) ?? asString(args.model_hf_id) ?? asString(args.model_id);
  const rawMethod = asString(ui.method) ?? asString(result.method) ?? asString(config.method) ?? asString(args.method) ?? "lora";
  const method = rawMethod === "full" || rawMethod === "qlora" ? rawMethod : "lora";

  return {
    toolName: detail.name,
    jobId: asNumber(result.job_id),
    jobName: asString(result.job_name) ?? asString(ui.name) ?? asString(args.job_name),
    datasetIds,
    modelId,
    mode: detail.name === "start_autoresearch" ? "autoresearch" : "manual",
    method,
    numTrainEpochs: asNumber(ui.num_train_epochs) ?? asNumber(ui.final_epochs) ?? asNumber(config.num_train_epochs) ?? asNumber(config.epochs) ?? asNumber(args.epochs) ?? asNumber(result.final_epochs),
    learningRate: asNumber(ui.learning_rate) ?? asNumber(config.learning_rate) ?? asNumber(args.learning_rate),
    batchSize: asNumber(ui.batch_size) ?? asNumber(config.batch_size) ?? asNumber(args.batch_size),
    maxSeqLength: asNumber(ui.max_seq_length) ?? asNumber(config.max_seq_length) ?? asNumber(args.max_seq_length),
    loraR: asNumber(ui.lora_r) ?? asNumber(config.lora_r) ?? asNumber(args.lora_r),
    loraAlpha: asNumber(ui.lora_alpha) ?? asNumber(config.lora_alpha) ?? asNumber(args.lora_alpha),
    maxSteps: asNumber(ui.max_steps) ?? asNumber(config.max_steps) ?? asNumber(args.max_steps),
    maxTrials: asNumber(ui.max_trials) ?? asNumber(result.max_trials) ?? asNumber(args.max_trials),
    stepsPerTrial: asNumber(ui.steps_per_trial) ?? asNumber(result.steps_per_trial) ?? asNumber(args.steps_per_trial),
    ts: Date.now(),
  };
}

// ── 작업명 자동 생성 ──────────────────────────────────
function generateName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `Training_Job_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// ── 명령어 생성 ───────────────────────────────────────
interface FormState {
  name: string;
  dataset_ids: string[];  // multiple datasets
  model_id: string;
  mode: "manual" | "autoresearch";   // top-level mode
  training_type: string;             // sft | dpo (manual only)
  method: string;                    // lora | qlora | full
  num_train_epochs: number;
  learning_rate: number;
  batch_size: number;
  max_seq_length: number;
  lora_r: number;
  lora_alpha: number;
  max_steps: number;
  max_trials: number;
  steps_per_trial: number;
}

function buildCommand(tool: string, form: FormState, modelId: string, datasetPath: string): string {
  const outDir = "./data/models/trained_output";

  // ── AutoResearch (모든 도구 공통) ──
  if (form.mode === "autoresearch") {
    return [
      `# AutoResearch — ${TOOLS.find((t) => t.id === tool)?.name} 기반`,
      `# ${form.max_trials}회 시도 × ${form.steps_per_trial}스텝/시도`,
      `python -c "`,
      `import asyncio`,
      `from backend.agents.training_agent import training_agent`,
      `asyncio.run(training_agent.run_auto_research(`,
      `    tool='${tool}',`,
      `    model_id='${modelId}',`,
      `    dataset_path='${datasetPath}',`,
      `    max_trials=${form.max_trials},`,
      `    steps_per_trial=${form.steps_per_trial},`,
      `))"`,
    ].join("\n");
  }

  // ── Manual: TRL ──
  if (tool === "trl") {
    if (form.training_type === "dpo") {
      return [
        `python -m trl dpo \\`,
        `  --model_name_or_path "${modelId}" \\`,
        `  --dataset_name "${datasetPath}" \\`,
        `  --output_dir "${outDir}" \\`,
        `  --num_train_epochs ${form.num_train_epochs} \\`,
        `  --learning_rate ${form.learning_rate} \\`,
        `  --per_device_train_batch_size ${form.batch_size}`,
      ].join("\n");
    }
    const lines = [
      `python -m trl sft \\`,
      `  --model_name_or_path "${modelId}" \\`,
      `  --dataset_name "${datasetPath}" \\`,
      `  --output_dir "${outDir}" \\`,
      `  --num_train_epochs ${form.num_train_epochs} \\`,
      `  --learning_rate ${form.learning_rate} \\`,
      `  --per_device_train_batch_size ${form.batch_size} \\`,
      `  --max_seq_length ${form.max_seq_length}`,
    ];
    if (form.method === "qlora") {
      lines[lines.length - 1] += " \\";
      lines.push(`  --load_in_4bit \\`, `  --use_peft \\`, `  --lora_r ${form.lora_r} \\`, `  --lora_alpha ${form.lora_alpha}`);
    } else if (form.method === "lora") {
      lines[lines.length - 1] += " \\";
      lines.push(`  --use_peft \\`, `  --lora_r ${form.lora_r} \\`, `  --lora_alpha ${form.lora_alpha}`);
    }
    if (form.max_steps > 0) { lines[lines.length - 1] += " \\"; lines.push(`  --max_steps ${form.max_steps}`); }
    return lines.join("\n");
  }

  // ── Manual: Unsloth ──
  if (tool === "unsloth") {
    const load4bit = form.method !== "full";
    const loraBlock = form.method !== "full"
      ? [`model = FastLanguageModel.get_peft_model(`, `    model, r=${form.lora_r}, lora_alpha=${form.lora_alpha},`,
         `    lora_dropout=0.05, target_modules=["q_proj","k_proj","v_proj","o_proj"],`, `)`].join("\n")
      : "# Full fine-tuning — no adapter";
    return [
      `from unsloth import FastLanguageModel`,
      `from datasets import load_dataset`,
      `from trl import SFTTrainer, SFTConfig`,
      ``,
      `model, tokenizer = FastLanguageModel.from_pretrained(`,
      `    model_name="${modelId}", max_seq_length=${form.max_seq_length}, load_in_4bit=${load4bit ? "True" : "False"},`,
      `)`,
      ``,
      loraBlock,
      ``,
      `dataset = load_dataset("json", data_files="${datasetPath}", split="train")`,
      `trainer = SFTTrainer(model=model, tokenizer=tokenizer, train_dataset=dataset,`,
      `    args=SFTConfig(output_dir="${outDir}", num_train_epochs=${form.num_train_epochs},`,
      `        learning_rate=${form.learning_rate}, per_device_train_batch_size=${form.batch_size},`,
      form.max_steps > 0 ? `        max_steps=${form.max_steps},` : "",
      `    ),`,
      `)`,
      `trainer.train()`,
      `model.save_pretrained("${outDir}")`,
    ].filter(Boolean).join("\n");
  }

  // ── Manual: Axolotl YAML ──
  const adapterYaml = form.method !== "full"
    ? [`adapter: ${form.method === "qlora" ? "qlora" : "lora"}`, `lora_r: ${form.lora_r}`,
       `lora_alpha: ${form.lora_alpha}`, `lora_dropout: 0.05`,
       form.method === "qlora" ? `load_in_4bit: true` : ""].filter(Boolean).join("\n")
    : "";
  const yaml = [
    `base_model: ${modelId}`,
    `model_type: AutoModelForCausalLM`,
    `tokenizer_type: AutoTokenizer`,
    ``,
    `datasets:`,
    `  - path: ${datasetPath}`,
    `    type: alpaca`,
    ``,
    `output_dir: ${outDir}`,
    ``,
    adapterYaml,
    adapterYaml ? "" : null,
    `sequence_len: ${form.max_seq_length}`,
    `micro_batch_size: ${form.batch_size}`,
    `num_epochs: ${form.num_train_epochs}`,
    `learning_rate: ${form.learning_rate}`,
    form.max_steps > 0 ? `max_steps: ${form.max_steps}` : null,
  ].filter((l) => l !== null).join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  return `# 1) config.yaml 저장:\n\n${yaml}\n\n# 2) 훈련 시작:\naccelerate launch -m axolotl.cli.train config.yaml`;
}

// ── 이력 상세: 잡 config → 명령어 재구성 ──────────────
function buildCommandFromJobConfig(job: TrainingJob, modelsList: ModelRecord[]): string {
  const cfg = job.config ?? {};
  const model = modelsList.find((m) => m.id === job.base_model_id);
  const mid = model?.hf_model_id ?? "<model>";
  const method = job.method ?? "lora";
  const outDir = job.output_dir ?? "./data/models/trained_output";
  const lines: string[] = [
    `python -m trl sft \\`,
    `  --model_name_or_path "${mid}" \\`,
    `  --output_dir "${outDir}" \\`,
  ];
  if (cfg.num_train_epochs != null) lines.push(`  --num_train_epochs ${cfg.num_train_epochs} \\`);
  if (cfg.learning_rate != null) lines.push(`  --learning_rate ${cfg.learning_rate} \\`);
  if (cfg.batch_size != null) lines.push(`  --per_device_train_batch_size ${cfg.batch_size} \\`);
  if (cfg.max_seq_length != null) lines.push(`  --max_seq_length ${cfg.max_seq_length} \\`);
  if (method === "lora" || method === "qlora") {
    if (method === "qlora") lines.push(`  --load_in_4bit \\`);
    lines.push(`  --use_peft \\`);
    if (cfg.lora_r != null) lines.push(`  --lora_r ${cfg.lora_r} \\`);
    if (cfg.lora_alpha != null) lines.push(`  --lora_alpha ${cfg.lora_alpha} \\`);
  }
  if (cfg.max_steps != null && Number(cfg.max_steps) > 0) lines.push(`  --max_steps ${cfg.max_steps} \\`);
  const last = lines[lines.length - 1];
  if (last.endsWith(" \\")) lines[lines.length - 1] = last.slice(0, -2);
  return lines.join("\n");
}

// ── 복사 버튼 ─────────────────────────────────────────
const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const go = () => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); };
  return (
    <button onClick={go} className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition-colors">
      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
      {copied ? "복사됨" : "복사"}
    </button>
  );
};

// ── 파라미터 입력 ─────────────────────────────────────
const P: React.FC<{ label: string; value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void }> =
  ({ label, value, min, max, step, onChange }) => {
    const [display, setDisplay] = React.useState(String(value));
    React.useEffect(() => { setDisplay(String(value)); }, [value]);
    const isDecimal = step !== undefined && step < 1;
    return (
      <div>
        <label className="text-xs font-medium text-gray-500">{label}</label>
        <input
          type="text"
          inputMode={isDecimal ? "decimal" : "numeric"}
          value={display}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "" || /^-?\d*\.?\d*$/.test(v)) setDisplay(v);
          }}
          onBlur={() => {
            const num = parseFloat(display);
            let clamped = isNaN(num) ? (min ?? 0) : num;
            if (min !== undefined) clamped = Math.max(min, clamped);
            if (max !== undefined) clamped = Math.min(max, clamped);
            onChange(clamped);
            setDisplay(String(clamped));
          }}
          className="w-full mt-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-400 focus:outline-none"
        />
      </div>
    );
  };

// ── 섹션 레이블 ───────────────────────────────────────
const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{children}</p>
);

// ── 메인 ─────────────────────────────────────────────
const Training: React.FC = () => {
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [arJobs, setArJobs] = useState<ARJob[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [selectedJob, setSelectedJob] = useState<TrainingJob | null>(null);
  const [selectedArJob, setSelectedArJob] = useState<ARJob | null>(null);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [tool, setTool] = useState("trl");
  const [showCmd, setShowCmd] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentPreparing, setAgentPreparing] = useState(false);
  const [agentParams, setAgentParams] = useState<AgentTrainingParams | null>(null);
  const [confirmDeleteAllJobs, setConfirmDeleteAllJobs] = useState(false);
  const autoSelectedModel = useRef(false);
  // load() 폴링에서 "새 훈련"을 감지하는 기준 — 마지막으로 본 running 잡 id.
  // 새 id의 running 잡이 등장하면 자동으로 monitor를 그쪽으로 전환한다.
  const lastSeenRunningJobIdRef = useRef<number | null>(null);
  const lastSeenRunningArJobIdRef = useRef<number | null>(null);

  const [form, setForm] = useState<FormState>({
    name: generateName(),
    dataset_ids: [], model_id: "", mode: "autoresearch", training_type: "sft", method: "lora",
    num_train_epochs: 3, learning_rate: 0.0002, batch_size: 4, max_seq_length: 2048,
    lora_r: 16, lora_alpha: 32, max_steps: 100, max_trials: 7, steps_per_trial: 50,
  });
  const f = (v: Partial<FormState>) => setForm((p) => ({ ...p, ...v }));
  const [maxTrialsStr, setMaxTrialsStr] = useState(String(form.max_trials));
  const [stepsStr, setStepsStr] = useState(String(form.steps_per_trial));

  const load = useCallback(async () => {
    const [j, arJ, ds, ms] = await Promise.all([
      trainingApi.listJobs(),
      trainingApi.listARJobs(),
      trainingDataApi.list(),
      modelsApi.listDownloaded(),
    ]);
    const jobs = j.data ?? [];
    const arJobs = arJ.data ?? [];
    const datasets = ds.data ?? [];
    const models = ms.data ?? [];
    setJobs(jobs);
    setArJobs(arJobs);
    setDatasets(datasets);
    setModels(models);
    // Auto-show monitor for the LATEST running SFT/DPO job.
    // 사용자가 과거 잡을 클릭해 보고 있어도, "새 훈련"(이전에 못 본 running 잡)이 등장하면 자동으로 그것으로 전환.
    // 이미 그 running 잡을 보고 있었거나, 사용자가 명시적으로 다른 과거 잡으로 전환했으면 그 선택 유지.
    setSelectedJob((prev) => {
      const running = jobs.find((jj: TrainingJob) => jj.status === "running" || jj.status === "pending");
      if (running) {
        const latestSeen = lastSeenRunningJobIdRef.current;
        if (latestSeen !== running.id) {
          lastSeenRunningJobIdRef.current = running.id;
          return running;  // 새 훈련 등장 → 자동 전환
        }
        // prev가 null이면 running으로 복원 (사용자가 닫았어도 다시 노출)
        if (!prev) return running;
      }
      if (prev) return jobs.find((jj: TrainingJob) => jj.id === prev.id) ?? prev;
      return running ?? prev;
    });
    // Auto-show monitor for the LATEST running AutoResearch job — same logic.
    // 아무 것도 선택돼 있지 않고 실행 중인 잡이 있으면 무조건 그걸 표시한다.
    // (에이전트 도구 이벤트를 놓친 케이스에서도 폴링이 반드시 상황을 잡아냄)
    setSelectedArJob((prev) => {
      const running = arJobs.find((j: ARJob) => j.status === "running" || j.status === "pending");
      if (running) {
        const latestSeen = lastSeenRunningArJobIdRef.current;
        if (latestSeen !== running.id) {
          lastSeenRunningArJobIdRef.current = running.id;
          return running;  // 새 AR 훈련 등장 → 자동 전환
        }
        // prev가 null(=사용자가 닫았거나 아직 뭐 선택 안 함)이면 running으로 복원
        if (!prev) return running;
      }
      if (prev) return arJobs.find((j: ARJob) => j.id === prev.id) ?? prev;
      return running ?? prev;
    });
    // 작업명 중복이면 현재 시각으로 갱신
    const allNames = new Set([...jobs, ...arJobs].map((j) => j.name));
    setForm((prev) => {
      const nameConflict = allNames.has(prev.name);
      const reqType = (prev.training_type === "dpo" && prev.mode !== "autoresearch") ? "dpo" : "sft";
      const first = datasets.find((d: Dataset) => reqType === "sft" ? isSftFamily(d.data_type) : d.data_type === reqType);
      return {
        ...prev,
        name: nameConflict ? generateName() : prev.name,
        dataset_ids: prev.dataset_ids.length > 0 ? prev.dataset_ids : (first ? [String(first.id)] : prev.dataset_ids),
      };
    });
  }, []);

  const isActive = useLocation().pathname === OWNED_PATH;
  useAgentPolling(load, { idle: 10_000, active: 2_000, enabled: isActive });
  useAgentToolResult(
    [
      "start_training_job", "get_training_job_status", "wait_for_training_job",
      "cancel_training_job",
      "start_autoresearch", "get_autoresearch_job_status",
      "wait_for_autoresearch", "cancel_autoresearch",
    ],
    (detail) => {
      const params = buildAgentTrainingParams(detail);
      if (params) {
        setAgentPreparing(false);
        setAgentParams(params);
        setForm((prev) => ({
          ...prev,
          name: params.jobName ?? prev.name,
          dataset_ids: params.datasetIds.length > 0 ? params.datasetIds : prev.dataset_ids,
          model_id: params.modelId ?? prev.model_id,
          mode: params.mode,
          training_type: "sft",
          method: params.method ?? prev.method,
          num_train_epochs: params.numTrainEpochs ?? prev.num_train_epochs,
          learning_rate: params.learningRate ?? prev.learning_rate,
          batch_size: params.batchSize ?? prev.batch_size,
          max_seq_length: params.maxSeqLength ?? prev.max_seq_length,
          lora_r: params.loraR ?? prev.lora_r,
          lora_alpha: params.loraAlpha ?? prev.lora_alpha,
          max_steps: params.maxSteps ?? prev.max_steps,
          max_trials: params.maxTrials ?? prev.max_trials,
          steps_per_trial: params.stepsPerTrial ?? prev.steps_per_trial,
        }));
        if (params.maxTrials != null) setMaxTrialsStr(String(params.maxTrials));
        if (params.stepsPerTrial != null) setStepsStr(String(params.stepsPerTrial));

        // NELLA가 start_autoresearch/start_training_job을 호출한 직후 모니터를 즉시 열어 WS 로그가 보이게 한다.
        if (params.jobId && detail.name === "start_autoresearch") {
          lastSeenRunningArJobIdRef.current = params.jobId;
          setSelectedArJob((prev) => prev?.id === params.jobId ? prev : ({
            id: params.jobId!,
            name: params.jobName || `AutoResearch #${params.jobId}`,
            status: "running",
            max_trials: params.maxTrials ?? 5,
            steps_per_trial: params.stepsPerTrial ?? 50,
            created_at: new Date().toISOString(),
          } as ARJob));
          setSelectedJob(null);
        } else if (params.jobId && detail.name === "start_training_job") {
          lastSeenRunningJobIdRef.current = params.jobId;
          setSelectedJob((prev) => prev?.id === params.jobId ? prev : ({
            id: params.jobId!,
            name: params.jobName || `Training #${params.jobId}`,
            dataset_id: Number(params.datasetIds[0] ?? 0),
            base_model_id: 0,
            method: params.method ?? "lora",
            status: "running",
            created_at: new Date().toISOString(),
          } as TrainingJob));
          setSelectedArJob(null);
        }
      }
      void load();
    },
    isActive,
  );

  useEffect(() => {
    if (!isActive) return;
    const maybeStart = (detail: unknown) => {
      const page = typeof detail === "object" && detail !== null ? (detail as { page?: unknown }).page : undefined;
      if (page === OWNED_PATH) setAgentPreparing(true);
    };
    const onPageStart = (event: Event) => maybeStart((event as CustomEvent).detail);
    window.addEventListener(AGENT_PAGE_START_EVENT, onPageStart);
    try {
      const stored = window.sessionStorage.getItem(SS_AGENT_ACTIVE_PAGE);
      if (stored) maybeStart(JSON.parse(stored));
    } catch {
      /* ignore */
    }
    return () => window.removeEventListener(AGENT_PAGE_START_EVENT, onPageStart);
  }, [isActive]);

  const handleToolChange = async (t: string) => {
    setTool(t);
    try { await api.patch("/settings", { finetuning_tool: t }); } catch { /* ignore */ }
  };

  useEffect(() => {
    settingsApi.get().then((r) => setTool(r.data.finetuning_tool || "trl")).catch(() => {});
  }, []);

  const selectedDatasets = datasets.filter((d) => form.dataset_ids.includes(String(d.id)));
  const selectedDataset = selectedDatasets[0] ?? null;
  const datasetPath = selectedDatasets.length > 0 ? selectedDatasets.map((d) => `./data/training_data/${d.name}`).join(", ") : "<dataset>";

  // 크기순 정렬 (작은 것 먼저)
  const sortedModels = useMemo(
    () => [...models].sort((a, b) => parseParamGB(a) - parseParamGB(b)),
    [models]
  );

  const selectedModel = models.find((m) => m.hf_model_id === form.model_id);
  const modelId = form.model_id || "<model_id>";

  // 베이스 모델 자동선택: 마지막 사용 모델 → 없으면 제일 작은 모델
  useEffect(() => {
    if (autoSelectedModel.current || sortedModels.length === 0) return;
    if (form.model_id) {
      autoSelectedModel.current = true;
      return;
    }
    const lastJob = jobs.find((j) => j.base_model_id);
    if (lastJob) {
      const lastModel = models.find((m) => m.id === lastJob.base_model_id);
      if (lastModel) {
        f({ model_id: lastModel.hf_model_id });
        autoSelectedModel.current = true;
        return;
      }
    }
    f({ model_id: sortedModels[0].hf_model_id });
    autoSelectedModel.current = true;
  }, [sortedModels, jobs, form.model_id]);

  const generatedCmd = useMemo(
    () => buildCommand(tool, form, modelId, datasetPath),
    [tool, form, modelId, datasetPath]
  );

  const handleStart = async () => {
    if (form.dataset_ids.length === 0 || !form.model_id) return;
    setStarting(true); setError(null);
    const modeLabel = form.mode === "autoresearch" ? "AutoResearch" : form.training_type === "dpo" ? "DPO" : `SFT (${form.method})`;
    emitPipelineEvent({ kind: "start", label: "🚀 훈련 시작", detail: `${modeLabel} — ${form.name || "새 작업"}` });
    const dsIds = form.dataset_ids.map(Number);
    try {
      if (form.mode === "autoresearch") {
        try { await trainingApi.deleteAllARJobs(); } catch { /* ignore */ }
        setSelectedArJob(null);
        setExpandedHistoryId(null);
        const res = await trainingApi.startAutoResearch({
          name: form.name || generateName(),
          dataset_ids: dsIds, model_id: form.model_id,
          method: form.method, max_trials: form.max_trials, steps_per_trial: form.steps_per_trial,
          final_epochs: form.num_train_epochs,
        });
        await load();
        const newJobId = (res.data as { job_id: number }).job_id;
        if (newJobId) {
          setSelectedArJob({ id: newJobId, name: (res.data as { name: string }).name || "AutoResearch",
            status: "running", max_trials: form.max_trials, steps_per_trial: form.steps_per_trial,
            created_at: new Date().toISOString() });
          setSelectedJob(null);
        }
        return;
      } else if (form.training_type === "dpo") {
        const res = await trainingApi.startDPO({
          name: form.name || generateName(),
          dataset_ids: dsIds, model_id: form.model_id,
          learning_rate: form.learning_rate, num_train_epochs: form.num_train_epochs,
        });
        await load();
        setSelectedJob(res.data);
        setSelectedArJob(null);
      } else {
        const res = await trainingApi.startSFT({
          name: form.name || generateName(),
          dataset_ids: dsIds, model_id: form.model_id,
          method: form.method, num_train_epochs: form.num_train_epochs,
          learning_rate: form.learning_rate, batch_size: form.batch_size,
          max_seq_length: form.max_seq_length, lora_r: form.lora_r,
          lora_alpha: form.lora_alpha, max_steps: form.max_steps,
        });
        await load();
        setSelectedJob(res.data);
        setSelectedArJob(null);
        return;
      }
    } catch (e: unknown) { setError(String(e)); } finally { setStarting(false); }
  };

  const handleCancel = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    emitPipelineEvent({ kind: "cancel", label: "⏹ 훈련 취소", detail: `작업 #${id}` });
    setJobs((prev) => prev.map((job) => job.id === id ? { ...job, status: "cancelled" } : job));
    setSelectedJob((prev) => prev?.id === id ? { ...prev, status: "cancelled" } : prev);
    await trainingApi.cancelJob(id).catch((err) => setError(String(err)));
    load();
  };

  const handleDeleteJob = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    await trainingApi.deleteJob(id);
    if (selectedJob?.id === id) setSelectedJob(null);
    load();
  };

  const handleDeleteAllJobs = async () => {
    setConfirmDeleteAllJobs(false);
    const total = [...jobs.filter((j) => !["pending", "running"].includes(j.status)), ...arJobs.filter((j) => !["pending", "running"].includes(j.status))].length;
    if (total === 0) return;
    try {
      await Promise.all([trainingApi.deleteAllJobs(), trainingApi.deleteAllARJobs()]);
      setSelectedJob(null);
      setSelectedArJob(null);
    } catch (e) {
      setError(`삭제 중 오류: ${e}`);
    }
    await load();
  };

  const handleDeleteARJob = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    await trainingApi.deleteARJob(id);
    if (selectedArJob?.id === id) setSelectedArJob(null);
    load();
  };

  const isAuto = form.mode === "autoresearch";
  const isDPO  = form.training_type === "dpo" && !isAuto;
  const showLora = !isDPO && form.method !== "full";
  const currentTool = TOOLS.find((t) => t.id === tool)!;

  const runningArJob = arJobs.find((j) => j.status === "running" || j.status === "pending");
  const runningJob = jobs.find((j) => j.status === "running" || j.status === "pending");
  const anyRunning = !!runningArJob || !!runningJob;

  const handleCancelARJob = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    emitPipelineEvent({ kind: "cancel", label: "⏹ AutoResearch 취소", detail: `작업 #${id}` });
    setArJobs((prev) => prev.map((job) => job.id === id ? { ...job, status: "cancelled" } : job));
    setSelectedArJob((prev) => prev?.id === id ? { ...prev, status: "cancelled" } : prev);
    await trainingApi.cancelARJob(id).catch((err) => setError(String(err)));
    load();
  };

  // 훈련 방식에 맞는 데이터셋만 필터링 (SFT/AutoResearch → SFT 계열(QA/CoT/ToT/GoT), DPO → dpo)
  const requiredDataType = isDPO ? "dpo" : "sft";
  const filteredDatasets = datasets.filter((d) => requiredDataType === "sft" ? isSftFamily(d.data_type) : d.data_type === requiredDataType);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      {/* ── 헤더 ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="w-7 h-7 rounded-md bg-blue-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">6</span>
          <Play className="w-5 h-5 text-blue-600 flex-shrink-0" />
          <div>
            <div className="flex items-center gap-1"><h1 className="text-xl font-bold text-gray-900">모델 훈련</h1><PageHelp pageKey="training" /></div>
            <p className="text-xs text-gray-500">SFT · DPO · AutoResearch로 모델 파인튜닝</p>
          </div>
        </div>
        <button onClick={load} className="p-2 hover:bg-gray-100 rounded-lg">
          <RefreshCw className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      {(agentPreparing || agentParams) && (
        <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold text-cyan-800">
                {agentPreparing ? "NELLA가 모델 훈련 단계를 준비 중입니다." : "NELLA가 선택한 훈련 설정이 화면에 반영되었습니다."}
              </p>
              {agentParams && (
                <p className="text-xs text-cyan-700 mt-1">
                  {agentParams.mode === "autoresearch" ? "AutoResearch" : "SFT"} · 데이터셋 {agentParams.datasetIds.join(", ") || "-"}
                  {" · "}{agentParams.modelId ?? "-"}
                  {agentParams.mode === "autoresearch"
                    ? ` · ${agentParams.maxTrials ?? form.max_trials}회 x ${agentParams.stepsPerTrial ?? form.steps_per_trial}스텝`
                    : ` · ${agentParams.numTrainEpochs ?? form.num_train_epochs}에폭 · LR ${agentParams.learningRate ?? form.learning_rate}`}
                </p>
              )}
            </div>
            {agentParams?.jobId && (
              <span className="text-xs font-mono text-cyan-700 bg-white/70 border border-cyan-100 rounded px-2 py-1">
                job #{agentParams.jobId}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 진행 중인 훈련이 있으면 항상 표시 — selectedJob/selectedArJob 상태와 무관하게
          "지금 무언가 돌고 있다"는 사실을 사용자에게 즉시 알려주는 배너.
          클릭하면 해당 잡을 모니터로 강제 전환한다. */}
      {(() => {
        const runningAR = arJobs.filter((j) => j.status === "running" || j.status === "pending");
        const runningSFT = jobs.filter((j) => j.status === "running" || j.status === "pending");
        if (runningAR.length === 0 && runningSFT.length === 0) return null;
        return (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500" />
              </span>
              <p className="text-xs font-semibold text-indigo-800">
                진행 중인 훈련 {runningAR.length + runningSFT.length}건
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {runningAR.map((j) => (
                <button
                  key={`ar-${j.id}`}
                  onClick={() => { setSelectedArJob(j); setSelectedJob(null); }}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                    selectedArJob?.id === j.id
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-indigo-700 border-indigo-300 hover:bg-indigo-100"
                  }`}
                  title="클릭하면 이 AutoResearch 잡의 진행 화면으로 이동"
                >
                  🧪 AR #{j.id} {j.name}
                  {j.best_loss != null && Number.isFinite(j.best_loss) ? ` · best ${j.best_loss.toFixed(3)}` : ""}
                </button>
              ))}
              {runningSFT.map((j) => (
                <button
                  key={`sft-${j.id}`}
                  onClick={() => { setSelectedJob(j); setSelectedArJob(null); }}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                    selectedJob?.id === j.id
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-blue-700 border-blue-300 hover:bg-blue-100"
                  }`}
                  title="클릭하면 이 훈련 잡의 진행 화면으로 이동"
                >
                  🏋️ Job #{j.id} {j.name}
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── 모드 + 도구 선택 카드 ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          {/* 모드 */}
          <div className="flex-1">
            <SectionLabel>훈련 방식</SectionLabel>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => f({ mode: "manual" })}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border text-sm font-medium transition-all ${
                  !isAuto ? "bg-blue-600 text-white border-blue-600" : "border-gray-200 text-gray-600 hover:border-gray-300"
                }`}
              >
                수동 설정
              </button>
              <button
                onClick={() => f({ mode: "autoresearch" })}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border text-sm font-medium transition-all ${
                  isAuto ? "bg-indigo-600 text-white border-indigo-600" : "border-gray-200 text-gray-600 hover:border-gray-300"
                }`}
              >
                <Wand2 className="w-3.5 h-3.5" />
                AutoResearch
              </button>
            </div>
            {isAuto && (
              <p className="text-xs text-indigo-600 mt-1.5">
                하이퍼파라미터를 자동으로 탐색하여 최적 설정을 찾습니다.
              </p>
            )}
          </div>

          {/* 구분선 */}
          <div className="hidden sm:block w-px self-stretch bg-gray-200" />

          {/* 도구 */}
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <SectionLabel>훈련 도구</SectionLabel>
              <a href={currentTool.link} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-xs text-blue-400 hover:text-blue-600">
                <ExternalLink className="w-3 h-3" />{currentTool.name} 공식
              </a>
            </div>
            <div className="flex gap-2 mt-2">
              {TOOLS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleToolChange(t.id)}
                  className={`flex-1 flex flex-col items-center py-2 rounded-lg border-2 text-xs font-semibold transition-all ${
                    tool === t.id ? t.activeCls : "border-gray-200 text-gray-500 hover:border-gray-300"
                  }`}
                >
                  {t.name}
                  <span className={`mt-0.5 px-1 py-px rounded text-xs font-medium ${tool === t.id ? "bg-white/20 text-white" : t.badgeCls}`}>
                    {t.badge}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1.5">{TOOL_DESC[tool]}</p>
          </div>
        </div>
      </div>

      {/* ── 설정 2컬럼 ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 왼쪽: 데이터셋 + 모델 + 훈련단계(수동) */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <SectionLabel>기본 설정</SectionLabel>

          <div>
            <label className="text-xs font-medium text-gray-600 flex items-center gap-1.5">
              학습 데이터셋
              <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${isDPO ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
                {requiredDataType.toUpperCase()}
              </span>
            </label>
            {filteredDatasets.length === 0 ? (
              <div className="mt-1 w-full border border-amber-200 bg-amber-50 rounded-lg px-3 py-2 text-xs text-amber-700">
                {requiredDataType.toUpperCase()} 데이터셋이 없습니다. 먼저 데이터 생성 단계에서 만들어 주세요.
              </div>
            ) : (
              <div className="mt-1 border border-gray-200 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                {filteredDatasets.map((d) => {
                  const checked = form.dataset_ids.includes(String(d.id));
                  const ready = d.train_count > 0;
                  return (
                    <label key={d.id}
                      className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors border-b border-gray-100 last:border-0 ${
                        checked ? "bg-blue-50" : ready ? "hover:bg-gray-50" : "opacity-50 cursor-not-allowed"
                      }`}>
                      <input type="checkbox" disabled={!ready}
                        checked={checked}
                        onChange={(e) => {
                          const id = String(d.id);
                          f({ dataset_ids: e.target.checked
                            ? [...form.dataset_ids, id]
                            : form.dataset_ids.filter((x) => x !== id) });
                        }}
                        className="w-3.5 h-3.5 rounded accent-blue-500 flex-shrink-0" />
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
            )}
            {form.dataset_ids.length > 1 && (
              <p className="text-[10px] text-blue-600 mt-1">✓ {form.dataset_ids.length}개 데이터셋 선택됨 — 훈련 시 자동 병합</p>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600">베이스 모델</label>
            <select value={form.model_id} onChange={(e) => f({ model_id: e.target.value })}
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-blue-400 focus:outline-none">
              <option value="">모델 선택...</option>
              {sortedModels.map((m) => (
                <option key={m.hf_model_id} value={m.hf_model_id}>
                  {m.name}{m.parameter_count ? ` (${m.parameter_count})` : ""}
                </option>
              ))}
            </select>
            {models.length === 0 && (
              <p className="text-xs text-yellow-600 mt-1">모델 선택 페이지에서 먼저 다운로드하세요.</p>
            )}
            {selectedModel?.local_path && (
              <p className="text-xs text-gray-400 mt-0.5 truncate" title={selectedModel.local_path}>
                {selectedModel.local_path}
              </p>
            )}
          </div>

          {/* 수동: 훈련 단계 */}
          {!isAuto && (
            <div>
              <label className="text-xs font-medium text-gray-600">훈련 단계</label>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                {[
                  { value: "sft", label: "SFT", sub: "지도 파인튜닝" },
                  { value: "dpo", label: "DPO", sub: "선호도 학습" },
                ].map((t) => (
                  <button key={t.value} onClick={() => f({ training_type: t.value, dataset_ids: [] })}
                    className={`text-left px-3 py-2 rounded-lg border transition-colors ${
                      form.training_type === t.value ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-gray-300"
                    }`}>
                    <p className={`text-xs font-semibold ${form.training_type === t.value ? "text-blue-700" : "text-gray-700"}`}>{t.label}</p>
                    <p className="text-xs text-gray-400">{t.sub}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* SFT / AutoResearch: 학습 방식 */}
          {!isDPO && (
            <div>
              <label className="text-xs font-medium text-gray-600">학습 방식</label>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {[
                  { value: "lora",  label: "LoRA",    sub: "추천" },
                  { value: "qlora", label: "QLoRA",   sub: "저메모리" },
                  { value: "full",  label: "Full FT", sub: "전체훈련" },
                ].map((m) => (
                  <button key={m.value} onClick={() => f({ method: m.value })}
                    className={`text-center px-2 py-2 rounded-lg border transition-colors ${
                      form.method === m.value ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-gray-300"
                    }`}>
                    <p className={`text-xs font-semibold ${form.method === m.value ? "text-blue-700" : "text-gray-700"}`}>{m.label}</p>
                    <p className="text-xs text-gray-400">{m.sub}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 오른쪽: 파라미터 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <SectionLabel>{isAuto ? "AutoResearch 설정" : "훈련 파라미터"}</SectionLabel>

          {isAuto ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500">최대 시도 횟수</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={maxTrialsStr}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9]/g, "");
                      setMaxTrialsStr(v);
                      if (v !== "") f({ max_trials: Number(v) });
                    }}
                    onBlur={() => {
                      const v = Math.max(2, Math.min(50, Number(maxTrialsStr) || 5));
                      f({ max_trials: v });
                      setMaxTrialsStr(String(v));
                    }}
                    className="w-full mt-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500">시도당 스텝</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={stepsStr}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9]/g, "");
                      setStepsStr(v);
                      if (v !== "") f({ steps_per_trial: Number(v) });
                    }}
                    onBlur={() => {
                      const v = Math.max(10, Number(stepsStr) || 50);
                      f({ steps_per_trial: v });
                      setStepsStr(String(v));
                    }}
                    className="w-full mt-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-400 focus:outline-none"
                  />
                </div>
                <P label="최종 훈련 에폭 수" value={form.num_train_epochs} min={1} max={100} onChange={(v) => f({ num_train_epochs: v })} />
              </div>
              <div className="bg-indigo-50 rounded-lg p-3 space-y-1">
                <p className="text-xs font-semibold text-indigo-700">AutoResearch 동작 방식</p>
                <p className="text-xs text-indigo-600 leading-relaxed">
                  총 {form.max_trials}회 후보 설정을 탐색하고, 각 시도는 {form.steps_per_trial}스텝까지 빠르게 훈련합니다.
                  탐색 대상은 학습률, 배치 크기{form.method !== "full" ? ", LoRA rank" : ""}이며,
                  가장 낮은 loss의 설정으로 최종 {form.num_train_epochs}에폭 훈련을 수행합니다.
                </p>
                <p className="text-xs text-indigo-500 mt-1">
                  사용 도구: <strong>{TOOLS.find((t) => t.id === tool)?.name}</strong>
                  {" · "}학습 방식: <strong>{{ lora: "LoRA", qlora: "QLoRA", full: "Full FT" }[form.method] ?? form.method}</strong>
                </p>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <P label="에폭 수" value={form.num_train_epochs} min={1} max={100} onChange={(v) => f({ num_train_epochs: v })} />
              <P label="최대 스텝" value={form.max_steps} min={1} onChange={(v) => f({ max_steps: Math.max(1, v) })} />
              <P label="학습률" value={form.learning_rate} step={0.00001} onChange={(v) => f({ learning_rate: v })} />
              <P label="배치 크기" value={form.batch_size} min={1} onChange={(v) => f({ batch_size: v })} />
              {!isDPO && (
                <P label="최대 시퀀스 길이" value={form.max_seq_length} min={128} onChange={(v) => f({ max_seq_length: v })} />
              )}
              {showLora && (
                <>
                  <P label="LoRA R" value={form.lora_r} min={1} onChange={(v) => f({ lora_r: v })} />
                  <P label="LoRA Alpha" value={form.lora_alpha} min={1} onChange={(v) => f({ lora_alpha: v })} />
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── 생성된 명령어 ── */}
      <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-green-400" />
            <span className="text-xs font-semibold text-gray-200">생성된 명령어</span>
            <span className="text-xs px-1.5 py-px bg-gray-700 text-gray-400 rounded">
              {isAuto ? "AutoResearch" : form.training_type.toUpperCase()} · {TOOLS.find((t) => t.id === tool)?.name}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <CopyButton text={generatedCmd} />
            <button onClick={() => setShowCmd((v) => !v)} className="p-1 text-gray-400 hover:text-gray-200">
              {showCmd ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>
        {showCmd && (
          <div className="px-4 py-3 max-h-64 overflow-y-auto">
            <pre className="text-xs text-green-300 font-mono leading-relaxed whitespace-pre-wrap break-all">
              {generatedCmd}
            </pre>
          </div>
        )}
      </div>

      {/* ── 작업명 + 시작 버튼 ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div>
          <label className="text-xs font-medium text-gray-500">훈련 작업명</label>
          <div className="flex gap-1.5 mt-1">
            <input
              type="text"
              value={form.name}
              onChange={(e) => f({ name: e.target.value })}
              placeholder="훈련 작업명..."
              className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-400 focus:outline-none"
            />
            <button
              onClick={() => f({ name: generateName() })}
              title="자동 생성"
              className="px-2.5 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-500"
            >
              <Wand2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">{error}</p>}
        {anyRunning && (
          <div className="flex items-center justify-between px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
            <span>
              {runningArJob ? <>AutoResearch 실행 중 — <strong>{runningArJob.name}</strong></> : <>훈련 실행 중 — <strong>{runningJob?.name}</strong></>}
            </span>
            {runningArJob && (
              <button
                onClick={(e) => handleCancelARJob(e, runningArJob.id)}
                className="flex items-center gap-1 px-2 py-1 text-amber-700 hover:bg-red-100 hover:text-red-600 border border-amber-300 hover:border-red-200 rounded transition-colors font-medium"
              >
                <X className="w-3 h-3" />중단
              </button>
            )}
          </div>
        )}
        <button
          onClick={handleStart}
          disabled={starting || form.dataset_ids.length === 0 || !form.model_id || anyRunning}
          className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
        >
          <Play className="w-4 h-4" />
          {starting ? "훈련 시작 중..." : isAuto ? "AutoResearch 시작" : "훈련 시작"}
        </button>
      </div>

      {/* ── 모니터: 일반 훈련 잡 ── */}
      {selectedJob && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700">{selectedJob.name}</h2>
            <div className="flex items-center gap-2">
              {(selectedJob.status === "running" || selectedJob.status === "pending") && (
                <button
                  onClick={(e) => handleCancel(e, selectedJob.id)}
                  className="flex items-center gap-1.5 px-3 py-1 bg-red-500 hover:bg-red-600 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  <StopCircle className="w-3.5 h-3.5" />훈련 중단
                </button>
              )}
              <button onClick={() => setSelectedJob(null)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
          </div>
          <TrainingMonitor
            key={selectedJob.id}
            job={selectedJob}
            onUpdate={(j) => { setSelectedJob(j); setJobs((prev) => prev.map((p) => (p.id === j.id ? j : p))); }}
          />
        </div>
      )}

      {/* ── 모니터: AutoResearch 잡 ── */}
      {selectedArJob && (
        <div className="bg-white rounded-xl border border-indigo-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-indigo-500" />
              <h2 className="text-sm font-semibold text-gray-700">{selectedArJob.name}</h2>
            </div>
            <button onClick={() => setSelectedArJob(null)} className="p-1 hover:bg-gray-100 rounded">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>
          <AutoResearchMonitor
            key={selectedArJob.id}
            job={selectedArJob}
            onComplete={() => load()}
            onCancel={selectedArJob.status === "running" || selectedArJob.status === "pending"
              ? async () => { await trainingApi.cancelARJob(selectedArJob.id); load(); }
              : undefined
            }
          />
        </div>
      )}

      {/* ── 통합 훈련 이력 ── */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
          <h2 className="text-sm font-semibold text-gray-700 flex-1">
            훈련 이력 ({jobs.length + arJobs.length})
          </h2>
          {[...jobs, ...arJobs].some((j) => !["pending", "running"].includes(j.status)) && (
            confirmDeleteAllJobs ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-red-600 font-medium">완료/실패 작업 모두 삭제?</span>
                <button
                  onClick={handleDeleteAllJobs}
                  className="px-2 py-0.5 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded transition-colors"
                >확인</button>
                <button
                  onClick={() => setConfirmDeleteAllJobs(false)}
                  className="px-2 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded transition-colors"
                >취소</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDeleteAllJobs(true)}
                className="flex items-center gap-1 px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded transition-colors"
                title="완료/실패/취소된 작업 전체 삭제"
              >
                <Trash2 className="w-3.5 h-3.5" />전체 삭제
              </button>
            )
          )}
        </div>
        {jobs.length === 0 && arJobs.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">훈련 작업이 없습니다</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {[
              ...jobs.map((j) => ({ ...j, _kind: "manual" as const })),
              ...arJobs.map((j) => ({ ...j, _kind: "auto" as const })),
            ]
              .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
              .map((item) => {
                if (item._kind === "manual") {
                  const job = item as TrainingJob & { _kind: "manual" };
                  const isActive = job.status === "pending" || job.status === "running";
                  const histKey = `m-${job.id}`;
                  const isExpanded = expandedHistoryId === histKey;
                  const jobCmd = buildCommandFromJobConfig(job, models);
                  return (
                    <div key={histKey}>
                      <div
                        className={`flex items-center gap-3 px-5 py-3 hover:bg-gray-50 cursor-pointer ${selectedJob?.id === job.id ? "bg-blue-50" : ""}`}
                        onClick={() => { setSelectedJob(job); setSelectedArJob(null); }}
                      >
                        <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-xs rounded font-medium shrink-0">수동</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800">{job.name}</p>
                          <p className="text-xs text-gray-400">{job.method?.toUpperCase() ?? "SFT"} · {formatDate(job.created_at)}</p>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor(job.status)}`}>{job.status}</span>
                        {job.final_loss != null && <span className="text-xs text-gray-400">loss: {job.final_loss.toFixed(4)}</span>}
                        <button
                          onClick={(e) => { e.stopPropagation(); setExpandedHistoryId(isExpanded ? null : histKey); }}
                          className={`p-1 rounded transition-colors ${isExpanded ? "bg-gray-200 text-gray-600" : "hover:bg-gray-100 text-gray-400"}`}
                          title="상세 보기"
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                        {isActive ? (
                          <button onClick={(e) => handleCancel(e, job.id)} className="p-1 hover:bg-red-100 rounded" title="중단">
                            <X className="w-4 h-4 text-red-400" />
                          </button>
                        ) : (
                          <button onClick={(e) => handleDeleteJob(e, job.id)} className="p-1 hover:bg-red-100 rounded opacity-50 hover:opacity-100 transition-opacity" title="삭제">
                            <Trash2 className="w-3.5 h-3.5 text-red-400" />
                          </button>
                        )}
                      </div>
                      {isExpanded && (
                        <div className="px-5 pb-5 pt-2 bg-gray-50 border-t border-gray-100 space-y-3">
                          {/* 명령어 */}
                          <div className="bg-gray-900 rounded-lg overflow-hidden">
                            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
                              <span className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
                                <Terminal className="w-3 h-3 text-green-400" />훈련 명령어
                              </span>
                              <CopyButton text={jobCmd} />
                            </div>
                            <pre className="px-3 py-2.5 text-xs text-green-300 font-mono whitespace-pre-wrap break-all leading-relaxed">
                              {jobCmd}
                            </pre>
                          </div>
                          {/* Loss 그래프 */}
                          {job.training_metrics && job.training_metrics.length > 0 && (
                            <MetricsChart metrics={job.training_metrics} />
                          )}
                          {/* 결과 정보 */}
                          <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                            {job.final_loss != null && (
                              <span>최종 loss: <strong className="text-gray-700">{job.final_loss.toFixed(4)}</strong></span>
                            )}
                            {job.started_at && job.completed_at && (
                              <span>소요: {Math.round((new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 60000)}분</span>
                            )}
                            {job.output_dir && (
                              <span className="font-mono text-gray-400 truncate">📂 {job.output_dir}</span>
                            )}
                            {job.error_message && (
                              <span className="text-red-500 break-all">오류: {job.error_message}</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                } else {
                  const job = item as ARJob & { _kind: "auto" };
                  const histKey = `a-${job.id}`;
                  const isExpanded = expandedHistoryId === histKey;
                  return (
                    <div key={histKey}>
                      <div
                        className={`flex items-center gap-3 px-5 py-3 hover:bg-indigo-50 cursor-pointer ${selectedArJob?.id === job.id ? "bg-indigo-50" : ""}`}
                        onClick={() => { setSelectedArJob(job); setSelectedJob(null); }}
                      >
                        <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-600 text-xs rounded font-medium shrink-0 flex items-center gap-1">
                          <Wand2 className="w-2.5 h-2.5" />Auto
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800">{job.name}</p>
                          <p className="text-xs text-gray-400">{job.max_trials}회×{job.steps_per_trial}스텝 · {formatDate(job.created_at)}</p>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor(job.status)}`}>{job.status}</span>
                        {job.best_loss != null && <span className="text-xs text-gray-400">best: {job.best_loss.toFixed(4)}</span>}
                        <button
                          onClick={(e) => { e.stopPropagation(); setExpandedHistoryId(isExpanded ? null : histKey); }}
                          className={`p-1 rounded transition-colors ${isExpanded ? "bg-indigo-100 text-indigo-600" : "hover:bg-indigo-50 text-gray-400"}`}
                          title="상세 보기"
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                        {(job.status === "running" || job.status === "pending") ? (
                          <button onClick={(e) => handleCancelARJob(e, job.id)} className="p-1 hover:bg-red-100 rounded" title="중지">
                            <X className="w-4 h-4 text-red-400" />
                          </button>
                        ) : (
                          <button onClick={(e) => handleDeleteARJob(e, job.id)} className="p-1 hover:bg-red-100 rounded opacity-50 hover:opacity-100 transition-opacity" title="삭제">
                            <Trash2 className="w-3.5 h-3.5 text-red-400" />
                          </button>
                        )}
                      </div>
                      {isExpanded && (
                        <div className="px-5 pb-5 pt-2 bg-indigo-50/40 border-t border-indigo-100 space-y-3">
                          {/* 최적 설정 */}
                          {job.best_config && (
                            <div>
                              <p className="text-xs font-semibold text-indigo-700 mb-1.5">
                                🏆 최적 설정{job.best_loss != null && ` (loss: ${job.best_loss.toFixed(4)})`}
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {Object.entries(job.best_config)
                                  .filter(([, v]) => v != null && v !== -1)
                                  .map(([k, v]) => (
                                    <span key={k} className="px-2 py-0.5 bg-indigo-100 rounded text-xs text-indigo-700">
                                      <span className="text-indigo-400">{k}=</span>
                                      {typeof v === "number" && v < 0.01 ? (v as number).toExponential(1) : String(v)}
                                    </span>
                                  ))}
                              </div>
                            </div>
                          )}
                          {/* Trial 결과 */}
                          {job.trial_results && job.trial_results.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-indigo-700 mb-1.5">
                                📊 Trial 결과 ({job.trial_results.length}개)
                              </p>
                              <div className="space-y-1.5">
                                {[...job.trial_results]
                                  .sort((a, b) => a.final_loss - b.final_loss)
                                  .map((t) => (
                                    <div key={t.trial_id} className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-indigo-100 text-xs flex-wrap">
                                      <span className="font-mono text-indigo-500 shrink-0">#{t.trial_id}</span>
                                      <span className="font-semibold text-gray-700">loss: {t.final_loss.toFixed(4)}</span>
                                      {t.eval_loss != null && (
                                        <span className="text-gray-500">eval: {t.eval_loss.toFixed(4)}</span>
                                      )}
                                      <div className="flex flex-wrap gap-1 ml-auto">
                                        {Object.entries(t.config)
                                          .filter(([, v]) => v != null && v !== -1)
                                          .slice(0, 4)
                                          .map(([k, v]) => (
                                            <span key={k} className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500">
                                              {k}={typeof v === "number" && v < 0.01 ? (v as number).toExponential(1) : String(v)}
                                            </span>
                                          ))}
                                      </div>
                                      <span className="text-gray-400 shrink-0">{Math.round(t.duration_seconds / 60)}분</span>
                                    </div>
                                  ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                }
              })
            }
          </div>
        )}
      </div>
    </div>
  );
};

export default Training;
