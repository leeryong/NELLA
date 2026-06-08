import React, { useEffect, useState, useRef } from "react";
import { FileText, Trash2, Eye, RefreshCw, CheckCircle, AlertCircle, RotateCcw, X, ListOrdered, Eraser, ExternalLink, AlertTriangle, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import FileUpload from "../components/FileUpload";
import { documentsApi, Document } from "../services/api";
import { formatBytes, formatDate } from "../lib/utils";
import { useLocation } from "react-router-dom";
import { useAgentPolling } from "../hooks/useAgentPolling";
import { useAgentToolResult } from "../hooks/useAgentToolResult";

const OWNED_PATH = "/documents";
import { emitPipelineEvent, subscribeDocumentUploadEvents } from "../pipelineEvent";
import PageHelp from "../components/PageHelp";

const BASE_URL = import.meta.env.VITE_API_URL || "/api";

interface ProgressState {
  message: string;
  percent: number;
  done: boolean;
  error?: boolean;
  startedAt?: number;
  extractor?: string;
}

interface QueueItem {
  file: File;
  qid: string;
  extractor: string;
  extractImages: boolean;
}

// ── 처리 완료 소요 시간 (추출 시작 → 완료) ────────────
function calcDuration(startedAt: string | undefined, updatedAt?: string): string | null {
  if (!startedAt || !updatedAt) return null;
  const normalized = (s: string) => /[Z+]/.test(s) ? s : s + "Z";
  const ms = new Date(normalized(updatedAt)).getTime() - new Date(normalized(startedAt)).getTime();
  if (ms <= 0) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}초`;
  return `${Math.floor(ms / 60000)}분 ${Math.round((ms % 60000) / 1000)}초`;
}

// ── 경과 시간 훅 ───────────────────────────────────────
function useElapsed(startedAt?: number, active = true): string {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt || !active) { setElapsed(0); return; }
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(id);
  }, [startedAt, active]);
  if (!startedAt || !active) return "";
  const s = elapsed % 60;
  const m = Math.floor(elapsed / 60);
  return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}

// ── 실시간 경과 (SSE 독립) ─────────────────────────────
const LiveElapsed: React.FC<{ startedAt?: string; createdAt: string; status: string }> = ({ startedAt, createdAt, status }) => {
  const active = status === "pending" || status === "processing";
  const ts = React.useMemo(() => {
    const s = startedAt || createdAt;
    return new Date(/[Z+]/.test(s) ? s : s + "Z").getTime();
  }, [startedAt, createdAt]);
  const elapsed = useElapsed(ts, active);
  if (!active || !elapsed) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-blue-500 font-mono tabular-nums">
      <svg className="w-3 h-3 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
      </svg>
      진행 {elapsed}
    </span>
  );
};

// ── 진행 바 ────────────────────────────────────────────
const EXTRACTOR_LABELS: Record<string, string> = {
  openDataLoader: "OpenDataLoader",
  markitdown:     "MarkItDown",
  pypdf:          "PyPDF",
  docling:        "Docling",
};

const ProgressBar: React.FC<{ progress: ProgressState }> = ({ progress }) => {
  const elapsed = useElapsed(progress.startedAt, !progress.done && !progress.error);
  const isDone = progress.done && !progress.error;
  const extractorLabel = progress.extractor ? (EXTRACTOR_LABELS[progress.extractor] ?? progress.extractor) : null;
  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className={`flex items-center gap-1.5 ${isDone ? "text-green-600" : progress.error ? "text-red-600" : "text-blue-600"}`}>
          {isDone
            ? <CheckCircle className="w-3.5 h-3.5"/>
            : <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
              </svg>
          }
          {progress.message}
          {!isDone && !progress.error && extractorLabel && (
            <span className="ml-1 px-1.5 py-0.5 bg-blue-50 text-blue-500 rounded text-[10px] font-medium leading-none">
              {extractorLabel}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2 text-gray-400 font-mono tabular-nums">
          {elapsed && <span className={isDone ? "text-green-500" : "text-blue-500"}>{elapsed}</span>}
          <span>{progress.percent}%</span>
        </span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
        <div
          className="h-2 rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${progress.percent}%`,
            background: isDone ? "#22c55e" : "linear-gradient(90deg, #3b82f6 0%, #6366f1 50%, #3b82f6 100%)",
            backgroundSize: isDone ? undefined : "200% 100%",
            animation: isDone ? "none" : "shimmer 1.5s linear infinite",
          }}
        />
      </div>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
    </div>
  );
};

// ── 원본 문서 뷰어 모달 ────────────────────────────────
const DocViewerModal: React.FC<{ doc: Document; onClose: () => void }> = ({ doc, onClose }) => {
  const fileUrl = `${BASE_URL}/documents/${doc.id}/file`;
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 flex-shrink-0">
          <p className="text-sm font-semibold text-gray-900 truncate max-w-xl">{doc.filename}</p>
          <div className="flex items-center gap-2 flex-shrink-0">
            <a href={fileUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
              <ExternalLink className="w-3.5 h-3.5"/>새 창
            </a>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
              <X className="w-4 h-4 text-gray-500"/>
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <iframe src={fileUrl} className="w-full h-full rounded-b-xl" title={doc.filename}/>
        </div>
      </div>
    </div>
  );
};

