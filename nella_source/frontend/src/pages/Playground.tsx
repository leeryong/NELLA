import React from 'react'

const Playground: React.FC = () => {
  return (
    <div className="page-wrap">
      <h1>모델 Playground</h1>
      <p className="subtitle">학습된 체크포인트로 질문/응답을 시험하고, 에이전트/토큰 사용량을 모니터링합니다.</p>

      <div className="flex-card">
        <div className="card">
          <h2>세션 설정</h2>
          <label className="field">
            <span>모델</span>
            <select>
              <option>qwen2.5-3b-lora-20260402</option>
              <option>smollm2-1.7b-sft-a</option>
            </select>
          </label>
          <label className="field">
            <span>프롬프트</span>
            <textarea rows={6} defaultValue={'Q: 정책 A와 정책 B의 차이점을 설명해줘.'}></textarea>
          </label>
          <div className="pill-row">
            <button className="btn">응답 생성</button>
            <button className="btn ghost">피드백 저장</button>
          </div>
        </div>
        <div className="card">
          <h2>응답 · 모니터링</h2>
          <div className="response-box">
            <p>[답변 예시] 정책 A는 … / 정책 B는 …</p>
          </div>
          <p className="note">에이전트: Claude 3.5 Sonnet · 토큰 1.2k · latency 3.4s</p>
        </div>
      </div>
    </div>
  )
}

export default Playground
