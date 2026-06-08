import React from 'react'

const steps = [
  'PDF / HWP / Office 파일 업로드',
  'Docling 으로 레이아웃/텍스트 추출',
  'MarkItDown 으로 Markdown 전환 + 버전 보관',
  'OCR(필요 시) 및 이미지 에셋 폴더링',
]

const jobs = [
  { name: 'TinyStories.pdf', status: '변환 중', progress: 72 },
  { name: '연구계약서.hwp', status: '대기', progress: 0 },
  { name: '세미나노트.pptx', status: '완료', progress: 100 },
]

const Upload: React.FC = () => {
  return (
    <div className="page-wrap">
      <h1>문서 업로드 & 전처리</h1>
      <p className="subtitle">드래그-앤-드롭으로 올리면 에이전트가 Docling + MarkItDown 파이프라인을 실행합니다.</p>

      <div className="flex-card">
        <div className="card">
          <h2>업로드</h2>
          <p>한 번에 2GB까지 업로드 가능 · 다중 파일 지원 · 자동 중복 검사</p>
          <div className="dropzone">여기에 파일을 끌어다 놓거나 클릭해서 선택</div>
          <ul>
            {steps.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h2>작업 큐</h2>
          <div className="status-list">
            {jobs.map((job) => (
              <div key={job.name} className="status-item">
                <div>
                  <strong>{job.name}</strong>
                  <span>{job.status}</span>
                </div>
                <div className="progress">
                  <div style={{ width: `${job.progress}%` }} />
                </div>
              </div>
            ))}
          </div>
          <p className="note">모든 산출물은 `/data/documents/YYYY/MM/DD/` 경로에 버전별로 저장됩니다.</p>
        </div>
      </div>
    </div>
  )
}

export default Upload