// ── 마크다운 뷰어 모달 ─────────────────────────────────
const TextViewerModal: React.FC<{
  docId: number; filename: string; text: string; totalChars: number; truncated: boolean; loading?: boolean; error?: string; onClose: () => void;
}> = ({ docId, filename, text, totalChars, truncated, loading, error, onClose }) => {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);

  const imgSrc = (src: string) => {
    if (!src) return src;
    if (src.startsWith("http") || src.startsWith("/api")) return src;
    // Relative path like "images/foo.png" → serve via API
    const file = src.replace(/^images\//, "");
    return `${BASE_URL}/documents/${docId}/images/${file}`;
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <p className="text-sm font-semibold text-gray-900 truncate max-w-lg">{filename}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {loading ? "불러오는 중..." : `${totalChars.toLocaleString()}자${truncated ? " (일부)" : ""}`}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-4 h-4 text-gray-500"/></button>
        </div>
        <div className="flex-1 overflow-auto p-5">
          {loading ? (
            <div className="h-48 flex items-center justify-center gap-2 text-sm text-blue-600">
              <Loader2 className="w-4 h-4 animate-spin" />
              텍스트 미리보기를 불러오는 중...
            </div>
          ) : error ? (
            <p className="text-sm text-red-600 text-center py-16">{error}</p>
          ) : (
            <div className="prose prose-sm max-w-none text-gray-800
            prose-headings:text-gray-900 prose-headings:font-semibold
            prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline
            prose-code:bg-gray-100 prose-code:px-1 prose-code:rounded prose-code:text-xs
            prose-pre:bg-gray-900 prose-pre:text-gray-100
            prose-table:text-xs prose-th:bg-gray-50
            prose-img:rounded prose-img:max-w-full prose-img:my-2">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                img: ({ src, alt, ...props }) => (
                  <img src={imgSrc(src || "")} alt={alt || ""} {...props}
                    className="max-w-full rounded border border-gray-200 my-2"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ),
              }}
            >
              {text}
            </ReactMarkdown>
          </div>
          )}
        </div>
        {truncated && (
          <div className="px-5 py-2 border-t border-gray-100 bg-yellow-50 text-xs text-yellow-700 rounded-b-xl">
            처음 20,000자만 표시됩니다.
          </div>
        )}
      </div>
    </div>
  );
};

// ── 상태 뱃지 ──────────────────────────────────────────
const StatusBadge: React.FC<{ status: string; isExtracting?: boolean }> = ({ status, isExtracting }) => {
  const map: Record<string, { label: string; cls: string }> = {
    pending:    { label: "대기 중", cls: "bg-yellow-50 text-yellow-700" },
    processing: { label: "처리 중", cls: "bg-blue-50 text-blue-600" },
    completed:  { label: "완료",   cls: "bg-green-50 text-green-700" },
    failed:     { label: "실패",   cls: "bg-red-50 text-red-600" },
  };
  const { label, cls } = map[status] || { label: status, cls: "bg-gray-100 text-gray-500" };
  const showSpinner = isExtracting && (status === "processing" || status === "pending");
  return (
    <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {showSpinner
        ? <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/></svg>
        : status === "completed" ? <CheckCircle className="w-3 h-3"/>
        : status === "failed"    ? <AlertCircle className="w-3 h-3"/>
        : null}
      {label}
    </span>
  );
};

