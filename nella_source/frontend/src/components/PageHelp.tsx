import { useState } from "react";
import { HelpCircle, X, ChevronRight } from "lucide-react";
import { helpContent } from "../data/helpContent";

interface PageHelpProps {
  pageKey: string;
}

export default function PageHelp({ pageKey }: PageHelpProps) {
  const [open, setOpen] = useState(false);
  const content = helpContent[pageKey];
  if (!content) return null;

  return (
    <>
      {/* ── 도움말 버튼 — 명확히 보이는 pill 스타일 ── */}
      <button
        onClick={() => setOpen(true)}
        className="ml-3 flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-600 hover:text-blue-700 rounded-full text-xs font-semibold border border-blue-200 hover:border-blue-300 transition-colors flex-shrink-0"
        title="페이지 도움말"
      >
        <HelpCircle size={13} />
        <span>도움말</span>
      </button>

      {/* ── 모달 ── */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[82vh] flex flex-col mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between px-6 py-5 border-b border-gray-100 flex-shrink-0">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-6 h-6 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <HelpCircle size={14} className="text-blue-600" />
                  </div>
                  <h2 className="text-base font-bold text-gray-900">{content.pageTitle}</h2>
                </div>
                <p className="text-sm text-gray-500 leading-relaxed pl-8">{content.summary}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors ml-4 flex-shrink-0"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
              {content.sections.map((section) => (
                <div key={section.title}>
                  <h3 className="text-xs font-bold text-blue-700 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                    <span className="w-1 h-3 bg-blue-500 rounded-full inline-block" />
                    {section.title}
                  </h3>
                  <ul className="space-y-2">
                    {section.items.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700 leading-snug">
                        <ChevronRight size={13} className="mt-0.5 flex-shrink-0 text-blue-400" />
                        <span dangerouslySetInnerHTML={{ __html: item }} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-gray-100 flex-shrink-0 flex items-center justify-between">
              <p className="text-xs text-gray-400">NELLA 도움말 · 우측 어시스턴트 패널에서도 질문할 수 있습니다.</p>
              <button
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-medium rounded-lg transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
