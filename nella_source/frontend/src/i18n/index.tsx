import React, { createContext, useContext, useEffect, useState } from "react";

export type Lang = "ko" | "en" | "ja" | "zh";

export const LANG_OPTIONS: { code: Lang; label: string; short: string }[] = [
  { code: "ko", label: "한국어", short: "KO" },
  { code: "en", label: "English", short: "EN" },
  { code: "ja", label: "日本語", short: "JA" },
  { code: "zh", label: "中文", short: "ZH" },
];

type Dict = Record<string, string>;

// Only the UI chrome and page headers are translated for now — long-form
// guide/help content and agent messages stay Korean until they are needed.
const dict: Record<Lang, Dict> = {
  ko: {
    // Header
    "header.assistant_open": "어시스턴트 열기",
    "header.assistant_close": "어시스턴트 닫기",
    "header.assistant": "NELLA 어시스턴트",
    "header.sidebar_toggle": "사이드바 접기/펼치기",
    "header.language": "언어",

    // Sidebar - top items
    "nav.dashboard": "대시보드",
    "nav.llm_settings": "LLM 설정",
    "nav.settings": "설정",
    "nav.pipeline_heading": "파이프라인",

    // Sidebar - pipeline steps
    "step.1": "문서 업로드",
    "step.2": "학습데이터 생성",
    "step.3": "학습데이터 검증",
    "step.4": "기반모델 선택",
    "step.5": "모델 검증",
    "step.6": "모델 훈련",
    "step.7": "훈련결과 보기",
    "step.8": "모델 평가",
    "step.9": "RAG DB 관리",
    "step.10": "대화 테스트",

    // Dashboard
    "dash.guide.title": "NELLA 사용 가이드",
    "dash.guide.desc": "처음이시라면 10단계 파이프라인 흐름을 한눈에 확인하세요",
    "dash.guide.cta": "가이드 열기",

    // Page headers (title + short subtitle)
    "page.documents.title": "문서 업로드",
    "page.documents.desc": "PDF, DOCX, HWP 문서를 업로드해 텍스트를 추출합니다.",
    "page.data.title": "학습데이터 생성",
    "page.data.desc": "문서로부터 SFT/DPO 학습 데이터셋을 생성합니다.",
    "page.data_validation.title": "학습데이터 검증",
    "page.data_validation.desc": "생성된 학습 데이터셋의 품질을 검토·필터링합니다.",
    "page.models.title": "기반모델 선택",
    "page.models.desc": "HuggingFace 모델을 검색·다운로드해 훈련에 사용합니다.",
    "page.model_validation.title": "모델 검증",
    "page.model_validation.desc": "다운로드된 모델의 응답과 연결 상태를 확인합니다.",
    "page.training.title": "모델 훈련",
    "page.training.desc": "LoRA/QLoRA/Full SFT, DPO, AutoResearch로 파인튜닝합니다.",
    "page.training_results.title": "훈련결과 보기",
    "page.training_results.desc": "훈련 로그·손실·어댑터 병합 상태를 확인합니다.",
    "page.evaluation.title": "모델 평가",
    "page.evaluation.desc": "BLEU/ROUGE/Perplexity·LLM Judge로 정량 평가합니다.",
    "page.rag_db.title": "RAG DB 관리",
    "page.rag_db.desc": "문서를 골라 검색 가능한 벡터DB를 만듭니다. 다음 단계 '대화 테스트'에서 사용됩니다.",
    "page.chat.title": "대화 테스트",
    "page.chat.desc": "훈련된 모델로 직접 대화 테스트",

    // Guide modal / Page help
    "guide.title": "NELLA 사용 가이드",
    "guide.subtitle": "단계별로 따라가며 NELLA를 익혀 보세요",
    "guide.close_hint": "닫기 (Esc)",
    "guide.prev": "이전",
    "guide.next": "다음",
    "guide.go_to_page": "이 페이지로 가기",
    "help.button": "도움말",
    "help.title_hint": "페이지 도움말",
    "help.footer": "NELLA 도움말 · 우측 어시스턴트 패널에서도 질문할 수 있습니다.",
    "help.close": "닫기",
  },
  en: {
    "header.assistant_open": "Open Assistant",
    "header.assistant_close": "Close Assistant",
    "header.assistant": "NELLA Assistant",
    "header.sidebar_toggle": "Collapse/Expand Sidebar",
    "header.language": "Language",

    "nav.dashboard": "Dashboard",
    "nav.llm_settings": "LLM Settings",
    "nav.settings": "Settings",
    "nav.pipeline_heading": "Pipeline",

    "step.1": "Document Upload",
    "step.2": "Training Data Generation",
    "step.3": "Training Data Validation",
    "step.4": "Base Model Selection",
    "step.5": "Model Validation",
    "step.6": "Model Training",
    "step.7": "Training Results",
    "step.8": "Model Evaluation",
    "step.9": "RAG DB Management",
    "step.10": "Chat Test",

    "dash.guide.title": "NELLA User Guide",
    "dash.guide.desc": "New here? See the full 10-step pipeline flow at a glance.",
    "dash.guide.cta": "Open Guide",

    "page.documents.title": "Document Upload",
    "page.documents.desc": "Upload PDF, DOCX, HWP files and extract their text.",
    "page.data.title": "Training Data Generation",
    "page.data.desc": "Generate SFT/DPO training datasets from your documents.",
    "page.data_validation.title": "Training Data Validation",
    "page.data_validation.desc": "Review and filter the quality of generated datasets.",
    "page.models.title": "Base Model Selection",
    "page.models.desc": "Search and download HuggingFace models to use for training.",
    "page.model_validation.title": "Model Validation",
    "page.model_validation.desc": "Verify downloaded models and their connectivity.",
    "page.training.title": "Model Training",
    "page.training.desc": "Fine-tune with LoRA/QLoRA/Full SFT, DPO, or AutoResearch.",
    "page.training_results.title": "Training Results",
    "page.training_results.desc": "Inspect training logs, loss, and adapter merges.",
    "page.evaluation.title": "Model Evaluation",
    "page.evaluation.desc": "Quantitative evaluation with BLEU/ROUGE/Perplexity + LLM Judge.",
    "page.rag_db.title": "RAG DB Management",
    "page.rag_db.desc": "Pick documents to build a searchable vector DB. Used in the next step 'Chat Test'.",
    "page.chat.title": "Chat Test",
    "page.chat.desc": "Chat directly with your trained model.",

    "guide.title": "NELLA User Guide",
    "guide.subtitle": "Follow the steps to learn how NELLA works",
    "guide.close_hint": "Close (Esc)",
    "guide.prev": "Previous",
    "guide.next": "Next",
    "guide.go_to_page": "Go to this page",
    "help.button": "Help",
    "help.title_hint": "Page help",
    "help.footer": "NELLA help · You can also ask in the assistant panel on the right.",
    "help.close": "Close",
  },
  ja: {
    "header.assistant_open": "アシスタントを開く",
    "header.assistant_close": "アシスタントを閉じる",
    "header.assistant": "NELLA アシスタント",
    "header.sidebar_toggle": "サイドバー切替",
    "header.language": "言語",

    "nav.dashboard": "ダッシュボード",
    "nav.llm_settings": "LLM 設定",
    "nav.settings": "設定",
    "nav.pipeline_heading": "パイプライン",

    "step.1": "文書アップロード",
    "step.2": "学習データ生成",
    "step.3": "学習データ検証",
    "step.4": "ベースモデル選択",
    "step.5": "モデル検証",
    "step.6": "モデル学習",
    "step.7": "学習結果",
    "step.8": "モデル評価",
    "step.9": "RAG DB 管理",
    "step.10": "対話テスト",

    "dash.guide.title": "NELLA 使い方ガイド",
    "dash.guide.desc": "はじめての方は 10 ステップのパイプラインを一目で確認してください。",
    "dash.guide.cta": "ガイドを開く",

    "page.documents.title": "文書アップロード",
    "page.documents.desc": "PDF・DOCX・HWP ファイルをアップロードしテキストを抽出します。",
    "page.data.title": "学習データ生成",
    "page.data.desc": "文書から SFT/DPO 学習データセットを生成します。",
    "page.data_validation.title": "学習データ検証",
    "page.data_validation.desc": "生成された学習データセットの品質を確認・フィルタします。",
    "page.models.title": "ベースモデル選択",
    "page.models.desc": "HuggingFace モデルを検索・ダウンロードして学習に使用します。",
    "page.model_validation.title": "モデル検証",
    "page.model_validation.desc": "ダウンロードしたモデルと接続を確認します。",
    "page.training.title": "モデル学習",
    "page.training.desc": "LoRA/QLoRA/Full SFT、DPO、AutoResearch でファインチューニング。",
    "page.training_results.title": "学習結果",
    "page.training_results.desc": "学習ログ・損失・アダプタ統合状態を確認します。",
    "page.evaluation.title": "モデル評価",
    "page.evaluation.desc": "BLEU/ROUGE/Perplexity と LLM Judge で定量評価します。",
    "page.rag_db.title": "RAG DB 管理",
    "page.rag_db.desc": "文書を選んで検索可能なベクトル DB を作ります。次の「対話テスト」で使用されます。",
    "page.chat.title": "対話テスト",
    "page.chat.desc": "学習済みモデルと直接対話します。",

    "guide.title": "NELLA 使い方ガイド",
    "guide.subtitle": "ステップに沿って NELLA を身につけましょう",
    "guide.close_hint": "閉じる (Esc)",
    "guide.prev": "前へ",
    "guide.next": "次へ",
    "guide.go_to_page": "このページへ移動",
    "help.button": "ヘルプ",
    "help.title_hint": "ページヘルプ",
    "help.footer": "NELLA ヘルプ · 右のアシスタントパネルからも質問できます。",
    "help.close": "閉じる",
  },
  zh: {
    "header.assistant_open": "打开助手",
    "header.assistant_close": "关闭助手",
    "header.assistant": "NELLA 助手",
    "header.sidebar_toggle": "折叠/展开侧边栏",
    "header.language": "语言",

    "nav.dashboard": "仪表板",
    "nav.llm_settings": "LLM 设置",
    "nav.settings": "设置",
    "nav.pipeline_heading": "流水线",

    "step.1": "文档上传",
    "step.2": "训练数据生成",
    "step.3": "训练数据验证",
    "step.4": "基础模型选择",
    "step.5": "模型验证",
    "step.6": "模型训练",
    "step.7": "训练结果",
    "step.8": "模型评估",
    "step.9": "RAG DB 管理",
    "step.10": "对话测试",

    "dash.guide.title": "NELLA 使用指南",
    "dash.guide.desc": "初次使用? 一览 10 步流水线全流程。",
    "dash.guide.cta": "打开指南",

    "page.documents.title": "文档上传",
    "page.documents.desc": "上传 PDF、DOCX、HWP 文件并提取文本。",
    "page.data.title": "训练数据生成",
    "page.data.desc": "从文档生成 SFT/DPO 训练数据集。",
    "page.data_validation.title": "训练数据验证",
    "page.data_validation.desc": "审阅并过滤已生成数据集的质量。",
    "page.models.title": "基础模型选择",
    "page.models.desc": "搜索并下载 HuggingFace 模型用于训练。",
    "page.model_validation.title": "模型验证",
    "page.model_validation.desc": "验证已下载模型及其连接状态。",
    "page.training.title": "模型训练",
    "page.training.desc": "使用 LoRA/QLoRA/Full SFT、DPO 或 AutoResearch 进行微调。",
    "page.training_results.title": "训练结果",
    "page.training_results.desc": "查看训练日志、损失和适配器合并状态。",
    "page.evaluation.title": "模型评估",
    "page.evaluation.desc": "使用 BLEU/ROUGE/Perplexity 与 LLM Judge 进行定量评估。",
    "page.rag_db.title": "RAG DB 管理",
    "page.rag_db.desc": "选择文档以构建可检索的向量数据库。用于下一步「对话测试」。",
    "page.chat.title": "对话测试",
    "page.chat.desc": "直接与你训练的模型对话。",

    "guide.title": "NELLA 使用指南",
    "guide.subtitle": "按步骤跟随,快速上手 NELLA",
    "guide.close_hint": "关闭 (Esc)",
    "guide.prev": "上一页",
    "guide.next": "下一页",
    "guide.go_to_page": "前往此页面",
    "help.button": "帮助",
    "help.title_hint": "页面帮助",
    "help.footer": "NELLA 帮助 · 也可在右侧助手面板中提问。",
    "help.close": "关闭",
  },
};

interface LanguageCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageCtx>({
  lang: "ko",
  setLang: () => {},
  t: (k) => k,
});

const STORAGE_KEY = "nella-lang";

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    return (saved as Lang) || "ko";
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
    }
  }, [lang]);

  const setLang = (l: Lang) => setLangState(l);
  const t = (key: string) => dict[lang]?.[key] ?? dict.ko[key] ?? key;

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useT = () => useContext(LanguageContext);