// ══════════════════════════════════════════════════════
// 메인 컴포넌트
// ══════════════════════════════════════════════════════
const Documents: React.FC = () => {
  const [documents, setDocuments]     = useState<Document[]>([]);
  const [pendingFiles, setPendingFiles]   = useState<QueueItem[]>([]); // 업로드 대기열
  const [uploading, setUploading]     = useState(false);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [progressMap, setProgressMap] = useState<Record<number, ProgressState>>({});
  const [currentUpload, setCurrentUpload] = useState<{ filename: string; fileSize: number; uploadPercent: number } | null>(null);
  const [modal, setModal]             = useState<{ docId: number; filename: string; text: string; totalChars: number; truncated: boolean; loading?: boolean; error?: string } | null>(null);
  const [docViewer, setDocViewer]     = useState<Document | null>(null);
  const [extractor, setExtractor]     = useState<string>("openDataLoader");
  const [extractImages, setExtractImages] = useState<boolean>(false);
  const [docSearch, setDocSearch]     = useState("");
  const [showAll, setShowAll]         = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Document | null>(null);

  const IMAGE_CAPABLE = new Set(["openDataLoader", "docling"]);

  const [completingSet, setCompletingSet] = useState<Set<number>>(new Set());

  const esRefs        = useRef<Record<number, EventSource>>({});
  const doneDocsRef   = useRef<Set<number>>(new Set()); // done 이벤트를 받은 doc id — 재구독 방지
  const queueRef      = useRef<QueueItem[]>([]);
  const processingRef = useRef(false);
  const textPreviewCacheRef = useRef<Record<number, { text: string; totalChars: number; truncated: boolean }>>({});

  // ── 문서 목록 로드 ─────────────────────────────────
  const loadDocuments = async () => {
    try {
      const res = await documentsApi.list();
      const docs: Document[] = res.data ?? [];
      setDocuments(docs);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const isActive = useLocation().pathname === OWNED_PATH;
  useAgentPolling(loadDocuments, { idle: 12_000, active: 2_500, enabled: isActive });
  useAgentToolResult(
    [
      "list_documents", "find_document", "get_document_status",
      "reprocess_document", "delete_document", "delete_all_documents",
      "wait_for_document",
    ],
    () => { void loadDocuments(); },
    isActive,
  );
  useEffect(() => () => { Object.values(esRefs.current).forEach((es) => es.close()); }, []);

  // pendingFiles에 파일이 있는데 processQueue가 죽어있으면 자동 재시작
  // (HMR/컴포넌트 재마운트 후 state 복원 시 처리 재개)
  useEffect(() => {
    if (pendingFiles.length > 0 && !processingRef.current) {
      queueRef.current = [...pendingFiles];
      processQueue();
    }
  }, [pendingFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  // 페이지 진입 시 pending/processing 문서에 자동 SSE 연결
  useEffect(() => {
    documents.forEach((doc) => {
      if ((doc.status === "pending" || doc.status === "processing") && !esRefs.current[doc.id] && !doneDocsRef.current.has(doc.id)) {
        const normalized = (s: string) => /[Z+]/.test(s) ? s : s + "Z";
        setProgressMap((prev) => {
          if (prev[doc.id]) return prev;
          const baseTime = doc.started_at || doc.created_at;
          return {
            ...prev,
            [doc.id]: {
              message: doc.status === "pending" ? "처리 대기 중..." : "텍스트 추출 중...",
              percent: 0,
              done: false,
              startedAt: new Date(normalized(baseTime)).getTime(),
              extractor: doc.extractor,
            },
          };
        });
        subscribeProgress(doc.id);
      }
    });
  }, [documents]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 일반 SSE (fire-and-forget) ─────────────────────
  const subscribeProgress = (docId: number) => {
    esRefs.current[docId]?.close();
    const es = new EventSource(`${BASE_URL}/documents/${docId}/progress`);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.heartbeat) return;
        setProgressMap((prev) => ({
          ...prev,
          [docId]: {
            message: data.message || "",
            percent: Math.max(0, Math.min(100, Math.round(data.percent ?? 0))),
            done: !!data.done,
            error: !!data.error,
            startedAt: prev[docId]?.startedAt,
            extractor: data.extractor || prev[docId]?.extractor,
          },
        }));
        if (data.done) {
          doneDocsRef.current.add(docId);
          es.close();
          delete esRefs.current[docId];
          setCompletingSet((prev) => new Set([...prev, docId]));
          setTimeout(() => {
            setCompletingSet((prev) => { const s = new Set(prev); s.delete(docId); return s; });
            loadDocuments();
          }, 1500);
        }
      } catch { /* ignore */ }
    };
    es.onerror = () => { es.close(); delete esRefs.current[docId]; };
    esRefs.current[docId] = es;
  };

  // ── Promise SSE (큐 처리용, 완료 시 resolve) ───────
  // SSE가 막혀도 5초마다 DB를 확인해 완료 시 강제 resolve
  const subscribeProgressAsync = (docId: number, startedAt: number, extractorHint?: string): Promise<void> => {
    return new Promise((resolve) => {
      let resolved = false;
      const doResolve = () => { if (!resolved) { resolved = true; resolve(); } };

      esRefs.current[docId]?.close();
      const es = new EventSource(`${BASE_URL}/documents/${docId}/progress`);
      setProgressMap((prev) => ({
        ...prev,
        [docId]: { message: "텍스트 추출 시작...", percent: 0, done: false, startedAt, extractor: extractorHint },
      }));

      // DB 폴링 fallback: SSE heartbeat만 오고 done이 없으면 5초마다 DB 확인
      const pollTimer = setInterval(async () => {
        try {
          const res = await documentsApi.list();
          const doc = (res.data as Document[]).find((d) => d.id === docId);
          if (!doc || doc.status === "completed" || doc.status === "failed") {
            clearInterval(pollTimer);
            es.close();
            delete esRefs.current[docId];
            doResolve();
          }
        } catch { /* ignore */ }
      }, 5000);

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.heartbeat) return;
          setProgressMap((prev) => ({
            ...prev,
            [docId]: {
              message: data.message || "",
              percent: Math.max(0, Math.min(100, Math.round(data.percent ?? 0))),
              done: !!data.done,
              error: !!data.error,
              startedAt,
              extractor: data.extractor || undefined,
            },
          }));
          if (data.done) {
            doneDocsRef.current.add(docId);
            clearInterval(pollTimer);
            es.close();
            delete esRefs.current[docId];
            setCompletingSet((prev) => new Set([...prev, docId]));
            // 애니메이션은 1.5초 동안 비차단으로 진행 — 완료 이벤트는 즉시 발행되도록 doResolve를 분리.
            setTimeout(() => {
              setCompletingSet((prev) => { const s = new Set(prev); s.delete(docId); return s; });
            }, 1500);
            doResolve();
          }
        } catch { /* ignore */ }
      };
      es.onerror = () => {
        clearInterval(pollTimer);
        es.close();
        delete esRefs.current[docId];
        doResolve();
      };
      esRefs.current[docId] = es;
    });
  };

  useEffect(() => {
    return subscribeDocumentUploadEvents((evt) => {
      if (evt.phase === "start") {
        setUploading(true);
        setCurrentUpload({
          filename: evt.filename,
          fileSize: evt.fileSize ?? 0,
          uploadPercent: evt.uploadPercent ?? 0,
        });
        return;
      }

      if (evt.phase === "progress") {
        setCurrentUpload((prev) => ({
          filename: prev?.filename ?? evt.filename,
          fileSize: prev?.fileSize ?? evt.fileSize ?? 0,
          uploadPercent: evt.uploadPercent ?? prev?.uploadPercent ?? 0,
        }));
        return;
      }

      if (evt.phase === "uploaded" && evt.docId) {
        setCurrentUpload(null);
        setUploading(true);
        setProgressMap((prev) => ({
          ...prev,
          [evt.docId!]: {
            message: "텍스트 추출 시작...",
            percent: 30,
            done: false,
            startedAt: Date.now(),
            extractor: evt.extractor,
          },
        }));
        loadDocuments();
        subscribeProgress(evt.docId);
        return;
      }

      if (evt.phase === "complete") {
        setCurrentUpload(null);
        setUploading(false);
        loadDocuments();
        return;
      }

      if (evt.phase === "failed") {
        setCurrentUpload(null);
        setUploading(false);
        setError(evt.message || `${evt.filename} 처리 실패`);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 순차 큐 처리 ───────────────────────────────────
  const processQueue = async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setUploading(true);

    while (queueRef.current.length > 0) {
      const item = queueRef.current[0];
      // 큐에서 꺼내기
      queueRef.current = queueRef.current.slice(1);
      setPendingFiles([...queueRef.current]);

      setCurrentUpload({ filename: item.file.name, fileSize: item.file.size, uploadPercent: 0 });
      emitPipelineEvent({ kind: "start", label: "📄 문서 업로드", detail: item.file.name });

      try {
        const res = await documentsApi.upload(item.file, item.extractor, item.extractImages, (pct) => {
          setCurrentUpload((prev) => prev ? { ...prev, uploadPercent: pct } : null);
        });
        const docId = res.data.id;
        setCurrentUpload(null);
        await loadDocuments();
        emitPipelineEvent({ kind: "start", label: "📄 텍스트 추출 중", detail: item.file.name });
        await subscribeProgressAsync(docId, Date.now(), item.extractor);
        await loadDocuments();
        emitPipelineEvent({ kind: "complete", label: "📄 문서 처리 완료", detail: item.file.name });
      } catch (e: unknown) {
        setCurrentUpload(null);
        const err = e as { response?: { data?: { detail?: unknown } } };
        const errMsg = err.response?.data?.detail ? JSON.stringify(err.response.data.detail) : `${item.file.name} 처리 실패`;
        emitPipelineEvent({ kind: "failed", label: "📄 문서 처리 실패", detail: item.file.name });
        setError(errMsg);
      }
    }

    processingRef.current = false;
    setUploading(false);
  };

  // ── 파일 추가 즉시 큐에 넣기 ──────────────────────
  const handleFilesAdded = (files: File[]) => {
    setError(null);
    const newItems: QueueItem[] = files.map((file) => ({
      file,
      qid: Math.random().toString(36).slice(2),
      extractor,
      extractImages: IMAGE_CAPABLE.has(extractor) && extractImages,
    }));
    queueRef.current = [...queueRef.current, ...newItems];
    setPendingFiles([...queueRef.current]);
    processQueue();
  };

  // ── 대기열에서 제거 (아직 업로드 안 된 파일) ───────
  const handleRemoveFromQueue = (qid: string) => {
    queueRef.current = queueRef.current.filter((item) => item.qid !== qid);
    setPendingFiles([...queueRef.current]);
  };

  // ── DB 문서 삭제 (SSE 취소 포함) ──────────────────
  const handleDelete = async (id: number) => {
    esRefs.current[id]?.close(); delete esRefs.current[id];
    setProgressMap((prev) => { const n = { ...prev }; delete n[id]; return n; });
    delete textPreviewCacheRef.current[id];
    if (modal?.docId === id) setModal(null);
    // Optimistic update — UI에서 즉시 제거. 백엔드 요청은 백그라운드로 보내고, 실패 시에만 복원.
    setDocuments((prev) => prev.filter((d) => d.id !== id));
    void documentsApi.delete(id).catch((err) => {
      console.error(err);
      void loadDocuments();
    });
  };

  const handleDeleteAll = async () => {
    setConfirmDeleteAll(false);
    // 큐 비우기
    queueRef.current = [];
    setPendingFiles([]);
    // SSE 전부 닫기
    Object.values(esRefs.current).forEach((es) => es.close());
    esRefs.current = {};
    setProgressMap({});
    textPreviewCacheRef.current = {};
    try {
      await documentsApi.deleteAll();
      setDocuments([]);
    } catch (err) {
      console.error(err);
      await loadDocuments();
    }
  };

  const handleReprocess = async (id: number, ext?: string) => {
    const url = ext ? `${BASE_URL}/documents/${id}/reprocess?extractor=${ext}` : `${BASE_URL}/documents/${id}/reprocess`;
    await fetch(url, { method: "POST" });
    setProgressMap((prev) => ({ ...prev, [id]: { message: "재처리 시작...", percent: 3, done: false, startedAt: Date.now() } }));
    subscribeProgress(id);
    loadDocuments();
  };

  const handleViewText = async (doc: Document) => {
    const cached = textPreviewCacheRef.current[doc.id];
    setModal({
      docId: doc.id,
      filename: doc.filename,
      text: cached?.text ?? "",
      totalChars: cached?.totalChars ?? doc.char_count ?? 0,
      truncated: cached?.truncated ?? false,
      loading: !cached,
    });
    if (cached) return;
    try {
      const res = await documentsApi.getText(doc.id, 20000);
      const preview = {
        text: res.data.text,
        totalChars: res.data.total_chars,
        truncated: res.data.truncated,
      };
      textPreviewCacheRef.current[doc.id] = preview;
      setModal((current) => current?.docId === doc.id ? {
        ...current,
        ...preview,
        loading: false,
      } : current);
    } catch {
      setModal((current) => current?.docId === doc.id ? {
        ...current,
        loading: false,
        error: "추출된 텍스트를 불러올 수 없습니다.",
      } : current);
    }
  };

  // ── 총 대기열 수 (대기열 파일 + DB pending 문서) ───
  const dbPendingCount = documents.filter((d) => d.status === "pending" || d.status === "processing").length;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {docViewer && (
        <DocViewerModal doc={docViewer} onClose={() => setDocViewer(null)}/>
      )}
      {modal && (
        <TextViewerModal
          docId={modal.docId} filename={modal.filename} text={modal.text}
          totalChars={modal.totalChars} truncated={modal.truncated}
          loading={modal.loading} error={modal.error}
          onClose={() => setModal(null)}
        />
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="w-7 h-7 rounded-md bg-blue-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">1</span>
          <FileText className="w-5 h-5 text-blue-600 flex-shrink-0" />
          <div>
            <div className="flex items-center gap-1"><h1 className="text-xl font-bold text-gray-900">문서 업로드</h1><PageHelp pageKey="documents" /></div>
            <p className="text-xs text-gray-500">PDF · DOCX · HWP 업로드 및 텍스트 추출</p>
          </div>
        </div>
        <button onClick={loadDocuments} className="p-2 hover:bg-gray-100 rounded-lg">
          <RefreshCw className="w-4 h-4 text-gray-500"/>
        </button>
      </div>

      {/* 파일 선택 영역 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-sm font-semibold text-gray-700">문서 선택</h2>
          <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded">한 번에 하나씩 순차 추출</span>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-600">텍스트 추출 방식</p>
          <div className="flex flex-wrap gap-2">
            {([
              { value: "pypdf",          label: "PyPDF",          desc: "가볍고 빠름",                   gpu: null },
              { value: "markitdown",     label: "MarkItDown",     desc: "MS MarkItDown",                gpu: null },
              { value: "openDataLoader", label: "OpenDataLoader", desc: "PDF 구조 분석 + 이미지 (기본값)", gpu: null },
              { value: "docling",        label: "Docling",        desc: "IBM Docling + 이미지",          gpu: "GPU/MPS" },
            ] as { value: string; label: string; desc: string; gpu: string | null }[]).map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={uploading}
                onClick={() => {
                  setExtractor(opt.value);
                  if (!IMAGE_CAPABLE.has(opt.value)) setExtractImages(false);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${
                  extractor === opt.value
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600"
                }`}
              >
                <span className="font-semibold">{opt.label}</span>
                <span className={`ml-1 ${extractor === opt.value ? "text-blue-100" : "text-gray-400"}`}>
                  — {opt.desc}
                </span>
                {opt.gpu && (
                  <span className={`ml-1 px-1 py-px rounded text-xs font-bold ${extractor === opt.value ? "bg-white/20 text-white" : "bg-green-100 text-green-700"}`}>
                    {opt.gpu}
                  </span>
                )}
              </button>
            ))}
          </div>
          {IMAGE_CAPABLE.has(extractor) && (
            <label className="flex items-center gap-1.5 cursor-pointer select-none w-fit">
              <input
                type="checkbox"
                checked={extractImages}
                onChange={(e) => setExtractImages(e.target.checked)}
                disabled={uploading}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-400"
              />
              <span className="text-xs text-gray-600">이미지도 추출 (별도 폴더에 저장, 마크다운에 링크 삽입)</span>
            </label>
          )}
        </div>
        <FileUpload
          multiple={true}
          onFilesSelect={(files) => {
            const existing = new Set(pendingFiles.map((q) => q.file.name));
            const newFiles = files.filter((f) => !existing.has(f.name));
            if (newFiles.length > 0) handleFilesAdded(newFiles);
          }}
          uploading={uploading}
        />
        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}
      </div>

      {/* 처리 대기열 (아직 업로드 안 된 파일) */}
      {pendingFiles.length > 0 && (
        <div className="bg-white rounded-xl border border-yellow-200">
          <div className="px-5 py-3 border-b border-yellow-100 flex items-center gap-2">
            <ListOrdered className="w-4 h-4 text-yellow-600"/>
            <h2 className="text-sm font-semibold text-yellow-800">처리 대기열 ({pendingFiles.length}개)</h2>
            <span className="text-xs text-yellow-600 ml-1">— 현재 처리 완료 후 순서대로 진행됩니다</span>
          </div>
          <div className="divide-y divide-yellow-50">
            {pendingFiles.map((item, idx) => (
              <div key={item.qid} className="px-5 py-2.5 flex items-center gap-3 bg-yellow-50/40">
                <span className="text-xs font-bold text-yellow-500 w-5 text-center">{idx + 1}</span>
                <FileText className="w-4 h-4 text-yellow-400 flex-shrink-0"/>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-700 truncate">{item.file.name}</p>
                  <p className="text-xs text-gray-400">{formatBytes(item.file.size)}</p>
                </div>
                <span className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded font-medium">대기 중</span>
                <button
                  onClick={() => handleRemoveFromQueue(item.qid)}
                  className="p-1.5 hover:bg-yellow-200 rounded"
                  title="대기열에서 제거"
                >
                  <X className="w-3.5 h-3.5 text-yellow-600"/>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 현재 업로드 중인 파일 (통합 프로그레스 바 0-30%) */}
      {currentUpload && (
        <div className="bg-white rounded-xl border border-blue-200">
          <div className="px-5 py-2.5 border-b border-blue-100 flex items-center gap-2">
            <svg className="w-4 h-4 animate-spin text-blue-500 flex-shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
            </svg>
            <h2 className="text-sm font-semibold text-blue-800">업로드 중</h2>
          </div>
          <div className="px-5 py-3 flex items-start gap-3">
            <FileText className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5"/>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-700 truncate">{currentUpload.filename}</p>
              <p className="text-xs text-gray-400">{formatBytes(currentUpload.fileSize)}</p>
              <ProgressBar progress={{
                message: `업로드 중 (${currentUpload.uploadPercent}%)`,
                percent: Math.round(currentUpload.uploadPercent * 0.3),
                done: false,
              }}/>
              <p className="text-xs text-gray-400 mt-1">
                업로드 완료 후 텍스트 추출이 시작됩니다 (진행률 30%~100%)
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 페이지 재진입 시 복원: 로컬 큐 없이 백엔드가 처리 중인 문서 */}
      {pendingFiles.length === 0 && !currentUpload && dbPendingCount > 0 && (
        <div className="bg-white rounded-xl border border-blue-200">
          <div className="px-5 py-3 border-b border-blue-100 flex items-center gap-2">
            <svg className="w-4 h-4 animate-spin text-blue-500 flex-shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
            </svg>
            <h2 className="text-sm font-semibold text-blue-800">처리 중 ({dbPendingCount}개)</h2>
            <span className="text-xs text-blue-600 ml-1">— 텍스트 추출이 백그라운드에서 진행 중입니다</span>
          </div>
          <div className="divide-y divide-blue-50">
            {documents
              .filter((d) => d.status === "pending" || d.status === "processing")
              .map((doc) => {
                const progress = progressMap[doc.id];
                const progressData: ProgressState = progress ?? {
                  message: doc.status === "pending" ? "처리 대기 중..." : "텍스트 추출 중...",
                  percent: doc.status === "pending" ? 5 : 30,
                  done: false,
                  startedAt: undefined,
                };
                return (
                  <div key={doc.id} className="px-5 py-3 flex items-start gap-3 bg-blue-50/20">
                    <FileText className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5"/>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs font-medium text-gray-700 truncate">{doc.filename}</p>
                        <StatusBadge status={doc.status} isExtracting={true}/>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{formatBytes(doc.file_size)}</p>
                      <ProgressBar progress={progressData}/>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* 문서 목록 */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            업로드된 문서 ({(pendingFiles.length === 0 && !currentUpload && dbPendingCount > 0)
              ? documents.length - dbPendingCount
              : documents.length})
          </h2>
          <div className="flex items-center gap-2">
            {dbPendingCount > 0 && (
              <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded font-medium">
                {dbPendingCount}개 처리 중
              </span>
            )}
            {documents.length > 0 && (
              confirmDeleteAll ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-red-600 font-medium">{documents.length}개 모두 삭제?</span>
                  <button
                    onClick={handleDeleteAll}
                    className="px-2 py-0.5 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded transition-colors"
                  >확인</button>
                  <button
                    onClick={() => setConfirmDeleteAll(false)}
                    className="px-2 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded transition-colors"
                  >취소</button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDeleteAll(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="전체 삭제 (진행 중인 처리 중단 포함)"
                >
                  <Eraser className="w-3.5 h-3.5"/>
                  전체 삭제
                </button>
              )
            )}
          </div>
        </div>
        {/* 검색 */}
        {documents.length > 5 && (
          <div className="px-5 py-2 border-b border-gray-100">
            <input
              type="text"
              placeholder="파일명 검색..."
              value={docSearch}
              onChange={(e) => { setDocSearch(e.target.value); setShowAll(true); }}
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm"
            />
          </div>
        )}
        {loading ? (
          <div className="p-8 text-center text-gray-400">로딩 중...</div>
        ) : documents.length === 0 ? (
          <div className="p-8 text-center">
            <FileText className="w-10 h-10 text-gray-300 mx-auto mb-2"/>
            <p className="text-gray-400 text-sm">업로드된 문서가 없습니다</p>
          </div>
        ) : (() => {
          // 복원 섹션에서 이미 보여주는 처리 중 문서는 여기서 제외
          const recoveryActive = pendingFiles.length === 0 && !currentUpload && dbPendingCount > 0;
          const PAGE = 20;
          const base = recoveryActive
            ? documents.filter((d) => d.status !== "pending" && d.status !== "processing")
            : documents;
          const filtered = docSearch
            ? base.filter((d) => d.filename.toLowerCase().includes(docSearch.toLowerCase()))
            : base;
          const visible = showAll ? filtered : filtered.slice(0, PAGE);
          return (
          <div className="divide-y divide-gray-50">
            {visible.map((doc) => {
              const progress = progressMap[doc.id];
              const duration = doc.status === "completed" ? calcDuration(doc.started_at, doc.updated_at) : null;
              const isProcessing = doc.status === "pending" || doc.status === "processing";
              const isActive = isProcessing && (!progress || !progress.done);
              const isCompleting = completingSet.has(doc.id);
              const showProgress = isActive || isCompleting;
              const progressData: ProgressState = progress ?? {
                message: doc.status === "pending" ? "처리 대기 중..." : "텍스트 추출 중...",
                percent: doc.status === "pending" ? 0 : 30,
                done: false,
              };
              const progressDisplay: ProgressState = isCompleting && progress
                ? { ...progress, percent: 100, message: "처리 완료", done: true }
                : progressData;

              const extractorLabel: Record<string, { label: string; cls: string }> = {
                pypdf:          { label: "PyPDF",          cls: "bg-gray-100 text-gray-500" },
                markitdown:     { label: "MarkItDown",     cls: "bg-blue-50 text-blue-600" },
                openDataLoader: { label: "OpenDataLoader", cls: "bg-purple-50 text-purple-600" },
                docling:        { label: "Docling",        cls: "bg-indigo-50 text-indigo-600" },
              };
              const extractorInfo = doc.extractor ? extractorLabel[doc.extractor] ?? { label: doc.extractor, cls: "bg-gray-100 text-gray-500" } : null;

              return (
                <div key={doc.id} className="px-5 py-3 hover:bg-gray-50">
                  <div className="flex items-start gap-3">
                    {/* Thumbnail or fallback icon — 클릭 시 원본 문서 팝업 */}
                    {doc.thumbnail_path ? (
                      <button
                        onClick={() => setDocViewer(doc)}
                        className="flex-shrink-0 group relative cursor-pointer"
                        title="클릭하여 원본 문서 보기"
                      >
                        <img
                          src={`${BASE_URL}/documents/${doc.id}/thumbnail`}
                          alt="썸네일"
                          className="w-[60px] h-[84px] object-cover rounded border border-gray-200 bg-gray-50 group-hover:opacity-70 transition-opacity"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Eye className="w-5 h-5 text-white drop-shadow-md"/>
                        </div>
                      </button>
                    ) : (
                      <button
                        onClick={() => doc.original_path ? setDocViewer(doc) : undefined}
                        disabled={!doc.original_path}
                        className="flex-shrink-0 p-1 hover:bg-gray-100 rounded disabled:opacity-40 disabled:cursor-default"
                        title="원본 문서 보기"
                      >
                        <FileText className="w-5 h-5 text-gray-400 mt-0.5"/>
                      </button>
                    )}
                    <div className="flex-1 min-w-0">
                      {/* 파일명 + 배지 + 액션 버튼 (한 줄) */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-gray-800 truncate">{doc.filename}</p>
                        {extractorInfo && (
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${extractorInfo.cls}`}>
                            {extractorInfo.label}
                          </span>
                        )}
                        <StatusBadge status={doc.status} isExtracting={isActive}/>
                        <div className="flex gap-1 items-center ml-auto flex-shrink-0">
                          {doc.status === "completed" && doc.extracted_path && (
                            <button
                              onClick={() => handleViewText(doc)}
                              className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-medium transition-colors"
                              title="추출 텍스트 미리보기 (모달)"
                            >
                              <Eye className="w-3.5 h-3.5"/>
                              미리보기
                            </button>
                          )}
                          {doc.status === "completed" && doc.extracted_path && (
                            <a
                              href={`${BASE_URL}/documents/${doc.id}/extracted-file`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 hover:bg-green-100 rounded"
                              title="추출 텍스트 파일 새 창에서 열기"
                            >
                              <ExternalLink className="w-3.5 h-3.5 text-green-600"/>
                            </a>
                          )}
                          {doc.status === "completed" && doc.original_path && (
                            <a
                              href={`${BASE_URL}/documents/${doc.id}/file`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 hover:bg-gray-100 rounded"
                              title="원본 파일 새 창에서 열기"
                            >
                              <FileText className="w-3.5 h-3.5 text-gray-500"/>
                            </a>
                          )}
                          {!isActive && !isCompleting && (
                            <button
                              onClick={() => handleReprocess(doc.id)}
                              className="p-1.5 hover:bg-blue-100 rounded"
                              title="재추출"
                            >
                              <RotateCcw className="w-4 h-4 text-blue-400"/>
                            </button>
                          )}
                          <button
                            onClick={() => setConfirmDelete(doc)}
                            className="p-1.5 hover:bg-red-100 rounded"
                            title="삭제 (처리 중이면 취소 후 삭제)"
                          >
                            <Trash2 className="w-4 h-4 text-red-400"/>
                          </button>
                        </div>
                      </div>
                      {/* 파일 정보 */}
                      <p className="text-xs text-gray-400 mt-0.5">
                        {formatBytes(doc.file_size)}
                        {doc.page_count ? ` · ${doc.page_count}페이지` : ""}
                        {doc.word_count != null ? ` · ${doc.word_count.toLocaleString()}단어` : ""}
                      </p>
                      {/* 업로드 시각 + 처리 시간 */}
                      <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                        <span>업로드: {formatDate(doc.created_at)}</span>
                        {duration
                          ? <span className="text-green-600">· 처리 완료 {duration}</span>
                          : <LiveElapsed startedAt={doc.started_at} createdAt={doc.created_at} status={doc.status}/>
                        }
                      </p>
                      {/* 진행 바 */}
                      {showProgress && <ProgressBar progress={progressDisplay}/>}
                      {/* 오류 */}
                      {progress?.error && (
                        <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3"/>{progress.message}
                        </p>
                      )}
                      {/* 추출 파일 경로 (클릭 시 다운로드) */}
                      {doc.status === "completed" && !isActive && !isCompleting && doc.extracted_path && (
                        <a
                          href={`${BASE_URL}/documents/${doc.id}/extracted-file`}
                          download
                          className="text-xs text-gray-400 hover:text-blue-600 mt-1 font-mono break-all block hover:underline cursor-pointer"
                          title="클릭하여 추출 파일 다운로드"
                        >
                          <span className="text-gray-300">→ </span>{doc.extracted_path}
                        </a>
                      )}
                      {/* 텍스트 추출 결과 없음 */}
                      {doc.status === "completed" && !isActive && !isCompleting && !doc.extracted_path && (
                        <p className="text-xs text-gray-400 mt-1">텍스트 없음 — 이미지/스캔 PDF이거나 빈 문서일 수 있습니다.</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {!showAll && filtered.length > PAGE && (
              <div className="px-5 py-3 text-center">
                <button
                  onClick={() => setShowAll(true)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  더보기 ({filtered.length - PAGE}개 더 있음)
                </button>
              </div>
            )}
          </div>
          );
        })()}
      </div>

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-5 h-5 text-red-500"/>
              <h3 className="text-base font-semibold text-gray-900">문서 삭제</h3>
            </div>
            <p className="text-sm text-gray-600 mb-2">
              <span className="font-medium">{confirmDelete.filename}</span> 문서를 삭제하시겠습니까?
            </p>
            <p className="text-xs text-gray-400 mb-6">처리 중이면 취소 후 삭제됩니다. 되돌릴 수 없습니다.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">취소</button>
              <button
                onClick={() => { const id = confirmDelete.id; setConfirmDelete(null); handleDelete(id); }}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700"
              >삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Documents;
