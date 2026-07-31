import React, { useEffect, useState } from "react";
import nellaLogo from "./assets/Figures/NELLA_Assistant.png";
import { BrowserRouter, NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, FileText, Database, Cpu, Play, BarChart3, MessageSquare, Settings, Menu, BrainCircuit, FlaskConical, ShieldCheck, Bot, Trophy, Zap, MemoryStick, Monitor, Library, Sparkles, Github } from "lucide-react";
import { api } from "./services/api";
import Dashboard from "./pages/Dashboard";
import Documents from "./pages/Documents";
import DataGeneration from "./pages/DataGeneration";
import ModelSelection from "./pages/ModelSelection";
import ModelValidation from "./pages/ModelValidation";
import DataValidation from "./pages/DataValidation";
import Training from "./pages/Training";
import TrainingResults from "./pages/TrainingResults";
import Evaluation from "./pages/Evaluation";
import RagDb from "./pages/RagDb";
import Chat from "./pages/Chat";
import SettingsPage from "./pages/SettingsPage";
import LLMSettings from "./pages/LLMSettings";
import AgentChat from "./components/AgentChat";
import LanguageSwitcher from "./components/LanguageSwitcher";
import { useT } from "./i18n";

const topItems = [
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard },
];

const pipelineItems = [
  { to: "/documents",        labelKey: "step.1",  icon: FileText,    step: 1 },
  { to: "/data",             labelKey: "step.2",  icon: Database,    step: 2 },
  { to: "/data-validation",  labelKey: "step.3",  icon: ShieldCheck, step: 3 },
  { to: "/models",           labelKey: "step.4",  icon: Cpu,         step: 4 },
  { to: "/model-validation", labelKey: "step.5",  icon: FlaskConical, step: 5 },
  { to: "/training",         labelKey: "step.6",  icon: Play,        step: 6 },
  { to: "/training-results", labelKey: "step.7",  icon: Trophy,      step: 7 },
  { to: "/evaluation",       labelKey: "step.8",  icon: BarChart3,   step: 8 },
  { to: "/rag-db",           labelKey: "step.9",  icon: Library,     step: 9 },
  { to: "/chat",             labelKey: "step.10", icon: MessageSquare, step: 10 },
];

const utilItems = [
  { to: "/llm-settings", labelKey: "nav.llm_settings", icon: Bot },
  { to: "/settings",     labelKey: "nav.settings",     icon: Settings },
];

const pageRoutes = [
  { path: "/",                component: <Dashboard /> },
  { path: "/documents",       component: <Documents /> },
  { path: "/data",            component: <DataGeneration /> },
  { path: "/data-validation", component: <DataValidation /> },
  { path: "/models",          component: <ModelSelection /> },
  { path: "/model-validation",component: <ModelValidation /> },
  { path: "/training",        component: <Training /> },
  { path: "/training-results",component: <TrainingResults /> },
  { path: "/evaluation",      component: <Evaluation /> },
  { path: "/rag-db",          component: <RagDb /> },
  { path: "/chat",            component: <Chat /> },
  { path: "/settings",        component: <SettingsPage /> },
  { path: "/llm-settings",    component: <LLMSettings /> },
];

// ─── Compact system status for sidebar ────────────────────────────────────────
interface GpuQuick {
  name: string;
  type: string;
  total_gb: number;
  used_gb: number | null;
  reserved_gb: number | null;
}
interface SysQuick { cpu: number; mem: number; memUsed: number; memTotal: number; gpus: GpuQuick[] }

