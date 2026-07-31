import type { Lang } from "../i18n";
import { helpContent_ko } from "./helpContent.ko";
import { helpContent_en } from "./helpContent.en";
import { helpContent_ja } from "./helpContent.ja";
import { helpContent_zh } from "./helpContent.zh";

export interface HelpSection {
  title: string;
  items: string[];
}

export interface HelpEntry {
  pageTitle: string;
  summary: string;
  sections: HelpSection[];
}

const HELP: Record<Lang, Record<string, HelpEntry>> = {
  ko: helpContent_ko,
  en: helpContent_en,
  ja: helpContent_ja,
  zh: helpContent_zh,
};

export function getHelpContent(lang: Lang): Record<string, HelpEntry> {
  return HELP[lang] ?? helpContent_ko;
}
