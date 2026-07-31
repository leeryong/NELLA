import React, { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Loader, Paperclip, X, FileText, AlertCircle, ChevronDown, ChevronRight } from "lucide-react";
import { chatApi, documentsApi } from "../services/api";
import { cn } from "../lib/utils";

interface RagSource {
  document_id: number;
  filename: string;
  chunk_index: number;
  score: number;
  content: string;
  collection_id?: number;
  collection_name?: string;
}

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  attachmentName?: string; // display label only
  sources?: RagSource[];
}

// Defined at module scope so its identity is stable across parent re-renders.
// Otherwise the open/close state resets every time `useAgentPolling` ticks.
const SourcesList: React.FC<{ sources: RagSource[] }> = ({ sources }) => {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  return (
    <div className="mt-2 rounded-xl border border-gray-200 bg-white">
      <div className="px-3 py-1.5 text-[11px] font-semibold text-gray-500 border-b border-gray-100">
        📚 출처 ({sources.length})
      </div>
      <ul className="divide-y divide-gray-100">
        {sources.map((s, i) => {
          const isOpen = openIdx === i;
          return (
            <li key={`${s.document_id}-${s.chunk_index}`}>
              <button
                type="button"
                onClick={() => setOpenIdx(isOpen ? null : i)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-gray-50"
              >
                {isOpen ? (
                  <ChevronDown className="w-3 h-3 text-gray-400 flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-gray-400 flex-shrink-0" />
                )}
                <FileText className="w-3 h-3 text-blue-500 flex-shrink-0" />
                <span className="font-medium text-gray-700 truncate">{s.filename}</span>
                {s.collection_name && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 flex-shrink-0">{s.collection_name}</span>
                )}
                <span className="text-gray-400">· chunk {s.chunk_index}</span>
                <span className="ml-auto text-gray-500 tabular-nums">{s.score.toFixed(2)}</span>
              </button>
              {isOpen && (
                <div className="px-3 pb-2 pt-1 text-xs text-gray-600 whitespace-pre-wrap bg-gray-50 border-t border-gray-100">
                  {s.content}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export interface AttachedDocInfo {
  id: number;
  name: string;
  text: string;
  truncated: boolean;
  totalChars: number;
}

interface ChatWindowProps {
  modelPath: string;
  provider?: string;       // "openai" | "anthropic" | "ollama" | undefined(=local)
  providerModel?: string;  // optional model override for external providers
  modelName?: string;
  systemPrompt?: string;
  injectDoc?: AttachedDocInfo | null; // document injected from parent panel
  ragEnabled?: boolean;
  ragCollectionIds?: number[];
  ragTopK?: number;
  ragDefaultExtractor?: string;
  /** NELLA가 test_model_chat을 호출했을 때 그 Q&A를 메시지로 표시 */
  injectQA?: { question: string; answer: string; ts: number } | null;
  onInjectedQA?: () => void;
  /** NELLA 실행 중 preparing 단계 — 질문만 먼저 유저 메시지로 삽입 */
  pendingUserMessage?: { question: string; ts: number } | null;
  onPendingUserApplied?: () => void;
  /** NELLA 실행 중 generating 단계 — "응답 생성 중" 말풍선 표시 */
  agentThinking?: boolean;
}

interface AttachedDoc {
  id: number;
  name: string;
  text: string;
  truncated: boolean;
  totalChars: number;
}

const ChatWindow: React.FC<ChatWindowProps> = ({
  modelPath,
  provider,
  providerModel,
  modelName = "Model",
  systemPrompt = "You are a helpful AI assistant.",
  injectDoc,
  ragEnabled = false,
  ragCollectionIds = [],
  ragTopK = 4,
  ragDefaultExtractor = "openDataLoader",
  injectQA,
  onInjectedQA,
  pendingUserMessage,
  onPendingUserApplied,
  agentThinking = false,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Document attachment state ──────────────────────────
  const [attachedDoc, setAttachedDoc] = useState<AttachedDoc | null>(null);
  const [extractor, setExtractor] = useState(ragDefaultExtractor);

  // Sync doc injected from parent panel
  useEffect(() => {
    if (injectDoc) setAttachedDoc(injectDoc);
  }, [injectDoc]);
  useEffect(() => {
    setExtractor(ragDefaultExtractor);
  }, [ragDefaultExtractor]);

  // NELLA test_model_chat 결과를 메시지로 주입.
  // preparing 단계에서 이미 유저 메시지가 삽입돼 있으면 assistant 답변만 이어붙인다.
  const lastInjectedTsRef = useRef<number | null>(null);
  useEffect(() => {
    if (!injectQA || injectQA.ts === lastInjectedTsRef.current) return;
    lastInjectedTsRef.current = injectQA.ts;
    const now = new Date(injectQA.ts);
    setMessages((prev) => {
      const lastUser = [...prev].reverse().find((m) => m.role === "user");
      if (lastUser && lastUser.content === injectQA.question) {
        // 이미 preparing 단계에서 유저 메시지가 들어감 → 답변만 추가
        return [...prev, { role: "assistant", content: injectQA.answer, timestamp: now }];
      }
      return [
        ...prev,
        { role: "user", content: injectQA.question, timestamp: now },
        { role: "assistant", content: injectQA.answer, timestamp: new Date(injectQA.ts + 1) },
      ];
    });
    onInjectedQA?.();
  }, [injectQA, onInjectedQA]);

  // NELLA preparing 단계 — 질문만 유저 메시지로 미리 삽입
  const lastPendingUserTsRef = useRef<number | null>(null);
  useEffect(() => {
    if (!pendingUserMessage) return;
    if (pendingUserMessage.ts === lastPendingUserTsRef.current) return;
    lastPendingUserTsRef.current = pendingUserMessage.ts;
    setMessages((prev) => {
      const lastUser = [...prev].reverse().find((m) => m.role === "user");
      if (lastUser && lastUser.content === pendingUserMessage.question) return prev;
      return [
        ...prev,
        { role: "user", content: pendingUserMessage.question, timestamp: new Date(pendingUserMessage.ts) },
      ];
    });
    onPendingUserApplied?.();
  }, [pendingUserMessage, onPendingUserApplied]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── File upload handler ────────────────────────────────
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setUploading(true);
    setUploadError(null);
    setAttachedDoc(null);

    try {
      // 1. Upload & create document record
      const uploadRes = await documentsApi.upload(file, extractor);
      const docId = uploadRes.data.id;

      // 2. Poll until processing completes (max 2 min)
      let doc = uploadRes.data;
      for (let i = 0; i < 60; i++) {
        if (doc.status === "completed") break;
        if (doc.status === "failed") throw new Error(doc.error_message || "문서 처리에 실패했습니다.");
        await new Promise((r) => setTimeout(r, 2000));
        const res = await documentsApi.get(docId);
        doc = res.data;
      }
      if (doc.status !== "completed") throw new Error("문서 처리 시간 초과. 다시 시도해 주세요.");

      // 대화 창에서 첨부한 문서는 프롬프트에 붙여넣는 방식으로만 사용합니다.
      // RAG 검색 대상은 'RAG DB 생성' 페이지에서 만든 컬렉션이 담당합니다.
      const textRes = await documentsApi.getText(docId, 8000);
      setAttachedDoc({
        id: docId,
        name: file.name,
        text: textRes.data.text,
        truncated: textRes.data.truncated,
        totalChars: textRes.data.total_chars,
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "업로드 실패");
    } finally {
      setUploading(false);
    }
  };

  // ── Send message ───────────────────────────────────────
  const sendMessage = async () => {
    if ((!input.trim() && !attachedDoc) || loading) return;

    // Build display + API content
    const userText = input.trim();
    let apiContent = userText;
    let attachmentName: string | undefined;

    if (attachedDoc) {
      attachmentName = attachedDoc.name;
      const truncNote = attachedDoc.truncated
        ? ` (처음 ${attachedDoc.text.length.toLocaleString()}자 / 전체 ${attachedDoc.totalChars.toLocaleString()}자)`
        : "";
      apiContent = `[첨부 문서: ${attachedDoc.name}${truncNote}]\n\n${attachedDoc.text}${userText ? `\n\n---\n\n${userText}` : ""}`;
    }

    const userMessage: Message = {
      role: "user",
      content: userText || `[${attachedDoc!.name} 내용 분석 요청]`,
      timestamp: new Date(),
      attachmentName,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setAttachedDoc(null); // clear attachment after sending
    setLoading(true);
    setError(null);

    // Build full message list for API
    const apiMessages = [
      { role: "system" as const, content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: apiContent },
    ];

    try {
      const response = await chatApi.complete({
        model_path: modelPath,
        provider: provider || "local",
        provider_model: providerModel,
        messages: apiMessages,
        max_new_tokens: 512,
        temperature: 0.7,
        use_rag: ragEnabled && ragCollectionIds.length > 0,
        rag_collection_ids: ragCollectionIds,
        rag_document_ids: [],
        rag_top_k: ragTopK,
      });

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: response.data.response,
          timestamp: new Date(),
          sources: response.data.sources ?? [],
        },
      ]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "응답 생성에 실패했습니다.");
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
    setAttachedDoc(null);
    setUploadError(null);
  };

  const canSend = !loading && (!!input.trim() || !!attachedDoc);

  return (
    <div className="flex flex-col h-full bg-white rounded-lg border border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-lg">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-blue-600" />
          <div>
            <p className="text-sm font-medium text-gray-800">{modelName}</p>
            <p className="text-xs text-gray-500 truncate max-w-xs">
              {ragEnabled ? "RAG ON" : modelPath}
            </p>
          </div>
        </div>
        <button
          onClick={clearChat}
          className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 hover:bg-gray-200 rounded"
        >
          Clear
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <Bot className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">{ragEnabled ? "RAG 문서를 첨부하거나 질문을 입력하세요" : "대화를 시작하거나 문서를 첨부하세요"}</p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={cn("flex gap-3", msg.role === "user" ? "flex-row-reverse" : "flex-row")}
          >
            <div
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
                msg.role === "user" ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-600"
              )}
            >
              {msg.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>

            <div className={cn("max-w-[80%] space-y-1", msg.role === "user" ? "items-end flex flex-col" : "")}>
              {/* Attachment badge on user messages */}
              {msg.attachmentName && (
                <div className="flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full w-fit">
                  <FileText className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate max-w-[200px]">{msg.attachmentName}</span>
                </div>
              )}
              <div
                className={cn(
                  "rounded-2xl px-4 py-2.5",
                  msg.role === "user" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-800"
                )}
              >
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                <p className={cn("text-xs mt-1", msg.role === "user" ? "text-blue-200" : "text-gray-400")}>
                  {msg.timestamp.toLocaleTimeString()}
                </p>
              </div>
              {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (
                <SourcesList sources={msg.sources} />
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
              <Bot className="w-4 h-4 text-gray-600" />
            </div>
            <div className="bg-gray-100 rounded-2xl px-4 py-3">
              <Loader className="w-4 h-4 text-gray-400 animate-spin" />
            </div>
          </div>
        )}

        {agentThinking && !loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
              <Bot className="w-4 h-4 text-blue-600" />
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3 flex items-center gap-2">
              <span className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "120ms" }} />
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "240ms" }} />
              </span>
              <span className="text-xs text-blue-600 font-medium">NELLA가 응답을 생성하고 있어요...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="text-center">
            <p className="text-sm text-red-500 bg-red-50 px-4 py-2 rounded-lg inline-block">{error}</p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Attachment preview bar */}
      {(attachedDoc || uploading || uploadError) && (
        <div className="border-t border-gray-100 px-3 py-2 bg-gray-50">
          {uploading && (
              <div className="flex items-center gap-2 text-xs text-blue-600">
                <Loader className="w-3 h-3 animate-spin" />
              <span>문서 처리 중...</span>
              </div>
          )}
          {uploadError && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-red-600">
                <AlertCircle className="w-3 h-3" />
                <span>{uploadError}</span>
              </div>
              <button onClick={() => setUploadError(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          {attachedDoc && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-gray-700">
                <FileText className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                <span className="font-medium truncate max-w-[280px]">{attachedDoc.name}</span>
                <span className="text-gray-400">
                  {attachedDoc.truncated
                    ? `(${attachedDoc.text.length.toLocaleString()}자 / 전체 ${attachedDoc.totalChars.toLocaleString()}자)`
                    : `(${attachedDoc.totalChars.toLocaleString()}자)`}
                </span>
                {attachedDoc.truncated && (
                  <span className="text-yellow-600">· 일부만 첨부됨</span>
                )}
              </div>
              <button
                onClick={() => setAttachedDoc(null)}
                className="text-gray-400 hover:text-gray-600 ml-2"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-gray-200 p-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.hwp,.txt,.md"
          className="hidden"
          onChange={handleFileSelect}
        />
        <div className="flex gap-2 items-end">
          {/* Attach button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || uploading}
            title="문서 첨부 (PDF, DOCX, HWP, TXT)"
            className={cn(
              "p-2 rounded-xl border transition-colors flex-shrink-0",
              attachedDoc
                ? "border-blue-400 bg-blue-50 text-blue-600"
                : "border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300",
              (loading || uploading) && "opacity-50 cursor-not-allowed"
            )}
          >
            {uploading ? <Loader className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
          </button>

          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={attachedDoc ? "문서에 대해 질문하세요... (Enter로 전송)" : "메시지를 입력하세요... (Enter로 전송, Shift+Enter 줄바꿈)"}
            className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 max-h-32"
            rows={1}
            disabled={loading}
          />
          <button
            onClick={sendMessage}
            disabled={!canSend}
            className="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatWindow;