const SidebarSysStatus: React.FC<{ collapsed: boolean }> = ({ collapsed }) => {
  const [info, setInfo] = useState<SysQuick | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await api.get<Record<string, unknown>>("/settings/system-info");
        const d = r.data;
        const cpu = (d.cpu as Record<string, number>)?.usage_percent ?? 0;
        const memRaw = d.memory as Record<string, number> ?? {};
        const gpuList = (d.gpu as Array<Record<string, unknown>>) ?? [];
        setInfo({
          cpu,
          mem: memRaw.percent ?? 0,
          memUsed: memRaw.used_gb ?? 0,
          memTotal: memRaw.total_gb ?? 0,
          gpus: gpuList.map((g) => ({
            name: String(g.name ?? ""),
            type: String(g.type ?? "cpu"),
            total_gb: Number(g.total_gb ?? 0),
            used_gb: g.used_gb != null ? Number(g.used_gb) : null,
            reserved_gb: g.reserved_gb != null ? Number(g.reserved_gb) : null,
          })),
        });
      } catch { /* ignore */ }
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  if (!info) return null;

  const barColor = (pct: number) =>
    pct > 85 ? "bg-red-500" : pct > 65 ? "bg-yellow-500" : "bg-green-500";

  const barDark = (pct: number) =>
    pct > 85 ? "bg-red-500" : pct > 65 ? "bg-yellow-400" : "bg-emerald-400";

  if (collapsed) {
    const gpuPct = info.gpus.length > 0 && info.gpus[0].total_gb > 0 && info.gpus[0].used_gb != null
      ? Math.round((info.gpus[0].used_gb / info.gpus[0].total_gb) * 100)
      : null;
    return (
      <div className="mx-1 bg-white/60 border border-slate-200 rounded-xl px-1.5 py-2.5 flex flex-col items-center gap-2">
        <Monitor className="w-3.5 h-3.5 text-slate-400" />
        {gpuPct != null && <div className={`w-2 h-2 rounded-full ${barColor(gpuPct)}`} title={`GPU ${gpuPct}%`} />}
        <div className={`w-2 h-2 rounded-full ${barColor(info.cpu)}`} title={`CPU ${info.cpu}%`} />
        <div className={`w-2 h-2 rounded-full ${barColor(info.mem)}`} title={`RAM ${info.mem}%`} />
      </div>
    );
  }

  return (
    <div className="mx-1 bg-white/60 border border-slate-200 rounded-xl px-3 py-2.5 space-y-2">
      {/* 헤더 */}
      <p className="text-[10px] font-semibold text-slate-500 flex items-center gap-1.5">
        <Monitor className="w-3 h-3" /> 시스템
      </p>

      {/* GPU rows */}
      {info.gpus.map((g, i) => {
        const usedPct = g.used_gb != null && g.total_gb > 0
          ? Math.round(((g.reserved_gb ?? g.used_gb) / g.total_gb) * 100)
          : null;
        const typeLabel = g.type === "cuda" ? "CUDA" : g.type === "mps" ? "MPS" : g.type.toUpperCase();
        const typeBadge = g.type === "cuda"
          ? "bg-green-100 text-green-700"
          : "bg-purple-100 text-purple-700";
        return (
          <div key={i}>
            <div className="flex items-center justify-between text-[10px] mb-0.5">
              <span className="flex items-center gap-1 text-gray-500">
                <Monitor className="w-3 h-3" />
                <span className="truncate max-w-[60px]">{g.type === "mps" ? "GPU" : `GPU${i}`}</span>
                <span className={`px-1 rounded text-[9px] font-bold ${typeBadge}`}>{typeLabel}</span>
              </span>
              {usedPct != null
                ? <span className={usedPct > 85 ? "text-red-500 font-medium" : "text-gray-500"}>{usedPct}%</span>
                : <span className="text-gray-300">—</span>}
            </div>
            {usedPct != null ? (
              <>
                <div className="w-full bg-gray-200 rounded-full h-1">
                  <div className={`h-1 rounded-full transition-all ${barColor(usedPct)}`} style={{ width: `${usedPct}%` }} />
                </div>
                <div className="text-[9px] text-gray-400 mt-0.5">{g.used_gb?.toFixed(1)} / {g.total_gb} GB</div>
              </>
            ) : (
              <div className="text-[9px] text-gray-400 truncate">{g.name}</div>
            )}
          </div>
        );
      })}

      {/* CPU */}
      <div>
        <div className="flex items-center justify-between text-[10px] mb-0.5">
          <span className="flex items-center gap-1 text-gray-500"><Zap className="w-3 h-3" />CPU</span>
          <span className={info.cpu > 85 ? "text-red-500 font-medium" : "text-gray-500"}>{info.cpu}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-1">
          <div className={`h-1 rounded-full transition-all ${barColor(info.cpu)}`} style={{ width: `${info.cpu}%` }} />
        </div>
      </div>

      {/* RAM */}
      <div>
        <div className="flex items-center justify-between text-[10px] mb-0.5">
          <span className="flex items-center gap-1 text-gray-500"><MemoryStick className="w-3 h-3" />RAM</span>
          <span className={info.mem > 85 ? "text-red-500 font-medium" : "text-gray-500"}>{info.memUsed.toFixed(1)}/{info.memTotal} GB</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-1">
          <div className={`h-1 rounded-full transition-all ${barColor(info.mem)}`} style={{ width: `${info.mem}%` }} />
        </div>
      </div>
    </div>
  );
};

