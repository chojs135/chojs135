import { useState } from 'react'
import { api, type MeResponse } from '../api'

export default function Setup({ me, onDone }: { me: MeResponse; onDone: () => void }) {
  const [form, setForm] = useState({ name: '', householdName: '', apiKey: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  if (me.state === 'not_member') {
    return (
      <div className="login">
        <h1>💰 우리집 가계부</h1>
        <div className="card">
          <p>
            <b>{me.email}</b> 계정은 아직 이 가계부의 구성원이 아니에요.
          </p>
          <p className="small muted">
            가계부를 만든 사람이 <b>설정 → 구성원</b>에서 이 이메일을 추가하면 들어올 수 있어요. 다른 구글 계정으로 접속했다면 브라우저에서 계정을 바꿔 주세요.
          </p>
        </div>
      </div>
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api('/setup', { body: form })
      onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <h1>💰 우리집 가계부</h1>
      <p className="muted">처음 한 번만 설정하면 돼요. 데이터는 이 구글 시트에 저장됩니다.</p>
      <form onSubmit={submit} className="card form">
        <label>
          내 이름 <input value={form.name} onChange={set('name')} placeholder="예: 민호" required />
        </label>
        <label>
          가계부 이름 <input value={form.householdName} onChange={set('householdName')} placeholder="예: 지수♥민호 가계부" />
        </label>
        <label>
          Anthropic API 키
          <input type="password" value={form.apiKey} onChange={set('apiKey')} placeholder="sk-ant-..." autoComplete="off" />
          <span className="small muted">문서·사진 자동 분석에 쓰여요. 나중에 설정 화면에서 넣어도 됩니다.</span>
        </label>
        <p className="small muted">로그인 계정: {me.email}</p>
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>
          {busy ? '준비하는 중…' : '시작하기'}
        </button>
      </form>
    </div>
  )
}
