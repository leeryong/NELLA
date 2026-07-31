import React, { useCallback, useState } from "react";
import nellaConcept from "../assets/Figures/NELLA_Concept_Main.png";
import { useAgentPolling } from "../hooks/useAgentPolling";
import { Link } from "react-router-dom";
import { FileText, Database, Cpu, BarChart3, MessageSquare, CheckCircle, AlertCircle, Clock, Play, ShieldCheck, FlaskConical, Trophy, BookOpen, ChevronRight, Library } from "lucide-react";
import { documentsApi, trainingDataApi, trainingApi, statusApi, TrainingJob, ARJob } from "../services/api";

type RecentJob = {
  id: number;
  name: string;
  status: TrainingJob["status"];
  method: string;
  kind: "sft" | "ar";
  created_at: string;
};
import UserGuideModal from "../components/UserGuideModal";
import { useT } from "../i18n";

const statusColor = (s: string) => {
  if (s === "running")   return "bg-blue-50 text-blue-700";
  if (s === "completed") return "bg-green-50 text-green-700";
  if (s === "failed")    return "bg-red-50 text-red-600";
  return "bg-gray-100 text-gray-500";
};

const Dashboard: React.FC = () => {
  const { t } = useT();
  const [stats, setStats] = useState({ documents: 0, datasets: 0, trainingJobs: 0, completedJobs: 0, runningJobs: 0 });
  const [status, setStatus] = useState<Record<string, unknown>>({});
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [guideOpen, setGuideOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [docs, datasets, jobs, arJobs, statusRes] = await Promise.allSettled([
        documentsApi.list(0, 1000), trainingDataApi.list(), trainingApi.listJobs(), trainingApi.listARJobs(), statusApi.get(),
      ]);
      const docList   = docs.status      === "fulfilled" ? (docs.value.data ?? [])      : [];
      const datasetList = datasets.status === "fulfilled" ? (datasets.value.data ?? [])  : [];
      const jobList   = jobs.status      === "fulfilled" ? (jobs.value.data ?? [])      : [];
      const arJobList = arJobs.status    === "fulfilled" ? (arJobs.value.data ?? [])    : [];
      const statusData = statusRes.status === "fulfilled" ? statusRes.value.data : {};
      const allJobs: RecentJob[] = [
        ...jobList.map((j: TrainingJob): RecentJob => ({
          id: j.id, name: j.name, status: j.status,
          method: (j.method || "SFT").toUpperCase(),
          kind: "sft", created_at: j.created_at,
        })),
        ...arJobList.map((j: ARJob): RecentJob => ({
          id: j.id, name: j.name, status: j.status,
          method: "AutoResearch",
          kind: "ar", created_at: j.created_at,
        })),
      ];
      setStats({
        documents: docList.length, datasets: datasetList.length,
        trainingJobs: allJobs.length,
        completedJobs: allJobs.filter((j) => j.status === "completed").length,
        runningJobs:   allJobs.filter((j) => j.status === "running" || j.status === "pending").length,
      });
      setStatus(statusData as Record<string, unknown>);
      // Show last 5 jobs (running first, then most recent created)
      const sorted = [...allJobs].sort((a, b) => {
        const order: Record<string, number> = { running: 0, pending: 1, completed: 2, failed: 3, cancelled: 4 };
        const orderDiff = (order[a.status] ?? 5) - (order[b.status] ?? 5);
        if (orderDiff !== 0) return orderDiff;
        return (b.created_at || "").localeCompare(a.created_at || "");
      });
      setRecentJobs(sorted.slice(0, 5));
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, []);

  useAgentPolling(load, { idle: 10_000, active: 2_000 });

  const statCards = [
    { label: "문서",         value: stats.documents,    icon: FileText,   color: "text-blue-600 bg-blue-50",    link: "/documents" },
    { label: "학습 데이터셋", value: stats.datasets,     icon: Database,   color: "text-purple-600 bg-purple-50", link: "/data" },
    { label: "훈련 작업",    value: stats.trainingJobs,  icon: Cpu,        color: "text-orange-600 bg-orange-50", link: "/training" },
    { label: "완료",         value: stats.completedJobs, icon: CheckCircle, color: "text-green-600 bg-green-50",  link: "/training" },
  ];

  const pipelineSteps = [
    { step: 1,  label: "문서 업로드",     link: "/documents",        icon: FileText,     desc: "PDF, DOCX, HWP 파일 처리" },
    { step: 2,  label: "학습데이터 생성", link: "/data",             icon: Database,     desc: "AI로 Q&A 학습 데이터 자동 생성" },
    { step: 3,  label: "학습데이터 검증", link: "/data-validation",  icon: ShieldCheck,  desc: "데이터 품질 검증 및 필터링" },
    { step: 4,  label: "기반모델 선택",   link: "/models",           icon: Cpu,          desc: "HuggingFace 소형 모델 다운로드" },
    { step: 5,  label: "모델 검증",       link: "/model-validation", icon: FlaskConical, desc: "후보 모델 적합성 테스트" },
    { step: 6,  label: "모델 훈련",       link: "/training",         icon: Play,         desc: "SFT, DPO, 자동 최적화 훈련" },
    { step: 7,  label: "훈련결과",        link: "/training-results", icon: Trophy,       desc: "훈련된 모델 다운로드 및 관리" },
    { step: 8,  label: "모델 평가",       link: "/evaluation",       icon: BarChart3,    desc: "BLEU, ROUGE, 성능 지표 확인" },
    { step: 9,  label: "RAG DB 관리",     link: "/rag-db",           icon: Library,      desc: "문서 기반 벡터DB 생성·관리" },
    { step: 10, label: "대화 테스트",     link: "/chat",             icon: MessageSquare,desc: "훈련된 모델·RAG DB로 직접 대화" },
  ];

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* ── NELLA 사용 가이드 진입 ── */}
      <button
        onClick={() => setGuideOpen(true)}
        className="w-full flex items-center justify-between bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-xl px-5 py-3 hover:from-blue-100 hover:to-indigo-100 transition-colors group"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-100 group-hover:bg-blue-200 flex items-center justify-center transition-colors flex-shrink-0">
            <BookOpen size={17} className="text-blue-600" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-blue-900">{t("dash.guide.title")}</p>
            <p className="text-xs text-blue-600">{t("dash.guide.desc")}</p>
          </div>
        </div>
        <span className="text-xs font-semibold text-blue-600 group-hover:text-blue-700 flex items-center gap-1 flex-shrink-0">
          {t("dash.guide.cta")}
          <ChevronRight size={14} />
        </span>
      </button>

      {/* ── 대표 이미지 ── */}
      <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm">
        <img src={nellaConcept} alt="NELLA 개념도" className="w-full h-auto" />
      </div>

      {/* ── 통계 카드 ── */}
      {loading ? (
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="bg-gray-100 rounded-xl h-24 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {statCards.map((card) => (
            <Link key={card.label} to={card.link} className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${card.color} mb-3`}>
                <card.icon className="w-5 h-5" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{card.value}</p>
              <p className="text-sm text-gray-500">{card.label}</p>
            </Link>
          ))}
        </div>
      )}

      {/* ── 훈련 실행 중 배너 ── */}
      {stats.runningJobs > 0 && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl p-4">
          <Clock className="w-5 h-5 text-blue-600 animate-pulse flex-shrink-0" />
          <p className="text-sm text-blue-700">
            <strong>{stats.runningJobs}</strong>개 훈련 작업이 백그라운드에서 실행 중입니다.
          </p>
          <Link to="/training" className="ml-auto text-sm font-medium text-blue-600 hover:underline flex items-center gap-1">
            모니터링 <Play className="w-3 h-3" />
          </Link>
        </div>
      )}

      {/* ── 훈련 작업 현황 ── */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">훈련 작업 현황</h2>
          <Link to="/training" className="text-xs text-blue-600 hover:underline">전체 보기</Link>
        </div>
        {recentJobs.length === 0 ? (
          <div className="p-8 text-center">
            <Play className="w-8 h-8 text-gray-200 mx-auto mb-2" />
            <p className="text-sm text-gray-400">훈련 작업 없음</p>
            <Link to="/training" className="text-xs text-blue-500 hover:underline mt-1 inline-block">훈련 시작하기</Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {recentJobs.map((job) => (
              <Link key={job.id} to={job.status === "completed" || job.status === "failed" ? "/training-results" : "/training"} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{job.name}</p>
                  <p className="text-xs text-gray-400">{job.method}</p>
                </div>
                {(job.status === "running" || job.status === "pending") && (
                  <div className="w-24">
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div className="h-1.5 bg-blue-500 rounded-full animate-pulse" style={{ width: "40%" }} />
                    </div>
                  </div>
                )}
                <span className={`px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${statusColor(job.status)}`}>
                  {job.status === "running" ? "실행 중" : job.status === "pending" ? "대기 중" : job.status === "completed" ? "완료" : job.status === "failed" ? "실패" : job.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ── 시스템 설정 상태 ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">시스템 설정 현황</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "LLM 제공자",   value: String(status.llm_provider || "N/A"),                    ok: true },
            { label: "OpenAI Key",   value: status.has_openai_key ? "설정됨" : "미설정",              ok: Boolean(status.has_openai_key) },
            { label: "HF 토큰",      value: status.has_hf_token ? "설정됨" : "미설정",               ok: Boolean(status.has_hf_token) },
            { label: "다운로드 모델", value: `${String(status.downloaded_models || 0)}개`,            ok: true },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              {item.ok ? <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0" />}
              <div>
                <p className="text-xs text-gray-500">{item.label}</p>
                <p className="text-sm font-medium text-gray-700">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 파이프라인 단계 ── */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">파이프라인 단계</h2>
        <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
          {pipelineSteps.map((item) => (
            <Link key={item.label} to={item.link}
              className="flex items-start gap-2.5 bg-white border border-gray-200 rounded-xl p-3 hover:shadow-md hover:border-blue-300 transition-all group">
              <div className="relative w-8 h-8 rounded-lg bg-gray-100 group-hover:bg-blue-50 flex items-center justify-center flex-shrink-0">
                <item.icon className="w-4 h-4 text-gray-400 group-hover:text-blue-600" />
                <span className="absolute -top-1.5 -left-1.5 w-4 h-4 rounded-sm bg-blue-500 group-hover:bg-blue-600 flex items-center justify-center text-[9px] font-bold text-white leading-none">{item.step}</span>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gray-800 group-hover:text-blue-600 truncate">{item.label}</p>
                <p className="text-xs text-gray-400 mt-0.5 leading-tight line-clamp-2">{item.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <UserGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
};

export default Dashboard;
