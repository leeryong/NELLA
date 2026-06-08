import React from 'react'

const datasets = [
  { name: 'policy-faq-v3', qa: 1240, testRatio: '9:1', model: 'Claude 3.5' },
  { name: 'tiny-docs-ko', qa: 480, testRatio: '8:2', model: 'GPT-4o mini' },
]

const DatasetBuilder: React.FC = () => {
  return (
    <div className="page-wrap">
      <h1>QA 데이터 생성</h1>
      <p className="subtitle">LLM이 chunk 기반으로 질문을 만들고, 검토 후 바로 SFT/평가 파이프라인에 연결됩니다.</p>

      <div className="flex-card">
        <div className="card">
          <h2>질문 템플릿</h2>
          <p>Factoid / Reasoning / Multi-hop / Critique 중 원하는 템플릿을 조합할 수 있습니다.</p>
          <div className="pill-row">
            <span className="pill pill-on">Factoid</span>
            <span className="pill">Reasoning</span>
            <span className="pill">Multi-hop</span>
            <span className="pill">Critique</span>
          </div>
          <p className="note">LLM 공급자: OpenAI · Claude · Ollama · Custom API</p>
        </div>
        <div className="card">
          <h2>데이터셋 현황</h2>
          <table>
            <thead>
              <tr>
                <th>Dataset</th>
                <th>Q/A 수</th>
                <th>Test 비율</th>
                <th>LLM</th>
              </tr>
            </thead>
            <tbody>
              {datasets.map((ds) => (
                <tr key={ds.name}>
                  <td>{ds.name}</td>
                  <td>{ds.qa.toLocaleString()}</td>
                  <td>{ds.testRatio}</td>
                  <td>{ds.model}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default DatasetBuilder
