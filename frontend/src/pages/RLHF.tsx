import React from 'react'

const RLHF: React.FC = () => {
  return (
    <div className="page-wrap">
      <h1>강화학습 · RLHF</h1>
      <p className="subtitle">보상 모델 준비부터 PPO/DPO 실행까지 한 화면에서 제어합니다.</p>

      <div className="flex-card">
        <div className="card">
          <h2>보상 모델</h2>
          <p>선택: mini-reward-ko · 500k pair</p>
          <div className="status-item">
            <div>
              <strong>RM Fine-tune</strong>
              <span>GPU 0 / 40분</span>
            </div>
            <div className="progress">
              <div style={{ width: '55%' }} />
            </div>
          </div>
          <p className="note">데이터 부족 시 LLM이 선호 pair(agree/disagree)를 자동 생성합니다.</p>
        </div>
        <div className="card">
          <h2>Preference Queue</h2>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>상태</th>
                <th>LLM</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>#812</td>
                <td>가공 완료</td>
                <td>Claude 3.5</td>
              </tr>
              <tr>
                <td>#813</td>
                <td>생성 중</td>
                <td>GPT-4o mini</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default RLHF
