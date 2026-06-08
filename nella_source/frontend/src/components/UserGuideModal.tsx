import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { X, ChevronLeft, ChevronRight, Lightbulb, AlertTriangle, ListOrdered, GitBranch, ArrowRight } from "lucide-react";
import { guideTabs, GuideSection } from "../data/guideContent";

interface UserGuideModalProps {
  open: boolean;
  onClose: () => void;
}

const SECTION_STYLE: Record<NonNullable<GuideSection["type"]> | "default", { wrap: string; head: string; bullet: string; icon: typeof Lightbulb | null }> = {
  default: { wrap: "",                                              head: "text-gray-800", bullet: "text-blue-400",   icon: null },
  list:    { wrap: "bg-gray-50 border border-gray-100 rounded-xl p-4", head: "text-gray-800", bullet: "text-blue-500",   icon: ListOrdered },
  tip:     { wrap: "bg-blue-50 border border-blue-100 rounded-xl p-4", head: "text-blue-800", bullet: "text-blue-500",   icon: Lightbulb },
  warn:    { wrap: "bg-amber-50 border border-amber-100 rounded-xl p-4", head: "text-amber-800", bullet: "text-amber-500", icon: AlertTriangle },
  flow:    { wrap: "bg-indigo-50 border border-indigo-100 rounded-xl p-4", head: "text-indigo-800", bullet: "text-indigo-500", icon: GitBranch },
};

export default function UserGuideModal({ open, onClose }: UserGuideModalProps) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setActive((i) => Math.min(i + 1, guideTabs.length - 1));
      else if (e.key === "ArrowLeft")  setActive((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const tab = guideTabs[active];
  const Icon = tab.icon;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── 헤더 ─────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
              <Lightbulb size={16} className="text-blue-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">NELLA 사용 가이드</h2>
              <p className="text-xs text-gray-500">단계별로 따라가며 NELLA를 익혀 보세요</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title="닫기 (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── 본문 ─────────────────────────────── */}
        <div className="flex-1 flex min-h-0">
          {/* 좌측 탭 */}
          <nav className="w-56 border-r border-gray-100 bg-gray-50/60 overflow-y-auto py-3 flex-shrink-0">
            {guideTabs.map((t, i) => {
              const TIcon = t.icon;
              const isActive = i === active;
              return (
                <button
                  key={t.id}
                  onClick={() => setActive(i)}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left transition-colors border-l-2 ${
                    isActive
                      ? "bg-white border-blue-500 text-blue-700 font-semibold"
                      : "border-transparent text-gray-600 hover:bg-white hover:text-gray-900"
                  }`}
                >
                  <TIcon size={15} className={isActive ? "text-blue-600" : "text-gray-400"} />
                  <span className="truncate">{t.label}</span>
                </button>
              );
            })}
          </nav>

          {/* 우측 콘텐츠 */}
          <div className="flex-1 overflow-y-auto px-8 py-6">
            {/* 제목·리드 */}
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                <Icon size={20} className="text-blue-600" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900">{tab.heading}</h3>
                <p className="text-sm text-gray-600 leading-relaxed mt-1">{tab.lead}</p>
              </div>
            </div>

            {/* 스크린샷 */}
            {tab.screenshot && (
              <div className="mb-6 rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
                <img
                  src={tab.screenshot}
                  alt={tab.label}
                  className="w-full h-auto max-h-80 object-contain"
                />
              </div>
            )}

            {/* 섹션들 */}
            <div className="space-y-4">
              {tab.sections.map((section, si) => {
                const style = SECTION_STYLE[section.type ?? "default"];
                const SectionIcon = style.icon;
                return (
                  <div key={si} className={style.wrap}>
                    <h4 className={`text-sm font-bold mb-2.5 flex items-center gap-1.5 ${style.head}`}>
                      {SectionIcon ? (
                        <SectionIcon size={14} />
                      ) : (
                        <span className="w-1 h-3 bg-blue-500 rounded-full inline-block" />
                      )}
                      {section.title}
                    </h4>
                    <ul className="space-y-1.5">
                      {section.items.map((item, ii) => (
                        <li key={ii} className="flex items-start gap-2 text-sm text-gray-700 leading-relaxed">
                          <ChevronRight size={13} className={`mt-1 flex-shrink-0 ${style.bullet}`} />
                          <span dangerouslySetInnerHTML={{ __html: item }} />
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── 푸터 ─────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 flex-shrink-0 bg-gray-50/60">
          <button
            onClick={() => setActive((i) => Math.max(i - 1, 0))}
            disabled={active === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-white rounded-lg transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ChevronLeft size={15} />
            이전
          </button>

          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 font-medium">
              {active + 1} / {guideTabs.length}
            </span>
            {tab.pageLink && (
              <Link
                to={tab.pageLink}
                onClick={onClose}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
              >
                이 페이지로 가기
                <ArrowRight size={13} />
              </Link>
            )}
          </div>

          <button
            onClick={() => setActive((i) => Math.min(i + 1, guideTabs.length - 1))}
            disabled={active === guideTabs.length - 1}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-white rounded-lg transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
          >
            다음
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
