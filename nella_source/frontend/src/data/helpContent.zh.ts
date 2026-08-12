import type { HelpEntry } from "./helpContent";

export const helpContent_zh: Record<string, HelpEntry> = {
  documents: {
    pageTitle: "文档上传",
    summary: "上传 PDF·DOCX·HWP 文档并提取文本 (以及图片)。提取的文本将用于下一步「训练数据生成」。",
    sections: [
      {
        title: "支持格式",
        items: [
          "支持 <b>PDF</b> / <b>DOCX</b> / <b>HWP</b> 上传",
          "同时上传多个文件时,会在队列中按顺序处理",
        ],
      },
      {
        title: "文本提取方式",
        items: [
          "<b>openDataLoader</b> (默认) — 统一处理 PDF·DOCX·HWP,支持图片提取",
          "<b>MarkItDown</b> — 针对 Markdown 转换优化",
          "<b>PyPDF</b> — 仅支持 PDF 的文本提取",
          "<b>Docling</b> — 支持 GPU/MPS 加速,表格与图片识别出色",
        ],
      },
      {
        title: "使用方法",
        items: [
          "先选择提取方式和「同时提取图片」选项,再上传文件",
          "处理状态和进度实时显示",
        ],
      },
      {
        title: "注意事项",
        items: [
          "扫描 PDF 的结果质量因提取器而异",
          "大文件的处理时间可能较长",
        ],
      },
    ],
  },

  dataGeneration: {
    pageTitle: "训练数据生成",
    summary: "基于提取的文档或上传的 JSONL,由 LLM 自动生成训练用的问答数据。",
    sections: [
      {
        title: "数据类型",
        items: [
          "<b>QA (SFT)</b> — 普通问答对",
          "<b>CoT</b> (Chain-of-Thought) — 包含逐步推理过程",
          "<b>ToT</b> (Tree-of-Thought) — 分支搜索型推理数据",
          "<b>GoT</b> (Graph-of-Thought) — 图结构推理数据",
          "<b>DPO</b> — 偏好/非偏好回答对 (用于偏好学习)",
        ],
      },
      {
        title: "生成选项",
        items: [
          "来源: <b>选择文档</b> 或 <b>上传 JSONL</b>",
          "指定生成对数与训练:测试拆分比",
          "选择 LLM 提供商: 默认 · OpenAI · Anthropic · Ollama",
          "可直接编辑系统/用户提示词以控制生成风格",
        ],
      },
      {
        title: "查看结果",
        items: [
          "生成进度实时显示",
          "完成后可在预览对话框中查看训练/测试样本的前 10 条",
          "建议先在下一步「数据验证」中评估质量后再用于训练",
        ],
      },
    ],
  },

  dataValidation: {
    pageTitle: "训练数据验证",
    summary: "使用规则或 LLM 对生成的训练数据进行评分,过滤低质量样本。",
    sections: [
      {
        title: "基于 LLM 的验证",
        items: [
          "使用 LLM (OpenAI·Anthropic·Ollama) 作为评估者",
          "可选择评估全部数据,或仅评估代表样本",
          "按 5 项标准打分: <b>准确性·相关性·清晰度·完整性·多样性</b>",
          "发现的问题会附带严重度 (高/中/低) 显示",
        ],
      },
      {
        title: "基于规则的验证",
        items: [
          "按回答长度、重复、低质量项自动过滤",
          "提供去除不达标项的选项",
          "快速且免费",
        ],
      },
      {
        title: "使用方法",
        items: [
          "选择数据类型 (QA/DPO) 与数据集",
          "设置评估方式与选项后,点击「开始评估」",
          "运行过程中可随时通过「中止」停止",
        ],
      },
      {
        title: "结果与后续步骤",
        items: [
          "总分 (10 分制) 与各项分数以雷达/柱状图可视化",
          "高质量标准的通过率一目了然",
          "自动生成「验证数据集」,可在训练步骤中选用",
          "验证历史随时可再次查看",
        ],
      },
    ],
  },

  modelSelection: {
    pageTitle: "基础模型选择",
    summary: "从 HuggingFace 搜索并下载作为微调起点的预训练模型。",
    sections: [
      {
        title: "两种模型来源",
        items: [
          "<b>精选模型</b> — NELLA 事先验证的推荐模型 (支持按尺寸/排序过滤)",
          "<b>HuggingFace 最新模型</b> — 从 Hub 按热度/点赞/最新排序搜索",
        ],
      },
      {
        title: "过滤/排序选项",
        items: [
          "尺寸: 小型 (&lt;2B)·中小 (2~7B)·中型 (7~13B)",
          "排序: 热度·点赞数·最新·最旧·尺寸升序/降序",
        ],
      },
      {
        title: "下载",
        items: [
          "下载进度实时显示在右下面板",
          "下载中可以「取消」",
          "已完成的模型会出现在顶部「我的模型」中,可进行对话测试或删除",
        ],
      },
      {
        title: "需要许可协议同意的模型",
        items: [
          "Llama、Gemma 系列需要先在 HuggingFace 同意许可协议",
          "在设置中注册 <code>HF_TOKEN=hf_...</code> 后可使用",
        ],
      },
    ],
  },

  modelValidation: {
    pageTitle: "模型验证",
    summary: "分析候选基础模型的内部反应,在微调前预测并选择有潜力的模型。(Beta)",
    sections: [
      {
        title: "两种预测方式",
        items: [
          "<b>方式 A — 基于最终分数</b>: 测量当前分数 + 预测提升率,精确但耗时。",
          "<b>方式 B — 基于提升率</b>: 仅预测提升率 (%),速度快。",
        ],
      },
      {
        title: "使用流程",
        items: [
          "选择评估用 SFT 数据集 (多选时自动合并)",
          "勾选要比较的候选模型,或直接添加 HuggingFace 模型 ID",
          "指定验证样本数与 LLM 评估者 (方式 A),然后点击「开始验证」",
        ],
      },
      {
        title: "下一步",
        items: [
          "排名第一的模型会标记为「最佳选择」",
          "可用选中的模型在「模型训练」中直接开始微调",
        ],
      },
    ],
  },

  training: {
    pageTitle: "模型训练",
    summary: "使用选定的基础模型和训练数据执行微调。支持手动设置与 AutoResearch (超参数自动搜索)。",
    sections: [
      {
        title: "训练工具",
        items: [
          "<b>TRL</b> — HuggingFace 官方库,最稳定",
          "<b>Axolotl</b> — 基于 YAML 配置,选项丰富",
          "<b>Unsloth</b> — 训练速度快 2~4 倍,内存效率高",
        ],
      },
      {
        title: "训练阶段",
        items: [
          "<b>SFT</b> — 监督微调 (问答学习)",
          "<b>DPO</b> — 基于偏好的优化",
        ],
      },
      {
        title: "训练方式",
        items: [
          "<b>LoRA</b> — 仅训练适配器,快速且省内存 (推荐)",
          "<b>QLoRA</b> — 4bit 量化 + LoRA,VRAM 需求最小",
          "<b>Full FT</b> — 训练全部参数,需要大 VRAM",
        ],
      },
      {
        title: "使用方法",
        items: [
          "设置数据集 (多选时自动合并)、基础模型、超参数",
          "如需可复制自动生成的命令在外部直接执行",
          "点击「开始训练」或「开始 AutoResearch」",
          "实时监控 loss 曲线与日志,可以「中止」",
        ],
      },
      {
        title: "AutoResearch",
        items: [
          "指定最大试验次数、单次步数、最终训练轮数",
          "自动搜索多种超参数组合以得出最佳设置",
        ],
      },
    ],
  },

  trainingResults: {
    pageTitle: "训练结果",
    summary: "管理已完成训练作业的指标与产物。可直接进行 LoRA 适配器合并、模型下载、对话测试。",
    sections: [
      {
        title: "状态过滤",
        items: [
          "可按全部·完成·已取消·失败标签对作业分类",
        ],
      },
      {
        title: "可查看的信息",
        items: [
          "最终/最佳损失值与学习曲线图",
          "训练设置 (轮数·学习率·批大小·LoRA R/Alpha 等)",
          "AutoResearch 每次试验的结果表 (loss·step·耗时)",
          "已保存的检查点路径",
        ],
      },
      {
        title: "主要操作",
        items: [
          "<b>模型/适配器下载</b> — 下载 LoRA 适配器或完整模型文件",
          "<b>LoRA 合并</b> — 将基础模型 + 适配器合并为单一模型 (通过 SSE 显示进度)",
          "<b>LoRA 使用指南</b> — 提供在外部加载适配器的 Python 示例代码",
          "<b>对话测试</b> — 直接跳转到「对话测试」页面",
        ],
      },
    ],
  },

  evaluation: {
    pageTitle: "模型评估",
    summary: "通过定量指标 (BLEU·ROUGE·Perplexity·LLM Judge) 与标准基准测量微调后模型的性能。",
    sections: [
      {
        title: "基础评估",
        items: [
          "选择已完成的训练作业",
          "指定测试数据",
          "打开 <b>LLM 审阅</b> 时,由 LLM 额外为回答质量打分",
          "开始评估后进度实时显示,可以「停止」",
        ],
      },
      {
        title: "指标说明",
        items: [
          "<b>BLEU</b> — 参考与输出的 n-gram 一致度",
          "<b>ROUGE-1/2/L</b> — 输出相对于参考的召回率 (用于摘要质量评估)",
          "<b>Perplexity</b> — 模型的语言预测不确定性 (越低越好)",
          "<b>LLM Judge</b> — 由 LLM 直接为回答质量打分",
        ],
      },
      {
        title: "基准评估",
        items: [
          "使用本地保存的模型 + 多选基准计算标准分数",
          "支持: <b>MMLU·ARC-Easy/Challenge·HellaSwag·TruthfulQA·GSM8K·WinoGrande·Ko-MMLU·KLUE</b>",
          "结果以柱状/雷达图和分数表显示,可与过往记录对比",
        ],
      },
    ],
  },

  ragDb: {
    pageTitle: "RAG DB 创建",
    summary: "从已上传的文档中选择需要的文档,构建可检索的向量 DB (RAG DB)。可按名称创建多个 RAG DB,在下一步「对话测试」中选择所需的使用。",
    sections: [
      {
        title: "什么是 RAG DB",
        items: [
          "将文档文本按块 (chunk) 切分,使用 <b>BGE-M3</b> 嵌入向量化后存入 <b>ChromaDB</b>",
          "在对话中提取与用户问题语义相近的块作为上下文的 <b>Retrieval-Augmented Generation</b> 方法",
          "使模型基于文档 (内部手册·最新文档等) 回答其训练知识以外的问题",
        ],
      },
      {
        title: "创建方法",
        items: [
          "通过右上角 <b>+ 新建 RAG DB</b> 按钮,输入名称·描述并选择要包含的文档来创建",
          "创建后所选文档立刻被嵌入并索引到向量 DB 中",
          "可按目的 (例如:「技术文档」、「法规」、「内部规定」) 分别管理多个 RAG DB",
        ],
      },
      {
        title: "管理操作",
        items: [
          "<b>编辑文档</b> — 在现有 RAG DB 中新增/移除文档 (移除时仅删除该文档的块)",
          "<b>重新索引</b> — 文档内容更改或想重新生成嵌入时全量重建",
          "<b>删除</b> — 删除 RAG DB 时,Chroma 集合也会同时移除",
        ],
      },
      {
        title: "与对话测试的连接",
        items: [
          "打开「对话测试」页面的 <b>使用 RAG</b> 开关,会出现 RAG DB 下拉框",
          "从本页面创建的 RAG DB 中选一个用于对话",
          "可通过多个 RAG DB 比较回答质量进行实验",
        ],
      },
    ],
  },

  chat: {
    pageTitle: "对话测试",
    summary: "与已训练的本地模型或外部 API 模型进行实时对话,验证响应质量。可同时使用 RAG (基于文档检索的回答)。",
    sections: [
      {
        title: "对话方式",
        items: [
          "<b>本地模型</b> — 选择已下载或已训练模型,亦可直接输入路径",
          "<b>OpenAI</b> — GPT 系列（模型列表通过 API 密钥自动获取）",
          "<b>Anthropic</b> — Claude Sonnet·Haiku·Opus 系列",
          "<b>Ollama</b> — 通过本地 Ollama 服务器推理",
        ],
      },
      {
        title: "RAG 模式",
        items: [
          "打开开关时,已上传文档会从 VectorDB 中被检索并用作回答上下文",
          "对基于事实的问题可有效降低幻觉",
        ],
      },
      {
        title: "使用方法",
        items: [
          "选择对话方式与模型 (本地模型首次加载可能耗时较长)",
          "状态显示为「准备完成」后,输入消息开始对话",
          "可以在基础模型与微调模型之间切换以比较回复差异",
        ],
      },
    ],
  },

  llmSettings: {
    pageTitle: "LLM 设置",
    summary: "配置用于训练数据生成、验证、评估的外部 LLM 提供商、API 密钥和默认模型。",
    sections: [
      {
        title: "支持的提供商",
        items: [
          "<b>OpenAI</b> — GPT-4o·GPT-4o-mini 等",
          "<b>Anthropic</b> — Claude Sonnet·Haiku·Opus 系列",
          "<b>Ollama</b> — 本地 LLM (Llama·Mistral 等)",
        ],
      },
      {
        title: "设置方法",
        items: [
          "API 密钥可在此页面或 <code>.env</code> 文件中注册",
          "选择提供商和模型后点击「保存」,立即生效",
          "使用 Ollama 时需要本地 Ollama 服务器处于运行状态",
        ],
      },
      {
        title: "按用途推荐",
        items: [
          "数据生成: 推荐性价比高的 GPT-4o-mini 或 Claude Haiku",
          "数据验证·LLM Judge: 精度重要,推荐 GPT-4o 或 Claude Sonnet",
        ],
      },
    ],
  },
};
