import type { HelpEntry } from "./helpContent";

export const helpContent_en: Record<string, HelpEntry> = {
  documents: {
    pageTitle: "Document Upload",
    summary: "Upload PDF/DOCX/HWP documents and extract text (and images). The extracted text is used for the next step, 'Training Data Generation'.",
    sections: [
      {
        title: "Supported formats",
        items: [
          "<b>PDF</b> / <b>DOCX</b> / <b>HWP</b> uploads are supported",
          "Multiple files are queued and processed in order",
        ],
      },
      {
        title: "Text extractors",
        items: [
          "<b>openDataLoader</b> (default) — Unified PDF/DOCX/HWP handling with image extraction",
          "<b>MarkItDown</b> — Optimized for Markdown conversion",
          "<b>PyPDF</b> — PDF-only text extraction",
          "<b>Docling</b> — GPU/MPS accelerated, great at tables and images",
        ],
      },
      {
        title: "How to use",
        items: [
          "Pick an extractor and toggle 'Extract images too' as needed, then upload files",
          "Processing status and progress display live",
        ],
      },
      {
        title: "Caveats",
        items: [
          "Scanned PDFs may vary in quality across extractors",
          "Large files can take longer to process",
        ],
      },
    ],
  },

  dataGeneration: {
    pageTitle: "Training Data Generation",
    summary: "An LLM automatically generates question/answer training data from extracted documents or an uploaded JSONL.",
    sections: [
      {
        title: "Data types",
        items: [
          "<b>QA (SFT)</b> — Plain question/answer pairs",
          "<b>CoT</b> (Chain-of-Thought) — Includes step-by-step reasoning",
          "<b>ToT</b> (Tree-of-Thought) — Branch-search reasoning data",
          "<b>GoT</b> (Graph-of-Thought) — Graph-structured reasoning data",
          "<b>DPO</b> — Preferred/dispreferred response pairs (for preference learning)",
        ],
      },
      {
        title: "Generation options",
        items: [
          "Source: <b>Select documents</b> or <b>Upload JSONL</b>",
          "Set the number of pairs and the train/test split ratio",
          "Choose an LLM provider: Default · OpenAI · Anthropic · Ollama",
          "Edit the system/user prompt directly to shape the output style",
        ],
      },
      {
        title: "Reviewing results",
        items: [
          "Progress displays live",
          "After completion, the preview modal shows the top 10 train/test samples",
          "Recommended to validate quality in the next step 'Data Validation' before training",
        ],
      },
    ],
  },

  dataValidation: {
    pageTitle: "Training Data Validation",
    summary: "Score the generated training data with rules or an LLM to filter out low-quality samples.",
    sections: [
      {
        title: "LLM-based validation",
        items: [
          "Uses an LLM (OpenAI · Anthropic · Ollama) as the judge",
          "Choose to evaluate the full dataset or just representative samples",
          "Scores against 5 criteria: <b>Accuracy · Relevance · Clarity · Completeness · Diversity</b>",
          "Issues are shown with a severity label (High / Medium / Low)",
        ],
      },
      {
        title: "Rule-based validation",
        items: [
          "Auto-filters by answer length range, duplicates, and low-quality items",
          "Optional removal of items that fail conditions",
          "Fast and free",
        ],
      },
      {
        title: "How to use",
        items: [
          "Pick a data type (QA/DPO) and a dataset",
          "Configure validation method and options, then click 'Start Validation'",
          "You can 'Stop' anytime during the run",
        ],
      },
      {
        title: "Results and next steps",
        items: [
          "Total (out of 10) and per-criterion scores appear as radar/bar charts",
          "See the high-quality pass rate at a glance",
          "A 'validated dataset' is created automatically for use in training",
          "Validation history can be revisited any time",
        ],
      },
    ],
  },

  modelSelection: {
    pageTitle: "Base Model Selection",
    summary: "Search and download the pre-trained model that will be your fine-tuning starting point from HuggingFace.",
    sections: [
      {
        title: "Two model sources",
        items: [
          "<b>Curated models</b> — Pre-vetted picks from NELLA (size/sort filters)",
          "<b>Latest HuggingFace models</b> — Search the Hub by popularity/likes/date",
        ],
      },
      {
        title: "Filter and sort",
        items: [
          "Size: Small (&lt;2B) · SMedium (2~7B) · Medium (7~13B)",
          "Sort: Popular · Liked · Newest · Oldest · Size asc/desc",
        ],
      },
      {
        title: "Download",
        items: [
          "Download progress shows live in the bottom-right panel",
          "You can 'Cancel' during download",
          "Completed models appear in the top 'My Models' list for chat testing or deletion",
        ],
      },
      {
        title: "License-gated models",
        items: [
          "Llama and Gemma families require prior license consent on HuggingFace",
          "Available after registering <code>HF_TOKEN=hf_...</code>",
        ],
      },
    ],
  },

  modelValidation: {
    pageTitle: "Model Validation",
    summary: "Analyze the internal activations of candidate base models to predict which will fine-tune best. (Beta)",
    sections: [
      {
        title: "Two prediction modes",
        items: [
          "<b>Mode A — Final-score based</b>: Measure current score + predict improvement. Precise but slower.",
          "<b>Mode B — Improvement-only</b>: Predict improvement (%) only. Fast.",
        ],
      },
      {
        title: "Workflow",
        items: [
          "Pick an SFT eval dataset (multiple selections auto-merge)",
          "Check the candidate models to compare, or add HuggingFace IDs directly",
          "Set the validation sample size and LLM judge (Mode A), then click 'Start Validation'",
        ],
      },
      {
        title: "Next steps",
        items: [
          "The top-ranked model is labeled 'Best pick'",
          "You can jump into fine-tuning that model directly in the 'Model Training' step",
        ],
      },
    ],
  },

  training: {
    pageTitle: "Model Training",
    summary: "Run fine-tuning with the chosen base model and training data. Supports manual settings and AutoResearch (automatic hyperparameter search).",
    sections: [
      {
        title: "Trainers",
        items: [
          "<b>TRL</b> — HuggingFace's official library, most stable",
          "<b>Axolotl</b> — YAML-driven, rich options",
          "<b>Unsloth</b> — 2~4x faster, memory-efficient",
        ],
      },
      {
        title: "Training stages",
        items: [
          "<b>SFT</b> — Supervised fine-tuning (question/answer training)",
          "<b>DPO</b> — Preference-based optimization",
        ],
      },
      {
        title: "Training methods",
        items: [
          "<b>LoRA</b> — Train adapters only, fast and memory-efficient (recommended)",
          "<b>QLoRA</b> — 4-bit quantization + LoRA, minimum VRAM",
          "<b>Full FT</b> — Train all parameters, needs large VRAM",
        ],
      },
      {
        title: "How to use",
        items: [
          "Configure the dataset (multiple selections auto-merge), base model, and hyperparameters",
          "If needed, copy the auto-generated command to run externally",
          "Click 'Start Training' or 'Start AutoResearch'",
          "Monitor the loss curve and logs live, 'Stop' anytime",
        ],
      },
      {
        title: "AutoResearch",
        items: [
          "Specify max trials, steps per trial, and final epochs",
          "Sweeps hyperparameter combinations to find the best settings",
        ],
      },
    ],
  },

  trainingResults: {
    pageTitle: "Training Results",
    summary: "Manage the metrics and artifacts of completed training jobs. Direct links to LoRA adapter merging, model download, and chat testing.",
    sections: [
      {
        title: "Status filter",
        items: [
          "Classify jobs by All · Complete · Cancelled · Failed tabs",
        ],
      },
      {
        title: "What you can inspect",
        items: [
          "Final/best loss values and the learning curve",
          "Training settings (epochs · LR · batch size · LoRA R/Alpha etc.)",
          "AutoResearch per-trial table (loss · step · duration for each trial)",
          "Saved checkpoint path",
        ],
      },
      {
        title: "Main actions",
        items: [
          "<b>Model/adapter download</b> — LoRA adapter or full merged model file",
          "<b>LoRA merge</b> — Merge base model + adapter into a single model (progress via SSE)",
          "<b>LoRA usage guide</b> — Python sample code for loading the adapter externally",
          "<b>Chat test</b> — Jump directly to the 'Chat Test' page",
        ],
      },
    ],
  },

  evaluation: {
    pageTitle: "Model Evaluation",
    summary: "Measure the fine-tuned model's performance with quantitative metrics (BLEU/ROUGE/Perplexity/LLM Judge) and standard benchmarks.",
    sections: [
      {
        title: "Basic evaluation",
        items: [
          "Pick a completed training job",
          "Specify the test data",
          "Toggle <b>LLM Judge</b> for extra scoring of answer quality by an LLM",
          "Live progress after start; 'Stop' anytime",
        ],
      },
      {
        title: "Metric definitions",
        items: [
          "<b>BLEU</b> — n-gram overlap between the reference and the model output",
          "<b>ROUGE-1/2/L</b> — Recall of the model output vs. the reference (used for summarization)",
          "<b>Perplexity</b> — Language prediction uncertainty (lower is better)",
          "<b>LLM Judge</b> — An LLM scores response quality directly",
        ],
      },
      {
        title: "Benchmark evaluation",
        items: [
          "Computes standard scores from a locally-stored model + multi-selected benchmarks",
          "Supported: <b>MMLU · ARC-Easy/Challenge · HellaSwag · TruthfulQA · GSM8K · WinoGrande · Ko-MMLU · KLUE</b>",
          "Results display as bar/radar charts and score tables, comparable with past runs",
        ],
      },
    ],
  },

  ragDb: {
    pageTitle: "RAG DB Creation",
    summary: "Pick uploaded documents and build a searchable vector DB (RAG DB). Create multiple RAG DBs by name and attach the one you need in the next step 'Chat Test'.",
    sections: [
      {
        title: "What a RAG DB is",
        items: [
          "Document text split into chunks, embedded with <b>BGE-M3</b>, and stored in <b>ChromaDB</b>",
          "A <b>Retrieval-Augmented Generation</b> technique — retrieve chunks semantically close to the question and pass them as context",
          "Lets the model answer with grounded facts outside its training knowledge (internal manuals, latest docs, etc.)",
        ],
      },
      {
        title: "How to create",
        items: [
          "Click <b>+ New RAG DB</b> in the top-right, then fill in name/description and pick documents",
          "As soon as it's created, the chosen documents are embedded and indexed",
          "Manage multiple RAG DBs split by purpose (e.g., 'Technical docs', 'Regulations', 'Internal rules')",
        ],
      },
      {
        title: "Management actions",
        items: [
          "<b>Edit documents</b> — Add or remove documents in an existing RAG DB (removes only that document's chunks)",
          "<b>Reindex</b> — Full rebuild when document contents change or when swapping the embedding",
          "<b>Delete</b> — Deleting the RAG DB also removes the Chroma collection",
        ],
      },
      {
        title: "Connecting to Chat Test",
        items: [
          "Turn on <b>Use RAG</b> on the 'Chat Test' page and a RAG DB dropdown appears",
          "Pick a RAG DB you made on this page to use in the conversation",
          "You can A/B test answer quality across multiple RAG DBs",
        ],
      },
    ],
  },

  chat: {
    pageTitle: "Chat Test",
    summary: "Chat live with your trained local model or an external API model to verify response quality. RAG (retrieval-based response) can be enabled.",
    sections: [
      {
        title: "Chat modes",
        items: [
          "<b>Local model</b> — Pick a downloaded or trained model, or enter a path directly",
          "<b>OpenAI</b> — GPT family (model list fetched with your API key)",
          "<b>Anthropic</b> — Claude Sonnet · Haiku · Opus family",
          "<b>Ollama</b> — Inference through a local Ollama server",
        ],
      },
      {
        title: "RAG mode",
        items: [
          "Toggle on to retrieve uploaded documents from the VectorDB and use them as response context",
          "Effective at reducing hallucination on factual questions",
        ],
      },
      {
        title: "How to use",
        items: [
          "Pick a chat mode and model (local models may take a while for initial loading)",
          "Type your message once the state reads 'Ready'",
          "Swap between the base and fine-tuned models to compare responses",
        ],
      },
    ],
  },

  llmSettings: {
    pageTitle: "LLM Settings",
    summary: "Configure the external LLM providers, API keys, and default models used in data generation, validation, and evaluation.",
    sections: [
      {
        title: "Supported providers",
        items: [
          "<b>OpenAI</b> — GPT-4o · GPT-4o-mini etc.",
          "<b>Anthropic</b> — Claude Sonnet · Haiku · Opus family",
          "<b>Ollama</b> — Local LLMs (Llama · Mistral etc.)",
        ],
      },
      {
        title: "How to configure",
        items: [
          "Register API keys on this page or in <code>.env</code>",
          "Pick a provider and model, then click 'Save' — applied immediately",
          "If using Ollama, a local Ollama server must be running",
        ],
      },
      {
        title: "Recommended per use case",
        items: [
          "Data generation: cost-efficient GPT-4o-mini or Claude Haiku recommended",
          "Data validation and LLM Judge: precision matters, so GPT-4o or Claude Sonnet recommended",
        ],
      },
    ],
  },
};
