import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Library, RefreshCw, Plus, Trash2, FileText, Edit3, Loader, CheckCircle, AlertCircle, X, Download } from "lucide-react";
import { documentsApi, ragDbApi, RagCollection, Document } from "../services/api";
import { formatDate } from "../lib/utils";
import PageHelp from "../components/PageHelp";
import { useAgentPolling } from "../hooks/useAgentPolling";
import { useT } from "../i18n";

// ── 문서 선택 모달 (생성/편집 공통) ─────────────────
interface CollectionModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (params: { name: string; description: string; document_ids: number[] }) => Promise<void>;
  documents: Document[];
  initial?: RagCollection | null;   // 있으면 편집 모드
  busy: boolean;
}

const CollectionModal: React.FC<CollectionModalProps> = ({ open, onClose, onSubmit, documents, initial, busy }) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setDescription(initial?.description ?? "");
    setSelectedIds(new Set(initial?.documents.map((d) => d.document_id) ?? []));
    setError(null);
  }, [open, initial]);

  const toggle = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (!name.trim()) { setError("이름을 입력하세요"); return; }
    if (selectedIds.size === 0) { setError("문서를 하나 이상 선택하세요"); return; }
    setError(null);
    try {
      await onSubmit({ name: name.trim(), description: description.trim(), document_ids: [...selectedIds] });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "저장 실패");
    }
  };

  if (!open) return null;

  const completedDocs = documents.filter((d) => d.status === "completed" && d.extracted_path);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
              <Library size={16} className="text-blue-600" />
            </div>
            <h2 className="text-base font-bold text-gray-900">{initial ? "RAG DB 편집" : "새 RAG DB 만들기"}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg" title="닫기">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">이름</label>
            <input
              value={name} onChange={(e) => setName(e.target.value)}
              placeholder="예: 사내 매뉴얼"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">설명 (선택)</label>
            <textarea
              value={description} onChange={(e) => setDescription(e.target.value)}
              rows={2} placeholder="이 RAG DB의 용도"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 resize-none"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-600">문서 선택 <span className="text-blue-600">({selectedIds.size}/{completedDocs.length})</span></label>
              <div className="flex gap-1">
                <button
                  onClick={() => setSelectedIds(new Set(completedDocs.map((d) => d.id)))}
                  className="text-xs text-blue-600 hover:underline"
                >모두 선택</button>
                <span className="text-gray-300">·</span>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="text-xs text-gray-500 hover:underline"
                >해제</button>
              </div>
            </div>
            <div className="border border-gray-200 rounded-lg max-h-64 overflow-y-auto divide-y divide-gray-50">
              {completedDocs.length === 0 ? (
                <p className="p-4 text-xs text-gray-400 text-center">텍스트 추출이 완료된 문서가 없습니다. 먼저 '문서 업로드' 단계에서 문서를 추가하세요.</p>
              ) : completedDocs.map((doc) => (
                <label key={doc.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(doc.id)}
                    onChange={() => toggle(doc.id)}
                    className="w-4 h-4 accent-blue-600"
                  />
                  <FileText className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                  <span className="text-sm text-gray-700 truncate flex-1">{doc.filename}</span>
                  <span className="text-[10px] text-gray-400">{doc.word_count?.toLocaleString() ?? "-"} 단어</span>
                </label>
              ))}
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-gray-50/60 flex-shrink-0">
          <p className="text-xs text-gray-500">임베딩: <b>BGE-M3</b> · 저장소: <b>ChromaDB</b></p>
          <div className="flex gap-2">
            <button
              onClick={onClose} disabled={busy}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-white rounded-lg disabled:opacity-50"
            >취소</button>
            <button
              onClick={submit} disabled={busy}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              {busy ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
              {initial ? "저장" : "생성"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── 메인 페이지 ────────────────────────────────────
const RagDb: React.FC = () => {
  const { t } = useT();
  const [collections, setCollections] = useState<RagCollection[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RagCollection | null>(null);
  const [busy, setBusy] = useState(false);
  const [reindexingId, setReindexingId] = useState<number | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [colRes, docRes] = await Promise.allSettled([
        ragDbApi.list(),
        documentsApi.list(0, 1000),
      ]);
      if (colRes.status === "fulfilled") setCollections(colRes.value.data ?? []);
      if (docRes.status === "fulfilled") setDocuments(docRes.value.data ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const anyIndexing = collections.some((c) => c.status === "pending" || c.status === "indexing");
  useAgentPolling(load, {
    idle: anyIndexing ? 1_200 : 8_000,
    active: anyIndexing ? 1_200 : 3_000,
  });

  const openNew = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (col: RagCollection) => { setEditing(col); setModalOpen(true); };
  const closeModal = () => { setModalOpen(false); setEditing(null); };

  const handleSubmit = async (params: { name: string; description: string; document_ids: number[] }) => {
    const isEditing = !!editing;
    const editingId = editing?.id;

    // Close modal immediately + insert optimistic placeholder card so the user
    // sees progress right away without waiting on the POST round-trip.
    const optimisticId = -Date.now(); // negative sentinel = not persisted yet
    if (!isEditing) {
      const nowIso = new Date().toISOString();
      const placeholder: RagCollection = {
        id: optimisticId,
        name: params.name,
        description: params.description,
        chroma_name: params.name,
        chunk_count: 0,
        embedding_model: null,
        document_count: 0,
        documents: [],
        status: "pending",
        progress_stage: "생성 요청 전송 중...",
        progress_current: 0,
        progress_total: params.document_ids.length,
        created_at: nowIso,
        updated_at: nowIso,
      };
      setCollections((prev) => [placeholder, ...prev]);
    }
    closeModal();
    setBusy(true);

    try {
      if (isEditing && editingId !== undefined) {
        await ragDbApi.update(editingId, params);
        setBanner({ kind: "ok", text: `'${params.name}' 저장 완료 — 진행 상황은 카드에서 확인하세요` });
      } else {
        await ragDbApi.create(params);
        setBanner({ kind: "ok", text: `'${params.name}' 인덱싱 시작 — 진행 상황은 카드에서 확인하세요` });
      }
      await load(); // replaces optimistic placeholder with the real row
    } catch (e: unknown) {
      // Roll back the optimistic card on failure
      if (!isEditing) {
        setCollections((prev) => prev.filter((c) => c.id !== optimisticId));
      }
      const err = e as { response?: { data?: { detail?: string } }; message?: string };
      const msg = err.response?.data?.detail ?? err.message ?? "저장 실패";
      setBanner({ kind: "err", text: msg });
    } finally {
      setBusy(false);
    }
  };

  const handleReindex = async (id: number) => {
    setReindexingId(id);
    try {
      await ragDbApi.reindex(id);
      setBanner({ kind: "ok", text: "재인덱스 시작 — 진행 상황은 카드에서 확인하세요" });
      await load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string };
      setBanner({ kind: "err", text: err.response?.data?.detail ?? err.message ?? "재인덱스 실패" });
    } finally {
      setReindexingId(null);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await ragDbApi.delete(id);
      setBanner({ kind: "ok", text: "삭제 완료" });
      await load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string };
      setBanner({ kind: "err", text: err.response?.data?.detail ?? err.message ?? "삭제 실패" });
    } finally {
      setPendingDeleteId(null);
    }
  };

  const completedDocCount = useMemo(
    () => documents.filter((d) => d.status === "completed" && d.extracted_path).length,
    [documents],
  );

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-sm bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">9</span>
          <Library className="w-5 h-5 text-blue-600 flex-shrink-0" />
          <div>
            <div className="flex items-center gap-1">
              <h1 className="text-xl font-bold text-gray-900">{t("page.rag_db.title")}</h1>
              <PageHelp pageKey="ragDb" />
            </div>
            <p className="text-xs text-gray-500">{t("page.rag_db.desc")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 hover:bg-gray-100 rounded-lg" title="새로고침">
            <RefreshCw className="w-4 h-4 text-gray-500" />
          </button>
          <button
            onClick={openNew}
            disabled={completedDocCount === 0}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            title={completedDocCount === 0 ? "먼저 '문서 업로드'에서 문서를 추가하세요" : "새 RAG DB 만들기"}
          >
            <Plus className="w-4 h-4" />새 RAG DB
          </button>
        </div>
      </div>

      {/* 알림 배너 */}
      {banner && (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 border ${
          banner.kind === "ok"
            ? "bg-green-50 border-green-100 text-green-700"
            : "bg-red-50 border-red-100 text-red-700"
        }`}>
          {banner.kind === "ok"
            ? <CheckCircle className="w-4 h-4 flex-shrink-0" />
            : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
          <p className="text-sm flex-1">{banner.text}</p>
          <button onClick={() => setBanner(null)} className="text-xs opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* 컬렉션 목록 */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[...Array(2)].map((_, i) => <div key={i} className="bg-gray-100 rounded-xl h-40 animate-pulse" />)}
        </div>
      ) : collections.length === 0 ? (
        <div className="border border-dashed border-gray-200 rounded-xl p-10 text-center bg-white">
          <Library className="w-8 h-8 text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-gray-500 mb-1">아직 만들어진 RAG DB가 없습니다.</p>
          <p className="text-xs text-gray-400 mb-4">우측 상단 <b>+ 새 RAG DB</b> 버튼으로 시작하세요.</p>
          {completedDocCount === 0 && (
            <p className="text-xs text-amber-600">먼저 '문서 업로드' 페이지에서 문서 텍스트 추출을 완료해야 합니다.</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {collections.map((col) => {
            const isBusy = col.status === "pending" || col.status === "indexing";
            const isReindexing = reindexingId === col.id || isBusy;
            const isPendingDelete = pendingDeleteId === col.id;
            const pct = col.progress_total > 0
              ? Math.min(100, Math.round((col.progress_current / col.progress_total) * 100))
              : (col.status === "indexing" ? 5 : 0); // small sliver during warmup
            return (
              <div key={col.id} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                {/* 상단: 이름·통계 */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Library className="w-4 h-4 text-blue-500 flex-shrink-0" />
                      <h3 className="text-sm font-bold text-gray-900 truncate">{col.name}</h3>
                      {col.status === "failed" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold flex-shrink-0">실패</span>
                      )}
                    </div>
                    {col.description && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{col.description}</p>
                    )}
                  </div>
                </div>

                {/* 통계 */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-blue-50 rounded-lg py-1.5">
                    <p className="text-[10px] text-blue-600">문서</p>
                    <p className="text-sm font-bold text-blue-800">{col.document_count}</p>
                  </div>
                  <div className="bg-purple-50 rounded-lg py-1.5">
                    <p className="text-[10px] text-purple-600">청크</p>
                    <p className="text-sm font-bold text-purple-800">{col.chunk_count.toLocaleString()}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg py-1.5">
                    <p className="text-[10px] text-gray-500">갱신</p>
                    <p className="text-[11px] font-medium text-gray-700 truncate">{formatDate(col.updated_at)}</p>
                  </div>
                </div>

                {/* 인덱싱 진행 상황 */}
                {(isBusy || col.status === "failed") && (
                  <div className={`rounded-lg border px-3 py-2 ${
                    col.status === "failed"
                      ? "bg-red-50 border-red-100"
                      : "bg-blue-50 border-blue-100"
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      {col.status === "failed" ? (
                        <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                      ) : (
                        <Loader className="w-3.5 h-3.5 text-blue-500 animate-spin flex-shrink-0" />
                      )}
                      <p className={`text-xs font-medium truncate flex-1 ${
                        col.status === "failed" ? "text-red-700" : "text-blue-800"
                      }`}>
                        {col.progress_stage || (col.status === "pending" ? "대기 중..." : "진행 중...")}
                      </p>
                      {isBusy && col.progress_total > 0 && (
                        <span className="text-[10px] text-blue-600 tabular-nums flex-shrink-0">
                          {col.progress_current}/{col.progress_total}
                        </span>
                      )}
                    </div>
                    {isBusy && (
                      <div className="w-full bg-white/60 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-full bg-blue-500 transition-all duration-500 ease-out"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* 문서 목록 (미리보기) */}
                {col.documents.length > 0 && (
                  <div className="border-t border-gray-100 pt-2">
                    <p className="text-[10px] font-semibold text-gray-500 mb-1">포함 문서</p>
                    <div className="flex flex-wrap gap-1">
                      {col.documents.slice(0, 5).map((d) => (
                        <span key={d.document_id} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
                          {d.filename}
                        </span>
                      ))}
                      {col.documents.length > 5 && (
                        <span className="text-[10px] px-1.5 py-0.5 text-gray-400">+{col.documents.length - 5}</span>
                      )}
                    </div>
                  </div>
                )}

                {/* 액션 */}
                <div className="flex items-center justify-end gap-1 pt-1">
                  {isPendingDelete ? (
                    <>
                      <span className="text-xs text-red-600 mr-2">삭제할까요?</span>
                      <button
                        onClick={() => handleDelete(col.id)}
                        className="px-2 py-1 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded"
                      >확인</button>
                      <button
                        onClick={() => setPendingDeleteId(null)}
                        className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded"
                      >취소</button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => openEdit(col)}
                        disabled={isReindexing}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded disabled:opacity-40"
                        title="문서 편집"
                      ><Edit3 className="w-3 h-3" />편집</button>
                      <button
                        onClick={() => handleReindex(col.id)}
                        disabled={isReindexing || col.documents.length === 0}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded disabled:opacity-40"
                        title="전체 재인덱스"
                      >
                        {isReindexing
                          ? <Loader className="w-3 h-3 animate-spin" />
                          : <RefreshCw className="w-3 h-3" />}
                        {isReindexing ? "재인덱스 중" : "재인덱스"}
                      </button>
                      <button
                        onClick={() => ragDbApi.download(col.id)}
                        disabled={isReindexing || col.status !== "completed" || col.chunk_count === 0}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded disabled:opacity-40"
                        title="RAG DB 스냅샷 다운로드 (manifest + chunks.jsonl)"
                      ><Download className="w-3 h-3" />다운로드</button>
                      <button
                        onClick={() => setPendingDeleteId(col.id)}
                        disabled={isReindexing}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-40"
                        title="삭제"
                      ><Trash2 className="w-3 h-3" />삭제</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CollectionModal
        open={modalOpen}
        onClose={closeModal}
        onSubmit={handleSubmit}
        documents={documents}
        initial={editing}
        busy={busy}
      />
    </div>
  );
};

export default RagDb;
