/**
 * 파이프라인 각 단계에서 사용자 액션(시작/완료/실패/취소)을 window 이벤트로 발행합니다.
 * AgentChat이 구독하여 에이전트 터미널에 실시간으로 표시합니다.
 */

export type PipelineEventKind = "start" | "complete" | "failed" | "cancel";

export interface PipelineEvent {
  kind: PipelineEventKind;
  label: string;   // 표시 레이블 (예: "📄 문서 업로드")
  detail?: string; // 부가 정보 (예: "report.pdf")
}

const EVENT_NAME = "nella-pipeline-event";
const DOCUMENT_UPLOAD_EVENT_NAME = "nella-document-upload-event";

export interface DocumentUploadEvent {
  phase: "start" | "progress" | "uploaded" | "complete" | "failed";
  filename: string;
  fileSize?: number;
  uploadPercent?: number;
  docId?: number;
  extractor?: string;
  message?: string;
}

export function emitPipelineEvent(event: PipelineEvent): void {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: event }));
}

export function subscribePipelineEvents(
  handler: (event: PipelineEvent) => void
): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<PipelineEvent>).detail);
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}

export function emitDocumentUploadEvent(event: DocumentUploadEvent): void {
  window.dispatchEvent(new CustomEvent(DOCUMENT_UPLOAD_EVENT_NAME, { detail: event }));
}

export function subscribeDocumentUploadEvents(
  handler: (event: DocumentUploadEvent) => void
): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<DocumentUploadEvent>).detail);
  window.addEventListener(DOCUMENT_UPLOAD_EVENT_NAME, listener);
  return () => window.removeEventListener(DOCUMENT_UPLOAD_EVENT_NAME, listener);
}
