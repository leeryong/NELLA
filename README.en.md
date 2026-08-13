# NELLA

<div align="right">

[한국어](README.md) | **English**

</div>

<div align="center">
  <img src="assets/NELLA_Concept_Main.png" alt="NELLA Logo" width="800"/>
  <p>
    <img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg">
    <img alt="Windows" src="https://img.shields.io/badge/Windows-installer-0078D6?logo=windows&logoColor=white">
    <img alt="Docker" src="https://img.shields.io/badge/docker-%230db7ed.svg?logo=docker&logoColor=white">
    <img alt="Python" src="https://img.shields.io/badge/python-3.11+-3670A0?logo=python&logoColor=ffdd54">
  </p>
</div>

---

<div align="center">

## Your own AI model, built for you — **NELLA**

#### Upload your documents. Then just say the word.

</div>

```
👤  Build a model from these papers

🤖  Here's the plan. Shall I start?
      Generate 500 training pairs → validate quality → fine-tune Qwen2.5-1.5B → evaluate

👤  Go ahead

🤖  ✅ Done. Would you like to chat with the model?
```

**You don't need to know how AI models are built.**
Data preparation, model selection, hyperparameters — **NELLA takes care of it.** Just approve each step.

<div align="center">

| Who it's for | |
| --- | --- |
| 📚 **Researchers** | A dedicated model trained on your papers and experiment notes |
| 🏛️ **Organizations** | An assistant that knows your internal policies and manuals, built in your own environment |
| 🎓 **Educators & students** | Course-material study assistants, and hands-on practice with the full LLMOps pipeline |

</div>

<div align="center">