const AppInner: React.FC<{
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  agentOpen: boolean;
  setAgentOpen: (v: boolean) => void;
}> = ({ sidebarCollapsed, setSidebarCollapsed, agentOpen, setAgentOpen }) => {
  const location = useLocation();
  const { t } = useT();

  return (
    <div className="flex flex-col h-screen bg-gray-50">

      {/* ── Top header banner ─────────────────────────────────────────── */}
      <header className="flex-shrink-0 h-[88px] bg-white border-b border-gray-200 flex items-center px-3 gap-3 z-20 shadow-sm">
        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          title={t("header.sidebar_toggle")}
        >
          <Menu className="w-6 h-6 text-gray-500" />
        </button>

        {/* Logo + full name — 클릭 시 대시보드 */}
        <NavLink to="/" className="flex items-center gap-3 flex-shrink-0 no-underline" style={{ textDecoration: "none" }}>
          <img src={nellaLogo} alt="NELLA" className="h-[80px] w-auto" />
          <div className="leading-snug hidden sm:block">
            <p className="text-base font-bold text-gray-900">KISTI &nbsp;·&nbsp; NTIS</p>
            <p className="text-base font-semibold text-gray-500">Nifty-Enhanced LLMOps Agent</p>
          </div>
        </NavLink>

        <div className="flex-1" />

        {/* Language switcher */}
        <LanguageSwitcher />

        {/* Agent panel toggle */}
        <button
          onClick={() => setAgentOpen(!agentOpen)}
          title={agentOpen ? t("header.assistant_close") : t("header.assistant_open")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
            agentOpen
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600"
          }`}
        >
          <Bot className="w-5 h-5" />
          <span className="hidden sm:block">{t("header.assistant")}</span>
        </button>
      </header>

      {/* ── Bottom 3-column split ──────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">

        {/* Left: navigation menu */}
        <aside className={`${sidebarCollapsed ? "w-14" : "w-56"} bg-slate-100 border-r border-slate-200 flex flex-col transition-all duration-200 flex-shrink-0`}>
          <nav className="flex-1 py-3 px-2 overflow-y-auto space-y-0.5">

            {/* 대시보드 */}
            {topItems.map(({ to, labelKey, icon: Icon }) => {
              const label = t(labelKey);
              return (
              <NavLink key={to} to={to} end
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg text-[15px] font-medium transition-colors ${
                    isActive ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-100 hover:text-gray-800"
                  }`}
                title={sidebarCollapsed ? label : undefined}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {!sidebarCollapsed && <span className="truncate">{label}</span>}
              </NavLink>
              );
            })}

            {/* ── 파이프라인 구분선 ── */}
            <div className="border-t border-slate-300 mt-2 pt-2">
              {!sidebarCollapsed && (
                <p className="px-3 pb-1.5 text-xs font-extrabold text-blue-600 tracking-wide">{t("nav.pipeline_heading")}</p>
              )}
            </div>

            {/* 파이프라인 단계 */}
            <div className={`${sidebarCollapsed ? "" : "bg-blue-50/60 rounded-lg py-1 border border-blue-100"} space-y-0`}>
              {pipelineItems.map(({ to, labelKey, icon: Icon, step }) => {
                const label = t(labelKey);
                return (
                <NavLink key={to} to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-2 rounded-lg text-[15px] font-medium transition-colors ${
                      isActive ? "bg-blue-500 text-white" : "text-gray-600 hover:bg-blue-100 hover:text-blue-700"
                    }`}
                  title={sidebarCollapsed ? `${step}. ${label}` : undefined}
                >
                  {({ isActive }) => sidebarCollapsed
                    ? (
                      <div className="relative flex-shrink-0">
                        <Icon className="w-4 h-4" />
                        <span className={`absolute -top-1.5 -right-1.5 w-3 h-3 rounded-sm flex items-center justify-center text-[7px] font-bold leading-none ${isActive ? "bg-white/80 text-blue-600" : "bg-blue-200 text-blue-600"}`}>{step}</span>
                      </div>
                    )
                    : <>
                        <span className={`w-4 h-4 rounded-sm flex items-center justify-center text-[9px] font-bold flex-shrink-0 leading-none ${isActive ? "bg-white/80 text-blue-600" : "bg-blue-100 text-blue-500"}`}>{step}</span>
                        <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">{label}</span>
                      </>
                  }
                </NavLink>
                );
              })}
            </div>

            {/* ── 유틸 구분선 (대화 테스트 ~ LLM 설정 사이) ── */}
            <div className="border-t border-slate-300 mt-2 pt-2" />

            {/* LLM 설정 / 설정 */}
            {utilItems.map(({ to, labelKey, icon: Icon }) => {
              const label = t(labelKey);
              return (
              <NavLink key={to} to={to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg text-[15px] font-medium transition-colors ${
                    isActive ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-100 hover:text-gray-800"
                  }`}
                title={sidebarCollapsed ? label : undefined}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {!sidebarCollapsed && <span className="truncate">{label}</span>}
              </NavLink>
              );
            })}

            {/* 시스템 상태 — 설정 아래 구분선과 함께 배치 */}
            <div className="mt-4 mx-1 border-t-2 border-slate-300 pt-3">
              <SidebarSysStatus collapsed={sidebarCollapsed} />
            </div>
          </nav>
        </aside>

        {/* Center: main page content */}
        <main className="flex-1 overflow-auto min-w-0">
          {pageRoutes.map(({ path, component }) => (
            <div key={path} className={location.pathname === path ? "h-full" : "hidden"}>
              {component}
            </div>
          ))}
        </main>

        {/* Right: agent chat panel */}
        <AgentChat collapsed={!agentOpen} onToggle={() => setAgentOpen(!agentOpen)} />
      </div>

      {/* ── 하단 푸터 (화면 전체 폭) ── */}
      <footer className="flex-shrink-0 h-6 bg-white border-t border-gray-200 flex items-center justify-end px-4">
        <a
          href="https://github.com/leeryong/KISTI_BLUESKY"
          target="_blank"
          rel="noopener noreferrer"
          title="KISTI BLUESKY GitHub"
          className="flex items-center gap-1.5 h-full opacity-80 hover:opacity-100 transition-opacity"
        >
          <Sparkles className="w-3.5 h-3.5 text-blue-500" />
          <span className="text-sm font-extrabold tracking-wide bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
            KISTI NTIS BLUESKY
          </span>
          <Github className="w-3.5 h-3.5 text-gray-400" />
        </a>
      </footer>
    </div>
  );
};

const App: React.FC = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [agentOpen, setAgentOpen] = React.useState(true);

  return (
    <BrowserRouter>
      <AppInner
        sidebarCollapsed={sidebarCollapsed}
        setSidebarCollapsed={setSidebarCollapsed}
        agentOpen={agentOpen}
        setAgentOpen={setAgentOpen}
      />
    </BrowserRouter>
  );
};

export default App;
