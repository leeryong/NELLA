import React, { useEffect, useRef, useState } from "react";
import { Globe, Check, ChevronDown } from "lucide-react";
import { LANG_OPTIONS, useT, Lang } from "../i18n";

const LanguageSwitcher: React.FC = () => {
  const { lang, setLang, t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const current = LANG_OPTIONS.find((l) => l.code === lang) ?? LANG_OPTIONS[0];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t("header.language")}
        className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-100 hover:text-gray-800 transition-colors"
      >
        <Globe className="w-4 h-4" />
        <span>{current.short}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-30">
          {LANG_OPTIONS.map((opt) => {
            const active = opt.code === lang;
            return (
              <button
                key={opt.code}
                type="button"
                onClick={() => { setLang(opt.code as Lang); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left ${
                  active ? "bg-blue-50 text-blue-700 font-semibold" : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                <span className="text-[10px] font-bold w-6 text-gray-400">{opt.short}</span>
                <span className="flex-1">{opt.label}</span>
                {active && <Check className="w-3.5 h-3.5 text-blue-600" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default LanguageSwitcher;
