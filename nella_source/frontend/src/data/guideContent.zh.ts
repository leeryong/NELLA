import type { TabText } from "./guideContent";

export const guideText_zh: Record<string, TabText> = {
  intro: {
    label: "开始使用",
    heading: "欢迎使用 NELLA",
    lead: "只要给它文档,它就自动帮您构建模型。NELLA 是一个 10 步 LLMOps 流水线,可从 PDF·DOCX·HWP 文档生成训练数据,并完成模型的微调、评估和部署。",
    sections: [
      {
        title: "NELLA 自动化的 10 个步骤",
        type: "flow",
        items: [
          "<b>1. 文档上传</b> — 从 PDF·DOCX·HWP 提取文本",
          "<b>2. 训练数据生成</b> — 从文档自动生成 QA·DPO 训练数据",
          "<b>3. 数据验证</b> — 基于规则/LLM 的质量评估",
          "<b>4. 基础模型选择</b> — 搜索并下载 HuggingFace 模型",
          "<b>5. 模型验证</b> — 基于 Scout 预测最有潜力的模型",
          "<b>6. 模型训练</b> — SFT·DPO·AutoResearch 微调",
          "<b>7. 训练结果</b> — 合并并下载 LoRA 适配器",
          "<b>8. 模型评估</b> — 测量 BLEU·ROUGE·基准指标",
          "<b>9. RAG DB 创建</b> — 构建基于文档的向量 DB (ChromaDB)",
          "<b>10. 对话测试</b> — 与已训练模型直接对话 (可选用 RAG DB)",
        ],
      },
      {
        title: "开始前建议准备的内容",
        type: "list",
        items: [
          "<b>LLM API 密钥</b> — 用于训练数据生成与评估 (OpenAI 或 Anthropic)。在 <code>.env</code> 或「LLM 设置」页面注册",
          "<b>HuggingFace 令牌</b> — 下载 Llama·Gemma 等需许可模型时必需。<code>HF_TOKEN=hf_...</code>",
          "<b>GPU</b> — 微调与推理必需。8GB VRAM 起可训练小型模型,13B 级建议 24GB 以上",
        ],
      },
      {
        title: "本指南使用方法",
        type: "tip",
        items: [
          "点击左侧标签跳转各步骤,或使用底部「上一页/下一页」按顺序阅读",
          "每步末尾有「前往此页面」按钮,可以直接进入操作",
          "各页面右上角的「帮助」按钮可再次查看该页面简短的帮助内容",
        ],
      },
    ],
  },

  step1: {
    label: "1. 文档上传",
    heading: "步骤 1 — 文档上传",
    lead: "上传用于训练的 PDF·DOCX·HWP 文档并提取文本。提取的文本将作为下一步的原始数据。",
    sections: [
      {
        title: "为什么需要这一步",
        items: [
          "NELLA 从文档自动生成训练数据,所以<b>好模型从好文档开始</b>",
          "提取质量差会让后续所有步骤的结果质量一起下降",
        ],
      },
      {
        title: "使用流程",
        type: "list",
        items: [
          "<b>① 选择提取方式</b> — 在顶部按钮中选择 openDataLoader / MarkItDown / PyPDF / Docling",
          "<b>② 勾选选项</b> — 图片较多的文档请勾选「同时提取图片」(openDataLoader·Docling 支持)",
          "<b>③ 上传文件</b> — 拖放或点击选择 PDF·DOCX·HWP 文件 (可多个同时)",
          "<b>④ 监控进度</b> — 下方列表实时显示进度,完成的文档可通过「预览」检查提取结果",
          "<b>⑤ 如需可重新提取</b> — 结果不满意时,可用另一种提取器「重新提取」",
        ],
      },
      {
        title: "四种提取方式",
        items: [
          "<b>openDataLoader</b> (默认) — 统一处理 PDF·DOCX·HWP,支持图片提取",
          "<b>MarkItDown</b> — 针对 Markdown 转换优化",
          "<b>PyPDF</b> — 仅支持 PDF 的轻量提取器",
          "<b>Docling</b> — 支持 GPU/MPS 加速,表格与图片识别出色",
        ],
      },
      {
        title: "注意事项",
        type: "warn",
        items: [
          "扫描版图像 PDF 的结果因提取器而异较大 — 请比较多种提取器",
          "较大文件 (数十 MB 以上) 处理时间较长",
        ],
      },
      {
        title: "前往下一步",
        type: "tip",
        items: [
          "至少一个文档达到「提取完成」→ 进入<b>步骤 2 训练数据生成</b>",
        ],
      },
    ],
  },

  step2: {
    label: "2. 训练数据生成",
    heading: "步骤 2 — 训练数据生成",
    lead: "基于提取的文档或上传的 JSONL,由 LLM 自动生成训练用的问答数据。",
    sections: [
      {
        title: "为什么需要这一步",
        items: [
          "模型微调需要<b>清洁的问答对</b>",
          "NELLA 通过 LLM (OpenAI·Anthropic·Ollama) 从文档自动生成训练数据,大幅节省时间",
        ],
      },
      {
        title: "使用流程",
        type: "list",
        items: [
          "<b>① 选择数据源</b> — 「选择文档」标签或「上传 JSONL」标签",
          "<b>② 选择数据类型</b> — QA(SFT)·CoT·ToT·GoT·DPO 之一",
          "<b>③ 指定生成选项</b> — 生成对数、训练:测试拆分比、数据集名称",
          "<b>④ 选择 LLM 提供商</b> — 默认 / OpenAI / Anthropic / Ollama / Mock",
          "<b>⑤ (可选) 编辑提示词</b> — 直接调整系统/用户提示词以控制生成风格",
          "<b>⑥ 点击「生成训练数据」</b> — 实时显示进度,完成后可预览样本",
        ],
      },
      {
        title: "五种数据类型",
        items: [
          "<b>QA (SFT)</b> — 普通问答对,最基础",
          "<b>CoT</b> (Chain-of-Thought) — 包含逐步推理过程",
          "<b>ToT</b> (Tree-of-Thought) — 分支搜索型推理",
          "<b>GoT</b> (Graph-of-Thought) — 图结构推理",
          "<b>DPO</b> — 偏好/非偏好回答对 (用于偏好学习)",
        ],
      },
      {
        title: "小贴士",
        type: "tip",
        items: [
          "建议先用少量 (10~30 条) 生成,确认质量后再扩大",
          "如果担心成本,可选择 GPT-4o-mini 或 Claude Haiku 等低价模型",
        ],
      },
      {
        title: "注意事项",
        type: "warn",
        items: [
          "会产生 LLM API 调用费用 — 与生成对数成正比",
          "如果原始文档文本质量差,生成的数据质量也会随之下降",
        ],
      },
      {
        title: "前往下一步",
        type: "tip",
        items: [
          "生成的数据集出现后 → 进入<b>步骤 3 数据验证</b>再次检查质量",
        ],
      },
    ],
  },

  step3: {
    label: "3. 数据验证",
    heading: "步骤 3 — 训练数据验证",
    lead: "使用规则或 LLM 对生成的训练数据进行评分,过滤低质量样本。",
    sections: [
      {
        title: "为什么需要这一步",
        items: [
          "自动生成的数据质量参差不齐 — 训练前先筛选可使模型性能更稳定",
          "通过验证的数据会自动生成独立数据集,可直接用于下一步训练",
        ],
      },
      {
        title: "两种验证方式",
        items: [
          "<b>基于规则</b> — 按回答长度、重复、低质量项自动过滤。快速且免费",
          "<b>基于 LLM</b> — LLM (OpenAI·Anthropic·Ollama) 按 5 项标准打分。精度高但耗时且有成本",
        ],
      },
      {
        title: "LLM 评估的 5 项标准",
        items: [
          "<b>准确性</b>·<b>相关性</b>·<b>清晰度</b>·<b>完整性</b>·<b>多样性</b>",
          "总分 (10 分制) 与各项分数以雷达图和柱状图可视化",
          "发现的问题会附带严重度 (高/中/低) 显示",
        ],
      },
      {
        title: "使用流程",
        type: "list",
        items: [
          "<b>① 选择数据类型 (QA/DPO) 与数据集</b>",
          "<b>② 设置评估方式和选项</b> — 选择 LLM 评估者、全量或代表样本",
          "<b>③ 点击「开始评估」</b> — 运行过程中可随时「中止」",
          "<b>④ 查看结果</b> — 保留率 (%) 与各项分数、问题列表",
        ],
      },
      {
        title: "小贴士",
        type: "tip",
        items: [
          "如果担心时间/成本,使用「仅评估代表数据」对部分打分即可",
          "先用规则初筛,再用 LLM 精筛,是一种有效流程",
        ],
      },
      {
        title: "前往下一步",
        type: "tip",
        items: [
          "验证数据集已生成 → 进入<b>步骤 4 基础模型选择</b>",
        ],
      },
    ],
  },

  step4: {
    label: "4. 基础模型选择",
    heading: "步骤 4 — 基础模型选择",
    lead: "从 HuggingFace 搜索并下载作为微调起点的预训练模型。",
    sections: [
      {
        title: "为什么需要这一步",
        items: [
          "不必从零开始训练,而是以<b>已经聪明的预训练模型</b>作为起点",
          "基础模型选择是对最终质量影响最大的决定之一",
        ],
      },
      {
        title: "两种模型来源",
        items: [
          "<b>精选模型</b> — NELLA 事先验证过的推荐列表,支持按尺寸和排序过滤",
          "<b>HuggingFace 最新模型</b> — 从 Hub 全库按热度/点赞/最新排序搜索",
        ],
      },
      {
        title: "使用流程",
        type: "list",
        items: [
          "<b>① 选择标签</b> — 精选或 HuggingFace",
          "<b>② 搜索与过滤</b> — 按尺寸 (小型 &lt;2B / 中小 2~7B / 中型 7~13B) 或排序",
          "<b>③ 点击 Download</b> — 右下面板实时显示下载进度",
          "<b>④ 完成后自动注册</b> — 可在顶部「我的模型」中进行对话测试或删除",
        ],
      },
      {
        title: "需要许可协议同意的模型",
        type: "warn",
        items: [
          "<b>Llama、Gemma 系列</b>需要先同意 Meta·Google 许可协议才能下载",
          "在 <code>.env</code> 中注册 <code>HF_TOKEN=hf_...</code> 后再重新尝试下载",
        ],
      },
      {
        title: "不知道选哪个模型时",
        type: "tip",
        items: [
          "GPU VRAM 在 8GB 以下,请从 <b>1~2B</b> 开始",
          "更注重质量则尝试 <b>3B 以上</b>",
          "建议下载多个候选,并在下一步「模型验证」中比较",
        ],
      },
      {
        title: "前往下一步",
        type: "tip",
        items: [
          "至少下载一个候选模型 → 进入<b>步骤 5 模型验证</b>,或直接<b>步骤 6 模型训练</b>",
        ],
      },
    ],
  },

  step5: {
    label: "5. 模型验证",
    heading: "步骤 5 — 模型验证 (Beta)",
    lead: "使用 Scout 方法分析候选模型的内部反应,在不实际微调的情况下提前预测并选择最有潜力的模型。",
    sections: [
      {
        title: "为什么需要这一步",
        items: [
          "对所有候选模型都实际微调再比较,GPU 与时间成本非常高",
          "Scout 通过<b>模型内部激活指标</b>提前预测微调后的提升率,从而先行筛选候选",
        ],
      },
      {
        title: "工作原理",
        items: [
          "将训练数据的一部分 (默认 10%) 输入候选模型,只做一次推理 (不进行训练)",
          "从每层 transformer 中提取 <b>dispersion·attention_entropy·head_diversity</b> 指标",
          "使用 BGE-M3 嵌入 + Wasserstein 距离,将您的数据集与 6 个参考数据集匹配",
          "匹配到的参考的 RandomForest 回归模型预测候选的<b>微调提升率</b>",
        ],
      },
      {
        title: "两种预测方式",
        items: [
          "<b>方式 A — 基于最终分数</b>: 测量当前分数 + 预测提升率,推算训练后期望分数。精确但耗时",
          "<b>方式 B — 基于提升率</b>: 仅预测提升率 (%),速度快",
        ],
      },
      {
        title: "使用流程",
        type: "list",
        items: [
          "<b>① 选择评估用 SFT 数据集</b> — 多选时自动合并",
          "<b>② 勾选候选模型</b> — 已下载模型或直接添加 HuggingFace ID",
          "<b>③ 设置选项</b> — 评估样本数 (默认 10%),LLM 评估者 (方式 A)",
          "<b>④ 点击「开始验证」</b> — 显示按模型的排名表",
        ],
      },
      {
        title: "结果指标",
        items: [
          "<b>预测提升率 (%)</b>·<b>期望最终分数</b>·<b>LLM Judge 分数</b>·<b>推荐徽章 (推荐/一般/不推荐)</b>",
          "排名第一的模型会标记为「最佳选择」",
        ],
      },
      {
        title: "前往下一步",
        type: "tip",
        items: [
          "最佳选择模型确定后 → 在<b>步骤 6 模型训练</b>中使用该模型进行微调",
        ],
      },
    ],
  },

  step6: {
    label: "6. 模型训练",
    heading: "步骤 6 — 模型训练",
    lead: "使用选定的基础模型和训练数据执行微调。这是 NELLA 流水线的核心步骤。",
    sections: [
      {
        title: "为什么需要这一步",
        items: [
          "在这里终于诞生了<b>专属您的定制模型</b>",
          "可通过手动设置进行精细控制,或用 AutoResearch 自动搜索超参数",
        ],
      },
      {
        title: "使用流程",
        type: "list",
        items: [
          "<b>① 选择训练方式</b> — 手动 / AutoResearch",
          "<b>② 选择训练工具</b> — TRL·Axolotl·Unsloth",
          "<b>③ 选择数据集与基础模型</b> — 多个数据集自动合并",
          "<b>④ 指定训练阶段与方法</b> — SFT/DPO + LoRA/QLoRA/Full",
          "<b>⑤ 设置超参数</b> — 训练轮数、学习率、批大小等",
          "<b>⑥ 点击「开始训练」或「开始 AutoResearch」</b> — 实时监控 loss 曲线与日志",
        ],
      },
      {
        title: "三种训练工具",
        items: [
          "<b>TRL</b> — HuggingFace 官方库,最稳定",
          "<b>Axolotl</b> — 基于 YAML 配置,选项丰富",
          "<b>Unsloth</b> — 训练速度快 2~4 倍,内存效率高",
        ],
      },
      {
        title: "三种训练方式",
        items: [
          "<b>LoRA</b> — 仅训练适配器,快速且省内存 (推荐)",
          "<b>QLoRA</b> — 4bit 量化 + LoRA,VRAM 需求最小",
          "<b>Full FT</b> — 训练全部参数,需要大 VRAM",
        ],
      },
      {
        title: "AutoResearch",
        items: [
          "自动搜索多种超参数组合,得出最佳设置",
          "指定最大试验次数、单次步数、最终训练轮数",
          "手动调参经验不足时推荐使用",
        ],
      },
      {
        title: "注意事项",
        type: "warn",
        items: [
          "GPU VRAM 不足会因 OOM 导致训练失败 — 请切换到 QLoRA 或更小的模型",
          "训练轮数过多可能过拟合 (通常 3~5 轮足够)",
        ],
      },
      {
        title: "前往下一步",
        type: "tip",
        items: [
          "训练状态变为「完成」后 → 在<b>步骤 7 训练结果</b>中管理与下载模型",
        ],
      },
    ],
  },

  step7: {
    label: "7. 训练结果",
    heading: "步骤 7 — 训练结果",
    lead: "管理已完成训练作业的指标与产物。可直接进行 LoRA 适配器合并、模型下载、对话测试。",
    sections: [
      {
        title: "为什么需要这一步",
        items: [
          "训练完成的模型不只是一个文件,而是<b>需要持续管理的资产</b>",
          "适配器合并、下载、删除等模型全生命周期集中在此完成",
        ],
      },
      {
        title: "使用流程",
        type: "list",
        items: [
          "<b>① 按状态筛选作业</b> — 全部·完成·已取消·失败",
          "<b>② 点击卡片展开</b> — 查看 loss 曲线、训练设置、保存路径",
          "<b>③ 执行所需操作</b> — 下载 / 合并 / 对话测试 / 删除",
        ],
      },
      {
        title: "五项主要操作",
        items: [
          "<b>模型/适配器下载</b> — 下载 LoRA 适配器 (轻量) 或完整模型文件",
          "<b>LoRA 合并</b> — 将基础模型 + 适配器合并为单一模型 (实时进度)",
          "<b>LoRA 使用指南</b> — 提供在外部加载适配器的 Python 示例代码",
          "<b>对话测试</b> — 直接跳转到「对话测试」页面",
          "<b>删除</b> — 整理不需要的作业",
        ],
      },
      {
        title: "可查看的信息",
        items: [
          "最终/最佳损失值与学习曲线",
          "训练设置 (轮数·学习率·批大小·LoRA R/Alpha 等)",
          "AutoResearch 每次试验的结果表 (loss·step·耗时)",
          "已保存的检查点路径",
        ],
      },
      {
        title: "小贴士",
        type: "tip",
        items: [
          "LoRA 适配器通常仅数十 MB,便于下载与分享",
          "如需在外部环境使用,请先「合并」为单一模型文件再部署",
        ],
      },
      {
        title: "前往下一步",
        type: "tip",
        items: [
          "查看客观分数 → <b>步骤 8 模型评估</b>",
          "直接对话体验 → <b>步骤 9 对话测试</b>",
        ],
      },
    ],
  },

  step8: {
    label: "8. 模型评估",
    heading: "步骤 8 — 模型评估",
    lead: "通过定量指标 (BLEU·ROUGE·Perplexity·LLM Judge) 和标准基准来衡量微调后模型的性能。",
    sections: [
      {
        title: "为什么需要这一步",
        items: [
          "仅凭主观印象难以判断模型间的优劣",
          "只有客观分数才能指导训练设置改进方向,并判断是否可以部署",
        ],
      },
      {
        title: "使用流程",
        type: "list",
        items: [
          "<b>① 选择标签</b> — 「基础评估」或「基准评估」",
          "<b>② 选择模型·数据集·选项</b> — 打开「LLM 审阅」时将由 LLM 额外为回答质量打分",
          "<b>③ 点击「开始评估」</b> — 实时显示进度,可「停止」",
          "<b>④ 查看结果</b> — 分数与回答样本的评分结果",
        ],
      },
      {
        title: "基础评估指标",
        items: [
          "<b>BLEU</b> — 参考答案与模型输出的 n-gram 重合度",
          "<b>ROUGE-1/2/L</b> — 模型输出相对参考的召回率 (用于摘要质量评估)",
          "<b>Perplexity</b> — 模型的语言预测不确定性 (越低越好)",
          "<b>LLM Judge</b> — 由 LLM 直接为回答质量打分",
        ],
      },
      {
        title: "基准评估",
        items: [
          "支持基准: <b>MMLU·ARC-Easy/Challenge·HellaSwag·TruthfulQA·GSM8K·WinoGrande·Ko-MMLU·KLUE</b>",
          "多选基准,以柱状图/雷达图比较结果",
        ],
      },
      {
        title: "注意事项",
        type: "warn",
        items: [
          "基准评估的后端 (lm-evaluation-harness) 接入正在进行中",
        ],
      },
      {
        title: "小贴士",
        type: "tip",
        items: [
          "评估多个训练作业,可一眼比较哪个训练设置更好",
        ],
      },
      {
        title: "前往下一步",
        type: "tip",
        items: [
          "如需感受实际回答质量与语气 → <b>步骤 9 对话测试</b>",
        ],
      },
    ],
  },

  step9: {
    label: "9. RAG DB 创建",
    heading: "步骤 9 — RAG DB 创建",
    lead: "从已上传的文档中选择需要的文档,构建可检索的向量 DB (RAG DB)。在下一步「对话测试」中选择该 DB,模型即可基于文档作答。",
    sections: [
      {
        title: "什么是 RAG",
        type: "flow",
        items: [
          "<b>Retrieval-Augmented Generation</b> — 先检索与用户问题在语义上相近的文档片段,再将这些片段作为上下文交给 LLM 作答的方法",
          "让模型基于其训练知识之外的最新/专业文档作答,能<b>显著降低幻觉</b>",
          "NELLA 使用 <b>BGE-M3</b> 进行片段嵌入,使用 <b>ChromaDB</b> 作为向量存储",
        ],
      },
      {
        title: "为什么需要多个 RAG DB",
        items: [
          "按目的分离集合 (如「内部手册」、「法规」、「技术文档」) 可提升检索精度",
          "针对特定领域对话可提高模型的<b>上下文聚焦度</b>",
          "可进行多 DB 的回答质量 A/B 对比实验",
        ],
      },
      {
        title: "使用流程",
        type: "list",
        items: [
          "<b>① 确认文档已上传</b> — 只有已完成文本提取的文档可被索引",
          "<b>② 点击「+ 新建 RAG DB」</b> — 输入名称·描述,并勾选要包含的文档",
          "<b>③ 创建后立即索引</b> — 将所选文档切分为片段 → 用 BGE-M3 嵌入 → 存入 ChromaDB",
          "<b>④ 编辑·重新索引·删除</b> — 可通过卡片按钮随时管理",
        ],
      },
      {
        title: "管理小贴士",
        type: "tip",
        items: [
          "文档内容更改后,请使用<b>重新索引</b>重建片段 (更换嵌入模型时同理)",
          "删除不需要的集合时,ChromaDB 中也会立即消失并释放磁盘空间",
          "进入下一步,在<b>「对话测试」</b>页面打开<b>「使用 RAG」</b>开关,选择刚创建的 DB 进行对话",
        ],
      },
    ],
  },

  step10: {
    label: "10. 对话测试",
    heading: "步骤 10 — 对话测试",
    lead: "与已训练的本地模型或外部 API 模型进行实时对话,验证回答质量。可挂载前一步创建的 RAG DB,利用文档作为依据。",
    sections: [
      {
        title: "为什么需要这一步",
        items: [
          "BLEU·ROUGE 等分数无法体现的<b>语气·文风·实际回答质量</b>可直接体感",
          "可以在基础模型与微调模型之间切换,比较训练效果",
        ],
      },
      {
        title: "四种对话方式",
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
          "在步骤 9 中创建的 RAG DB,勾选后会自动开启 RAG (未勾选则关闭)",
          "可以同时选择多个 DB,检索结果按分数统一排序",
          "对基于事实的问题可有效降低幻觉",
          "没有任何 RAG DB 时,会显示<b>「在步骤 9 中创建」</b>链接",
        ],
      },
      {
        title: "使用流程",
        type: "list",
        items: [
          "<b>① 选择对话方式与模型</b> — 本地模型可能首次加载较慢",
          "<b>② (可选) 开启 RAG + 选择 RAG DB</b> — 需要文档依据时启用",
          "<b>③ 状态为「准备完成」后输入消息</b>",
          "<b>④ 比较回复</b> — 基础 ↔ 微调、RAG ON/OFF,体感训练与检索效果",
        ],
      },
      {
        title: "生成选项",
        items: [
          "<b>温度 (Temperature)</b> — 越高越多样,越低越一致保守",
          "<b>最大 Token 数</b> — 回答长度上限",
          "<b>系统提示</b> — 指定模型的角色",
        ],
      },
      {
        title: "结束语",
        type: "tip",
        items: [
          "走到这里,NELLA 流水线一个完整循环就结束了。",
          "如果结果不满意,请更换数据验证、基础模型、超参数或 RAG DB 配置后再试一次",
        ],
      },
    ],
  },
};