**[⬇️ Download for Windows](https://github.com/leeryong/NELLA/releases/latest)** · **[📺 Watch the demo](https://www.youtube.com/watch?v=NWvAksoe4dE)** · **[🛠️ Installation](#install)**

</div>

---

<a id="toc"></a>

## 📑 Contents

| Section | What's inside |
| --- | --- |
| [🆕 Latest News](#news) | Windows installer, TAW agent |
| [🎬 What you can do](#what) | Demo video and screenshots |
| [🗂️ Ten stages](#pipeline) | From document upload to chat testing |
| [🚀 Key Features](#features) | What gets automated |
| [✅ Before you start](#prepare) | API keys, GPU, and other prerequisites |
| [🛠️ Installation](#install) | Windows installer / Docker |
| [📞 Contact](#contact) | Get in touch |
| [👨‍💻 Development Team](#team) | KISTI BLUESKY Team |
| [📚 Built with](#oss) | Open source we use |

---

<a id="news"></a>

## 🆕 Latest News

> ### 🪟 Now installable with a **Windows installer**!
>
> You can run **NELLA** without Docker. Just download the installer and run it — no Python, Node.js, or Docker setup required.
>
> ➡️ **[Download the NELLA Windows installer](https://github.com/leeryong/NELLA/releases/latest)** (Windows 10/11, 64-bit)

> ### 🌐 Now on **TAW** — meet it as an agent!
>
> **NELLA** has joined **[The Agents Web (TAW)](https://github.com/leeryong/The_Agents_Web_TAW/blob/main/README.md)** as an **agent**. No install needed — with a single **TAW Browser**, meet it **anywhere on PC or mobile** (Windows · macOS · Linux · iOS · Android), via **chat or its web app**.
>
> ➡️ **[The Agents Web (TAW)](https://github.com/leeryong/The_Agents_Web_TAW/blob/main/README.md)** · 🌌 **[KISTI · BLUESKY](https://github.com/leeryong/KISTI_BLUESKY)**

<div align="right"><a href="#toc">▲ Back to contents</a></div>

---

<a id="what"></a>

## 🎬 What you can do

<div align="center">

<h3>
  <a href="https://www.youtube.com/watch?v=NWvAksoe4dE"
     style="text-decoration: none; color: inherit;">
    📺 Demo Video (click to watch)
  </a>
</h3>

<a href="https://www.youtube.com/watch?v=NWvAksoe4dE">
  <img src="assets/main.png"
       alt="NELLA Demo Video"
       width="90%"
       style="border: 1.5px solid #333; border-radius: 8px; box-shadow: 0 3px 8px rgba(0,0,0,0.25);" />
</a>

</div>

<table>
<tr>
<td width="50%" align="center">

### 💬 An agent you delegate model building to via chat
<img src="assets/img1.png" alt="Agent Chat" width="400"/>

<div align="left">
• Runs the entire pipeline automatically from a natural-language request<br>
• Check progress and give revision instructions in the in-workspace chat
</div>

</td>
<td width="50%" align="center">

### 📄 An agent that turns documents into training data
<img src="assets/img2.png" alt="Data Generation" width="400"/>

<div align="left">
• Automatically converts various formats such as PDF, DOCX, and HWP<br>
• Automatically synthesizes document-based datasets
</div>

</td>
</tr>
<tr>
<td width="50%" align="center">

### ⚙️ An agent that handles model training for you
<img src="assets/img3.png" alt="Auto Tuning" width="400"/>

<div align="left">
• Automatically sets hyperparameters and selects the training method<br>
• Automatically proposes data augmentation and retraining based on evaluation results
</div>

</td>
<td width="50%" align="center">

### ✅ An agent that evaluates and improves results
<img src="assets/img4.png" alt="Evaluation" width="400"/>

<div align="left">
• Supports diverse evaluation metrics such as BLEU, ROUGE, and LLM Judge<br>
• Chat-test the finished model right away
</div>

</td>
</tr>
</table>

<div align="right"><a href="#toc">▲ Back to contents</a></div>

---

<a id="pipeline"></a>

## 🗂️ Ten stages, start to finish

From uploading a document to chatting with the finished model, NELLA runs the stages below.
Work through them **screen by screen**, or hand the whole thing to the agent **in one request**.

```
📄 Documents → 📝 Training data → 🔍 Validation → 🤖 Model choice → 🧪 Pre-check
                                                                        ↓
    💬 Chat test ← 📚 RAG DB ← 📊 Evaluation ← 📈 Results ← ⚙️ Training
```

| Stage | What it does | What it means |
| --- | --- | --- |
| **1. Document Upload** | Extract text from PDF · DOCX · HWP | Makes your material readable |
| **2. Training Data Generation** | Synthesize QA / DPO data from documents | Turns documents into a **workbook** |
| **3. Data Validation** | Rule- and LLM-based quality filtering | **Weeds out** bad questions |
| **4. Base Model Selection** | Search and download HuggingFace models | Picks the **base model** to train |
| **5. Model Validation** | Scout-based prediction of promising models | **Predicts how well** each model will learn |
| **6. Model Training** | SFT · DPO · AutoResearch fine-tuning | Actually **teaches** the model |
| **7. Training Results** | Learning curves, LoRA merge and download | **Checks** how well it learned |
| **8. Model Evaluation** | BLEU · ROUGE · Perplexity · LLM Judge | **Grades** the result |
| **9. RAG DB Management** | Build a document vector DB (ChromaDB) | Lets it answer **open-book**, citing your documents |
| **10. Chat Test** | Talk to the trained model and RAG DB | **Chat** with what you built |

> 💡 The in-app **"Open guide"** button walks you through each stage in detail.

<div align="right"><a href="#toc">▲ Back to contents</a></div>

---

<a id="features"></a>

## 🚀 Key Features

- **Web UI–embedded NELLA agent**: Request model building, check progress, and give revision instructions via chat — all without leaving the workspace
- **Automatic training-data generation**: Automatically synthesizes SFT/DPO training data from document content and creates purpose-fit datasets
- **Data quality validation**: Reviews duplicate, low-quality, and malformed data and refines it into a dataset suitable for training
- **Automatic base-model recommendation**: Recommends and compares suitable base models considering multiple factors such as purpose, data scale, and local resources
- **Automatic hyperparameter tuning**: Automatically recommends and adjusts settings such as LoRA/QLoRA, epochs, and learning rate to match the training objective and evaluation results
- **Natural-language pipeline orchestration**: Analyzes the user's objective to automatically plan a 10-stage LLMOps pipeline and execute it step by step
- **Human-in-the-Loop**: The agent proposes a plan and you approve it — automation and control at the same time

<div align="right"><a href="#toc">▲ Back to contents</a></div>

---

<a id="prepare"></a>

## ✅ Before you start

| What | Why it's needed | Without it |
| --- | --- | --- |
| **LLM API key**<br>(OpenAI or Anthropic) | Used for training-data generation and evaluation | Stages 2, 3 and 8 are limited |
| **NVIDIA GPU** | Used for model training and inference | Document processing and data generation still work; training does not |
| **HuggingFace token** | Downloading gated models such as Llama and Gemma | Only ungated models are available |

- Register the API key from the **"LLM Settings"** screen after installing — no code changes needed.
- Small models can be trained from **8 GB of VRAM**; **24 GB** is recommended for 13B-class models.

<div align="right"><a href="#toc">▲ Back to contents</a></div>

---

<a id="install"></a>

## 🛠️ Installation

Pick either option. **On Windows, the installer is recommended.**

### Option 1 — Windows installer (recommended)

No Docker, no Python. Download one file and run it.

1. Download `NELLA-Setup-0.1.0.exe` from the **[releases page](https://github.com/leeryong/NELLA/releases/latest)**
2. Run the downloaded file (no administrator rights needed — it installs into your user folder)
3. Launch it from the **NELLA** desktop shortcut

- **Requirements**: Windows 10/11, 64-bit
- **GPU training**: CPU mode by default. If you have an NVIDIA GPU, add the CUDA training stack from *Settings → Install GPU training* in the app (~3 GB download, ~8 GB on disk after install). Restart the app afterwards to activate the GPU.

### Option 2 — Docker (Windows · macOS · Linux)

Everything needed to run NELLA is provided as Docker containers. With no separate Python or Node.js setup required, you can run NELLA with just a few commands as long as Docker is installed.

```bash
git clone https://github.com/leeryong/NELLA.git
cd NELLA/nella_source
docker compose up -d --build
```

The initial build takes 10–20 minutes to install dependencies. Once complete, open [http://localhost:3001](http://localhost:3001) to start using NELLA right away.

<div align="right"><a href="#toc">▲ Back to contents</a></div>

---

<a id="contact"></a>

## 📞 Contact
- Ryong Lee (ryonglee@kisti.re.kr)

---

<a id="team"></a>

## 👨‍💻 Development Team

KISTI **BLUESKY** Team — *Harmonizing Human and AI Collaboration* · [github.com/leeryong/KISTI_BLUESKY](https://github.com/leeryong/KISTI_BLUESKY)

- Ryong Lee (ryonglee@kisti.re.kr)
- Raeyoung Jang (raezero@kisti.re.kr)
- Jahyun Gu (jahyeongu@kisti.re.kr)

---

<a id="oss"></a>

## 📚 Built with
- [Ollama](https://github.com/ollama/ollama)
- [Hugging Face Transformers](https://github.com/huggingface/transformers)
- [PEFT](https://github.com/huggingface/peft)
- [TRL](https://github.com/huggingface/trl)
- [Docling](https://github.com/DS4SD/docling)
- [ChromaDB](https://github.com/chroma-core/chroma)
- [vLLM](https://github.com/vllm-project/vllm)

<div align="right"><a href="#toc">▲ Back to contents</a></div>
