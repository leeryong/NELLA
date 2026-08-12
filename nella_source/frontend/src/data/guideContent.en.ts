import type { TabText } from "./guideContent";

export const guideText_en: Record<string, TabText> = {
  intro: {
    label: "Getting Started",
    heading: "Welcome to NELLA",
    lead: "Just give it your documents and it builds a model for you. NELLA is a 10-step LLMOps pipeline that generates training data from PDF/DOCX/HWP files and lets you fine-tune, evaluate, and deploy models.",
    sections: [
      {
        title: "The 10 steps NELLA automates",
        type: "flow",
        items: [
          "<b>1. Document Upload</b> — Extract text from PDF/DOCX/HWP",
          "<b>2. Training Data Generation</b> — Auto-generate QA/DPO training data from documents",
          "<b>3. Data Validation</b> — Rule- and LLM-based quality checks",
          "<b>4. Base Model Selection</b> — Search and download HuggingFace models",
          "<b>5. Model Validation</b> — Scout-based prediction of promising models",
          "<b>6. Model Training</b> — SFT/DPO/AutoResearch fine-tuning",
          "<b>7. Training Results</b> — Merge and download LoRA adapters",
          "<b>8. Model Evaluation</b> — BLEU/ROUGE/benchmark metrics",
          "<b>9. RAG DB Creation</b> — Build a document-based vector DB (ChromaDB)",
          "<b>10. Chat Test</b> — Talk to the trained model directly (optionally with a RAG DB)",
        ],
      },
      {
        title: "Nice to have before you start",
        type: "list",
        items: [
          "<b>LLM API key</b> — Used for data generation and evaluation (OpenAI or Anthropic). Register in <code>.env</code> or the 'LLM Settings' page",
          "<b>HuggingFace token</b> — Required to download license-gated models like Llama or Gemma. <code>HF_TOKEN=hf_...</code>",
          "<b>GPU</b> — Required for training and inference. Small models train from 8GB VRAM; 13B-class models want 24GB+",
        ],
      },
      {
        title: "How to use this guide",
        type: "tip",
        items: [
          "Click a tab on the left to jump to a step, or use the Prev/Next buttons at the bottom to go in order",
          "Every step has a 'Go to this page' button at the end so you can start the work immediately",
          "Each page has a 'Help' button in the top-right that reopens its short page-level help",
        ],
      },
    ],
  },

  step1: {
    label: "1. Document Upload",
    heading: "Step 1 — Document Upload",
    lead: "Upload the PDF/DOCX/HWP documents you want to train on and extract their text. The extracted text becomes the source material for the next steps.",
    sections: [
      {
        title: "Why this step matters",
        items: [
          "NELLA auto-generates training data from your documents, so <b>a good model starts with good documents</b>",
          "Low extraction quality drags down the quality of every downstream step",
        ],
      },
      {
        title: "Workflow",
        type: "list",
        items: [
          "<b>① Pick an extractor</b> — Choose one of openDataLoader / MarkItDown / PyPDF / Docling in the top bar",
          "<b>② Check options</b> — Enable 'Extract images too' for image-heavy documents (openDataLoader · Docling)",
          "<b>③ Upload files</b> — Drag-and-drop or click to pick PDF/DOCX/HWP (multiple files at once are fine)",
          "<b>④ Monitor progress</b> — Live progress shows in the list below; click 'Preview' on finished docs to inspect the result",
          "<b>⑤ Re-extract if needed</b> — If the result isn't good, run 'Re-extract' with a different extractor",
        ],
      },
      {
        title: "The four extractors",
        items: [
          "<b>openDataLoader</b> (default) — Unified PDF/DOCX/HWP handling with image extraction",
          "<b>MarkItDown</b> — Optimized for Markdown conversion",
          "<b>PyPDF</b> — Lightweight, PDF-only",
          "<b>Docling</b> — GPU/MPS accelerated, great at tables and images",
        ],
      },
      {
        title: "Caveats",
        type: "warn",
        items: [
          "Quality on scanned image PDFs varies a lot across extractors — try multiple ones",
          "Large documents (tens of MB) can take a while to process",
        ],
      },
      {
        title: "Ready for the next step?",
        type: "tip",
        items: [
          "As soon as one document reaches 'Extraction complete', move on to <b>Step 2 — Training Data Generation</b>",
        ],
      },
    ],
  },

  step2: {
    label: "2. Training Data Gen",
    heading: "Step 2 — Training Data Generation",
    lead: "An LLM automatically generates question/answer training data from your extracted documents (or an uploaded JSONL).",
    sections: [
      {
        title: "Why this step matters",
        items: [
          "Fine-tuning needs <b>clean question/answer pairs</b>",
          "NELLA uses an LLM (OpenAI / Anthropic / Ollama) to generate training data from your documents, saving huge amounts of time",
        ],
      },
      {
        title: "Workflow",
        type: "list",
        items: [
          "<b>① Pick a data source</b> — 'Select documents' tab or 'Upload JSONL' tab",
          "<b>② Pick a data type</b> — QA(SFT) / CoT / ToT / GoT / DPO",
          "<b>③ Set generation options</b> — Number of pairs, train/test split ratio, dataset name",
          "<b>④ Pick an LLM provider</b> — Default / OpenAI / Anthropic / Ollama / Mock",
          "<b>⑤ (Optional) Edit the prompt</b> — Tune the system/user prompt to shape the output style",
          "<b>⑥ Click 'Generate'</b> — Live progress; preview samples when it finishes",
        ],
      },
      {
        title: "The five data types",
        items: [
          "<b>QA (SFT)</b> — Plain question/answer pairs. The default choice",
          "<b>CoT</b> (Chain-of-Thought) — Includes step-by-step reasoning",
          "<b>ToT</b> (Tree-of-Thought) — Branch-search reasoning",
          "<b>GoT</b> (Graph-of-Thought) — Graph-structured reasoning",
          "<b>DPO</b> — Preferred/dispreferred response pairs (for preference learning)",
        ],
      },
      {
        title: "Tips",
        type: "tip",
        items: [
          "Start small (10~30 pairs), verify quality, then scale up",
          "If cost is a concern, use a cheaper LLM provider like GPT-4o-mini or Claude Haiku",
        ],
      },
      {
        title: "Caveats",
        type: "warn",
        items: [
          "LLM API costs are incurred — scales with the number of pairs generated",
          "If the source document text quality is low, so is the generated data",
        ],
      },
      {
        title: "Ready for the next step?",
        type: "tip",
        items: [
          "Once the dataset is visible → go to <b>Step 3 — Data Validation</b> to double-check quality",
        ],
      },
    ],
  },

  step3: {
    label: "3. Data Validation",
    heading: "Step 3 — Training Data Validation",
    lead: "Score the generated training data with rules or an LLM to filter out low-quality samples.",
    sections: [
      {
        title: "Why this step matters",
        items: [
          "Auto-generated data has variable quality — pruning before training makes model performance more stable",
          "Data that passes validation is auto-saved as a separate dataset that's immediately usable in the Training step",
        ],
      },
      {
        title: "Two validation modes",
        items: [
          "<b>Rule-based</b> — Auto-filters by answer length, duplicates, and low-quality items. Fast and free",
          "<b>LLM-based</b> — An LLM (OpenAI / Anthropic / Ollama) scores against 5 criteria. More precise but slower and costs money",
        ],
      },
      {
        title: "The 5 LLM criteria",
        items: [
          "<b>Accuracy</b> · <b>Relevance</b> · <b>Clarity</b> · <b>Completeness</b> · <b>Diversity</b>",
          "The total (out of 10) and per-criterion scores are visualized as radar and bar charts",
          "Issues are surfaced with a severity label (High / Medium / Low)",
        ],
      },
      {
        title: "Workflow",
        type: "list",
        items: [
          "<b>① Pick a data type (QA/DPO) and a dataset</b>",
          "<b>② Configure the validator</b> — Pick an LLM judge, and whether to evaluate all data or just a representative sample",
          "<b>③ Click 'Start Validation'</b> — 'Stop' anytime during the run",
          "<b>④ Review results</b> — Retention rate (%), per-criterion scores, and the issues list",
        ],
      },
      {
        title: "Tips",
        type: "tip",
        items: [
          "If time/cost is tight, use 'Evaluate representative samples only' to score a subset",
          "Rules first, then LLM as a second pass is an effective pipeline",
        ],
      },
      {
        title: "Ready for the next step?",
        type: "tip",
        items: [
          "Once the validated dataset is created → go to <b>Step 4 — Base Model Selection</b>",
        ],
      },
    ],
  },

  step4: {
    label: "4. Base Model",
    heading: "Step 4 — Base Model Selection",
    lead: "Search and download the pre-trained model that will be your fine-tuning starting point from HuggingFace.",
    sections: [
      {
        title: "Why this step matters",
        items: [
          "Instead of training from scratch, you build on a <b>pre-trained model that's already smart</b>",
          "Base model choice is one of the biggest levers for final quality",
        ],
      },
      {
        title: "Two model sources",
        items: [
          "<b>Curated models</b> — A pre-vetted list from NELLA, with size/sort filters",
          "<b>Latest HuggingFace models</b> — Search the full Hub by popularity/likes/date",
        ],
      },
      {
        title: "Workflow",
        type: "list",
        items: [
          "<b>① Pick a tab</b> — Curated or HuggingFace",
          "<b>② Search and filter</b> — By size (Small &lt;2B / SMedium 2~7B / Medium 7~13B) or sort",
          "<b>③ Click Download</b> — Live progress in the bottom-right panel",
          "<b>④ Auto-registers on completion</b> — Chat-test or delete from the 'My Models' list at the top",
        ],
      },
      {
        title: "License-gated models",
        type: "warn",
        items: [
          "<b>Llama and Gemma families</b> require prior license consent from Meta/Google before you can download them",
          "Register <code>HF_TOKEN=hf_...</code> in <code>.env</code> then try again",
        ],
      },
      {
        title: "Not sure which model to pick?",
        type: "tip",
        items: [
          "If your GPU VRAM is 8GB or less, start with <b>1~2B</b>",
          "If quality matters more, try <b>3B or larger</b>",
          "Downloading several candidates and comparing them in 'Model Validation' is recommended",
        ],
      },
      {
        title: "Ready for the next step?",
        type: "tip",
        items: [
          "At least one downloaded candidate → go to <b>Step 5 — Model Validation</b> or jump straight to <b>Step 6 — Model Training</b>",
        ],
      },
    ],
  },

  step5: {
    label: "5. Model Validation",
    heading: "Step 5 — Model Validation (Beta)",
    lead: "Scout analyzes the internal activations of candidate models to predict which will fine-tune best — without actually running fine-tuning.",
    sections: [
      {
        title: "Why this step matters",
        items: [
          "Fully training every candidate to compare is very expensive in GPU time",
          "Scout predicts post-training improvement from <b>internal activation metrics</b>, giving you a shortlist before you commit",
        ],
      },
      {
        title: "How it works",
        items: [
          "A slice (default 10%) of the training data is fed through candidates for a single inference pass (no actual training)",
          "For each transformer layer, extract <b>dispersion · attention_entropy · head_diversity</b>",
          "Match your dataset against 6 reference datasets via BGE-M3 embeddings + Wasserstein distance",
          "The matched reference's RandomForest regressor predicts each candidate's <b>fine-tuning improvement</b>",
        ],
      },
      {
        title: "Two prediction modes",
        items: [
          "<b>Mode A — Final-score based</b>: Measure current score + predict improvement to derive an expected post-training score. Precise but slow",
          "<b>Mode B — Improvement-only</b>: Just predict improvement (%). Fast",
        ],
      },
      {
        title: "Workflow",
        type: "list",
        items: [
          "<b>① Pick an SFT eval dataset</b> — Multiple selections auto-merge",
          "<b>② Check candidate models</b> — Downloaded models or paste a HuggingFace ID directly",
          "<b>③ Set options</b> — Eval sample size (default 10%), LLM judge (Mode A)",
          "<b>④ Click 'Start Validation'</b> — Results appear as a per-model leaderboard",
        ],
      },
      {
        title: "Result metrics",
        items: [
          "<b>Predicted improvement (%)</b> · <b>Expected final score</b> · <b>LLM Judge score</b> · <b>Recommendation badge</b> (Recommended / OK / Not recommended)",
          "The top-ranked model is labeled 'Best pick'",
        ],
      },
      {
        title: "Ready for the next step?",
        type: "tip",
        items: [
          "Once you have your best pick → fine-tune it in <b>Step 6 — Model Training</b>",
        ],
      },
    ],
  },

  step6: {
    label: "6. Model Training",
    heading: "Step 6 — Model Training",
    lead: "Run fine-tuning with the chosen base model and training data. This is the core step of the NELLA pipeline.",
    sections: [
      {
        title: "Why this step matters",
        items: [
          "This is where you finally get <b>your own customized model</b>",
          "Use manual settings for full control, or let AutoResearch sweep hyperparameters automatically",
        ],
      },
      {
        title: "Workflow",
        type: "list",
        items: [
          "<b>① Pick a training mode</b> — Manual / AutoResearch",
          "<b>② Pick a trainer</b> — TRL / Axolotl / Unsloth",
          "<b>③ Pick a dataset + base model</b> — Multiple datasets auto-merge",
          "<b>④ Pick the training stage and method</b> — SFT/DPO + LoRA/QLoRA/Full",
          "<b>⑤ Set hyperparameters</b> — Epochs, learning rate, batch size, etc.",
          "<b>⑥ Click 'Start Training' or 'Start AutoResearch'</b> — Live loss curve and logs",
        ],
      },
      {
        title: "Three trainers",
        items: [
          "<b>TRL</b> — HuggingFace's official library, most stable",
          "<b>Axolotl</b> — YAML-driven, rich options",
          "<b>Unsloth</b> — 2~4x faster, memory-efficient",
        ],
      },
      {
        title: "Three training methods",
        items: [
          "<b>LoRA</b> — Train adapters only. Fast, memory-efficient (recommended)",
          "<b>QLoRA</b> — 4-bit quantization + LoRA. Minimum VRAM",
          "<b>Full FT</b> — Train all parameters. Needs large VRAM",
        ],
      },
      {
        title: "AutoResearch",
        items: [
          "Sweeps hyperparameter combinations to find the best settings",
          "You specify max trials, steps per trial, and final epochs",
          "Recommended if you don't have hand-tuning experience",
        ],
      },
      {
        title: "Caveats",
        type: "warn",
        items: [
          "Not enough GPU VRAM → training fails with OOM. Switch to QLoRA or a smaller model",
          "Too many epochs can overfit (3~5 is usually enough)",
        ],
      },
      {
        title: "Ready for the next step?",
        type: "tip",
        items: [
          "Once training reaches 'Complete' → manage and download the model in <b>Step 7 — Training Results</b>",
        ],
      },
    ],
  },

  step7: {
    label: "7. Training Results",
    heading: "Step 7 — Training Results",
    lead: "Manage the metrics and artifacts of completed training jobs. Direct links to LoRA adapter merging, model download, and chat testing.",
    sections: [
      {
        title: "Why this step matters",
        items: [
          "A trained model isn't just a file — it's an <b>asset you keep managing</b>",
          "Adapter merging, download, deletion — the whole model lifecycle lives here",
        ],
      },
      {
        title: "Workflow",
        type: "list",
        items: [
          "<b>① Filter by status</b> — All / Complete / Cancelled / Failed",
          "<b>② Click a card to expand</b> — Loss curve, training settings, save path",
          "<b>③ Take action</b> — Download / Merge / Chat test / Delete",
        ],
      },
      {
        title: "The five main actions",
        items: [
          "<b>Model/adapter download</b> — LoRA adapter (small) or full merged model file",
          "<b>LoRA merge</b> — Merge base model + adapter into a single model (live progress)",
          "<b>LoRA usage guide</b> — Python sample code for loading the adapter externally",
          "<b>Chat test</b> — Jump directly to the Chat Test page",
          "<b>Delete</b> — Clean up unused jobs",
        ],
      },
      {
        title: "What you can inspect",
        items: [
          "Final / best loss values and the learning curve",
          "Training settings (epochs · LR · batch size · LoRA R/Alpha etc.)",
          "AutoResearch per-trial table (loss · step · duration for each trial)",
          "Saved checkpoint path",
        ],
      },
      {
        title: "Tips",
        type: "tip",
        items: [
          "LoRA adapters are usually only tens of MB — easy to download and share",
          "For external use, 'Merge' into a single model file, then deploy",
        ],
      },
      {
        title: "Ready for the next step?",
        type: "tip",
        items: [
          "For objective scores → <b>Step 8 — Model Evaluation</b>",
          "To chat with the model directly → <b>Step 9 — Chat Test</b>",
        ],
      },
    ],
  },

  step8: {
    label: "8. Evaluation",
    heading: "Step 8 — Model Evaluation",
    lead: "Measure the fine-tuned model's performance with quantitative metrics (BLEU/ROUGE/Perplexity/LLM Judge) and standard benchmarks.",
    sections: [
      {
        title: "Why this step matters",
        items: [
          "Subjective impressions aren't enough to judge one model against another",
          "Objective scores tell you how to improve your training setup and whether it's ready to deploy",
        ],
      },
      {
        title: "Workflow",
        type: "list",
        items: [
          "<b>① Pick a tab</b> — 'Basic Evaluation' or 'Benchmark Evaluation'",
          "<b>② Pick a model/dataset/options</b> — Toggle 'LLM Judge' for extra scoring by an LLM",
          "<b>③ Click 'Start Evaluation'</b> — Live progress, 'Stop' anytime",
          "<b>④ Review results</b> — Scores plus a scored sample of answers",
        ],
      },
      {
        title: "Basic metrics",
        items: [
          "<b>BLEU</b> — n-gram overlap between the reference and the model output",
          "<b>ROUGE-1/2/L</b> — Model output recall vs. the reference (good for summarization)",
          "<b>Perplexity</b> — The model's language prediction uncertainty (lower is better)",
          "<b>LLM Judge</b> — An LLM scores response quality directly",
        ],
      },
      {
        title: "Benchmark evaluation",
        items: [
          "Supported benchmarks: <b>MMLU · ARC-Easy/Challenge · HellaSwag · TruthfulQA · GSM8K · WinoGrande · Ko-MMLU · KLUE</b>",
          "Multi-select benchmarks and compare with bar / radar charts",
        ],
      },
      {
        title: "Caveats",
        type: "warn",
        items: [
          "The benchmark backend (lm-evaluation-harness) integration is currently in progress",
        ],
      },
      {
        title: "Tips",
        type: "tip",
        items: [
          "Evaluate several training jobs to see at a glance which settings worked best",
        ],
      },
      {
        title: "Ready for the next step?",
        type: "tip",
        items: [
          "To feel the response quality and voice too → <b>Step 9 — Chat Test</b>",
        ],
      },
    ],
  },

  step9: {
    label: "9. RAG DB",
    heading: "Step 9 — RAG DB Creation",
    lead: "Pick uploaded documents and build a searchable vector DB (RAG DB). In the next step 'Chat Test' you can select this DB so the model answers with documents as the source.",
    sections: [
      {
        title: "What RAG is",
        type: "flow",
        items: [
          "<b>Retrieval-Augmented Generation</b> — Retrieve document chunks semantically similar to the user's question, then feed those chunks to the LLM as context",
          "Makes the model answer with grounded facts from documents outside its training knowledge, <b>drastically reducing hallucination</b>",
          "NELLA uses <b>BGE-M3</b> for chunk embeddings and <b>ChromaDB</b> as the vector store",
        ],
      },
      {
        title: "Why multiple RAG DBs",
        items: [
          "Splitting collections by purpose ('Internal manuals', 'Regulations', 'Technical docs') improves retrieval precision",
          "Conversations targeted at a single domain make the model <b>more context-focused</b>",
          "You can A/B test answer quality across different DBs",
        ],
      },
      {
        title: "Workflow",
        type: "list",
        items: [
          "<b>① Confirm documents are uploaded</b> — Only documents that finished text extraction can be indexed",
          "<b>② Click '+ New RAG DB'</b> — Name, describe, and check the documents to include",
          "<b>③ Indexing runs immediately</b> — Chunks → BGE-M3 embeddings → stored in ChromaDB",
          "<b>④ Edit / Reindex / Delete</b> — Manage any time from the card's buttons",
        ],
      },
      {
        title: "Management tips",
        type: "tip",
        items: [
          "When a document changes, <b>Reindex</b> to rebuild the chunks (same after swapping the embedding model)",
          "Deleting an unused collection removes it from Chroma too, freeing disk",
          "Go to <b>Chat Test</b> next, turn on <b>Use RAG</b>, and try chatting with the DB you just made",
        ],
      },
    ],
  },

  step10: {
    label: "10. Chat Test",
    heading: "Step 10 — Chat Test",
    lead: "Chat live with your trained local model or an external API model to verify response quality. Attach the RAG DB you made earlier for document-grounded answers.",
    sections: [
      {
        title: "Why this step matters",
        items: [
          "BLEU/ROUGE scores can't capture <b>voice, style, and real answer quality</b> — you have to feel it yourself",
          "Swap between the base model and the fine-tuned model to feel the training's effect",
        ],
      },
      {
        title: "Four chat modes",
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
          "Check any RAG DB from Step 9 and RAG turns on automatically (untouched = off)",
          "Multiple DBs can be checked; retrieval results are re-ranked by score",
          "Effective at reducing hallucination on factual questions",
          "If no RAG DB exists, a <b>'Create in Step 9'</b> link appears",
        ],
      },
      {
        title: "Workflow",
        type: "list",
        items: [
          "<b>① Pick a chat mode and model</b> — Local models may take a while for initial loading",
          "<b>② (Optional) Toggle RAG + pick a RAG DB</b> — Enable when you need document grounding",
          "<b>③ Wait for 'Ready' then type your message</b>",
          "<b>④ Compare responses</b> — Base ↔ fine-tuned, RAG ON/OFF, to feel the training and retrieval effects",
        ],
      },
      {
        title: "Generation options",
        items: [
          "<b>Temperature</b> — Higher is more diverse, lower is more consistent and conservative",
          "<b>Max tokens</b> — Response length cap",
          "<b>System prompt</b> — Tell the model its role",
        ],
      },
      {
        title: "Wrap-up",
        type: "tip",
        items: [
          "Getting here completes one full NELLA pipeline cycle.",
          "Not satisfied? Try again with different data validation, base model, hyperparameters, or RAG DB configuration",
        ],
      },
    ],
  },
};
