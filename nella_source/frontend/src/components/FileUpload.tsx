import React, { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, FileText, X } from "lucide-react";
import { cn, formatBytes } from "../lib/utils";

// ── 단일 파일 props (기존 호환 유지)
interface SingleFileProps {
  multiple?: false;
  onFileSelect: (file: File) => void;
  selectedFile?: File | null;
  onRemove?: () => void;
  accept?: Record<string, string[]>;
  maxSize?: number;
  uploading?: boolean;
  label?: string;
  description?: string;
}

// ── 복수 파일 props
interface MultiFileProps {
  multiple: true;
  onFilesSelect: (files: File[]) => void;
  selectedFiles?: File[];
  onRemoveFile?: (index: number) => void;
  accept?: Record<string, string[]>;
  maxSize?: number;
  uploading?: boolean;
  label?: string;
  description?: string;
}

type FileUploadProps = SingleFileProps | MultiFileProps;

const DEFAULT_ACCEPT = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
  "text/plain": [".txt"],
  "text/markdown": [".md"],
};

const FileUpload: React.FC<FileUploadProps> = (props) => {
  const {
    accept = DEFAULT_ACCEPT,
    maxSize = 100 * 1024 * 1024,
    uploading = false,
    label = "문서 업로드",
    description = "PDF, DOCX, XLSX, PPTX, TXT — 최대 100MB",
  } = props;

  const isMulti = props.multiple === true;

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;
      if (isMulti) {
        (props as MultiFileProps).onFilesSelect(acceptedFiles);
      } else {
        (props as SingleFileProps).onFileSelect(acceptedFiles[0]);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isMulti, props]
  );

  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    onDrop,
    accept,
    maxSize,
    multiple: isMulti,
    disabled: uploading,
  });

  // ── 복수 파일 selected 표시
  if (isMulti) {
    const mProps = props as MultiFileProps;
    const files = mProps.selectedFiles ?? [];
    return (
      <div className="space-y-2">
        <div
          {...getRootProps()}
          className={cn(
            "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
            isDragActive ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-blue-400 hover:bg-gray-50",
            uploading && "opacity-50 cursor-not-allowed"
          )}
        >
          <input {...getInputProps()} />
          <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
          <p className="text-sm font-medium text-gray-700">
            {isDragActive ? "파일을 놓으세요" : label}
          </p>
          <p className="text-xs text-gray-400 mt-1">{description} · 여러 파일 동시 선택 가능</p>
        </div>

        {files.length > 0 && (
          <div className="space-y-1.5">
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`}
                className="flex items-center gap-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                <FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-blue-800 truncate">{f.name}</p>
                  <p className="text-xs text-blue-500">{formatBytes(f.size)}</p>
                </div>
                {mProps.onRemoveFile && !uploading && (
                  <button onClick={() => mProps.onRemoveFile!(i)} className="p-1 hover:bg-blue-100 rounded">
                    <X className="w-3.5 h-3.5 text-blue-500" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {fileRejections.length > 0 && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            {fileRejections[0].errors.map((e) => e.message).join(", ")}
          </p>
        )}
      </div>
    );
  }

  // ── 단일 파일 (기존 동작)
  const sProps = props as SingleFileProps;
  const selectedFile = sProps.selectedFile;

  if (selectedFile) {
    return (
      <div className="flex items-center gap-3 p-4 border border-green-200 bg-green-50 rounded-lg">
        <FileText className="w-6 h-6 text-green-600 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-green-800 truncate">{selectedFile.name}</p>
          <p className="text-xs text-green-600">{formatBytes(selectedFile.size)}</p>
        </div>
        {sProps.onRemove && !uploading && (
          <button onClick={sProps.onRemove} className="p-1 hover:bg-green-100 rounded">
            <X className="w-4 h-4 text-green-600" />
          </button>
        )}
        {uploading && <div className="animate-spin rounded-full h-5 w-5 border-2 border-green-600 border-t-transparent" />}
      </div>
    );
  }

  return (
    <div>
      <div
        {...getRootProps()}
        className={cn(
          "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
          isDragActive ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-blue-400 hover:bg-gray-50",
          uploading && "opacity-50 cursor-not-allowed"
        )}
      >
        <input {...getInputProps()} />
        <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
        <p className="text-sm font-medium text-gray-700">{isDragActive ? "파일을 놓으세요" : label}</p>
        <p className="text-xs text-gray-500 mt-1">{description}</p>
        <p className="text-xs text-gray-400 mt-1">또는 드래그 앤 드롭</p>
      </div>
      {fileRejections.length > 0 && (
        <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
          {fileRejections[0].errors.map((e) => e.message).join(", ")}
        </div>
      )}
    </div>
  );
};

export default FileUpload;
