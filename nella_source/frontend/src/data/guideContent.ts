import { Compass, FileText, Sparkles, ShieldCheck, Boxes, FlaskConical, Play, Trophy, BarChart3, MessageSquare, Library, type LucideIcon } from "lucide-react";

import shotDashboard       from "../assets/Figures/Screenshots/00_dashboard.png";
import shotDocuments       from "../assets/Figures/Screenshots/01_documents.png";
import shotDataGeneration  from "../assets/Figures/Screenshots/02_data-generation.png";
import shotDataValidation  from "../assets/Figures/Screenshots/03_data-validation.png";
import shotModelSelection  from "../assets/Figures/Screenshots/04_model-selection.png";
import shotModelValidation from "../assets/Figures/Screenshots/05_model-validation.png";
import shotTraining        from "../assets/Figures/Screenshots/06_training.png";
import shotTrainingResults from "../assets/Figures/Screenshots/07_training-results.png";
import shotEvaluation      from "../assets/Figures/Screenshots/08_evaluation.png";
import shotChat            from "../assets/Figures/Screenshots/09_chat.png";

import type { Lang } from "../i18n";
import { guideText_ko } from "./guideContent.ko";
import { guideText_en } from "./guideContent.en";
import { guideText_ja } from "./guideContent.ja";
import { guideText_zh } from "./guideContent.zh";

export type GuideSectionType = "list" | "tip" | "warn" | "flow";

export interface GuideSection {
  title: string;
  type?: GuideSectionType;
  items: string[];
}

export interface TabText {
  label: string;
  heading: string;
  lead: string;
  sections: GuideSection[];
}

export interface GuideTab {
  id: string;
  label: string;
  icon: LucideIcon;
  stepNum?: number;
  pageLink?: string;
  heading: string;
  lead: string;
  screenshot?: string;
  sections: GuideSection[];
}

interface GuideSpine {
  id: string;
  icon: LucideIcon;
  stepNum?: number;
  pageLink?: string;
  screenshot?: string;
}

const SPINE: GuideSpine[] = [
  { id: "intro",  icon: Compass,       screenshot: shotDashboard },
  { id: "step1",  icon: FileText,      stepNum: 1,  pageLink: "/documents",          screenshot: shotDocuments },
  { id: "step2",  icon: Sparkles,      stepNum: 2,  pageLink: "/data",               screenshot: shotDataGeneration },
  { id: "step3",  icon: ShieldCheck,   stepNum: 3,  pageLink: "/data-validation",    screenshot: shotDataValidation },
  { id: "step4",  icon: Boxes,         stepNum: 4,  pageLink: "/models",             screenshot: shotModelSelection },
  { id: "step5",  icon: FlaskConical,  stepNum: 5,  pageLink: "/model-validation",   screenshot: shotModelValidation },
  { id: "step6",  icon: Play,          stepNum: 6,  pageLink: "/training",           screenshot: shotTraining },
  { id: "step7",  icon: Trophy,        stepNum: 7,  pageLink: "/training-results",   screenshot: shotTrainingResults },
  { id: "step8",  icon: BarChart3,     stepNum: 8,  pageLink: "/evaluation",         screenshot: shotEvaluation },
  { id: "step9",  icon: Library,       stepNum: 9,  pageLink: "/rag-db" },
  { id: "step10", icon: MessageSquare, stepNum: 10, pageLink: "/chat",               screenshot: shotChat },
];

const TEXTS: Record<Lang, Record<string, TabText>> = {
  ko: guideText_ko,
  en: guideText_en,
  ja: guideText_ja,
  zh: guideText_zh,
};

export function getGuideTabs(lang: Lang): GuideTab[] {
  const texts = TEXTS[lang] ?? guideText_ko;
  return SPINE.map((s) => {
    const t = texts[s.id] ?? guideText_ko[s.id];
    return {
      id: s.id,
      icon: s.icon,
      stepNum: s.stepNum,
      pageLink: s.pageLink,
      screenshot: s.screenshot,
      label: t.label,
      heading: t.heading,
      lead: t.lead,
      sections: t.sections,
    };
  });
}
