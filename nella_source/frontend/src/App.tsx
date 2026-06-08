import React, { useEffect, useState } from "react";
import nellaLogo from "./assets/Figures/NELLA_Assistant.png";
import kistiBlueskyLogo from "./assets/Figures/KISTI_BLUESKY_LOGO.jpg";
import { BrowserRouter, NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, FileText, Database, Cpu, Play, BarChart3, MessageSquare, Settings, Menu, BrainCircuit, FlaskConical, ShieldCheck, Bot, Trophy, Zap, MemoryStick, Monitor } from "lucide-react";
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
import Chat from "./pages/Chat";
import SettingsPage from "./pages/SettingsPage";
import LLMSettings from "./pages/LLMSettings";
import AgentChat from "./components/AgentChat";

const topItems = [
  { to: "/", label: "대시보드", icon: LayoutDashboard },
];

const pipelineItems = [
  { to: "/documents",        label: "문서 업로드",    icon: FileText,    step: 1 },
  { to: "/data",             label: "학습데이터 생성", icon: Database,    step: 2 },
  { to: "/data-validation",  label: "학습데이터 검증", icon: ShieldCheck, step: 3 },
  { to: "/models",           label: "기반모델 선택",  icon: Cpu,         step: 4 },
  { to: "/model-validation", label: "모델 검증",      icon: FlaskConical, step: 5 },
  { to: "/training",         label: "모델 훈련",      icon: Play,        step: 6 },
  { to: "/training-results", label: "훈련결과 보기",  icon: Trophy,      step: 7 },
  { to: "/evaluation",       label: "모델 평가",      icon: BarChart3,   step: 8 },
  { to: "/chat",             label: "대화 테스트",    icon: MessageSquare, step: 9 },
];

const utilItems = [
  { to: "/llm-settings", label: "LLM 설정", icon: Bot },
  { to: "/settings",     label: "설정",     icon: Settings },
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

  return (
    <div className="flex flex-col h-screen bg-gray-50">

      {/* ── Top header banner ─────────────────────────────────────────── */}
      <header className="flex-shrink-0 h-[88px] bg-white border-b border-gray-200 flex items-center px-3 gap-3 z-20 shadow-sm">
        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          title="사이드바 접기/펼치기"
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

        {/* Agent panel toggle */}
        <button
          onClick={() => setAgentOpen(!agentOpen)}
          title={agentOpen ? "어시스턴트 닫기" : "어시스턴트 열기"}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
            agentOpen
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600"
          }`}
        >
          <Bot className="w-5 h-5" />
          <span className="hidden sm:block">NELLA 어시스턴트</span>
        </button>
      </header>

      {/* ── Bottom 3-column split ──────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">

        {/* Left: navigation menu */}
        <aside className={`${sidebarCollapsed ? "w-14" : "w-56"} bg-slate-100 border-r border-slate-200 flex flex-col transition-all duration-200 flex-shrink-0`}>
          <nav className="flex-1 py-3 px-2 overflow-y-auto space-y-0.5">

            {/* 대시보드 */}
            {topItems.map(({ to, label, icon: Icon }) => (
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
            ))}

            {/* ── 파이프라인 구분선 ── */}
            <div className="border-t border-slate-300 mt-2 pt-2">
              {!sidebarCollapsed && (
                <p className="px-3 pb-1.5 text-xs font-extrabold text-blue-600 tracking-wide">파이프라인</p>
              )}
            </div>

            {/* 파이프라인 단계 */}
            <div className={`${sidebarCollapsed ? "" : "bg-blue-50/60 rounded-lg py-1 border border-blue-100"} space-y-0`}>
              {pipelineItems.map(({ to, label, icon: Icon, step }) => (
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
              ))}
            </div>

            {/* ── 유틸 구분선 (대화 테스트 ~ LLM 설정 사이) ── */}
            <div className="border-t border-slate-300 mt-2 pt-2" />

            {/* LLM 설정 / 설정 */}
            {utilItems.map(({ to, label, icon: Icon }) => (
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
            ))}

            {/* 시스템 상태 — 설정 아래 구분선과 함께 배치 */}
            <div className="mt-4 mx-1 border-t-2 border-slate-300 pt-3">
              <SidebarSysStatus collapsed={sidebarCollapsed} />
            </div>
          </nav>
          {/* ── KISTI BLUESKY 외부 링크 (사이드바 하단 고정) ── */}
          <a
            href="https://github.com/leeryong/KISTI_BLUESKY"
            target="_blank"
            rel="noopener noreferrer"
            title="KISTI BLUESKY GitHub"
            className={`flex items-center justify-center ${sidebarCollapsed ? "px-1" : "px-3"} py-2 border-t border-slate-200 hover:bg-slate-200 transition-colors`}
          >
            <img
              src={kistiBlueskyLogo}
              alt="KISTI BLUESKY"
              className={`${sidebarCollapsed ? "h-6 w-6 object-contain" : "h-6 w-auto object-contain"}`}
            />
          </a>
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
