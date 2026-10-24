import { useState } from 'react'
import { api } from '../api'

export default function Login({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'new' | 'join'>('login')
  const [form, setForm] = useState({ name: '', email: '', password: '', householdName: '', inviteCode: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'login') await api('/auth/login', { body: { email: form.email, password: form.password } })
      else
        await api('/auth/register', {
          body: {
            name: form.name,
            email: form.email,
            password: form.password,
            ...(mode === 'new' ? { householdName: form.householdName } : { inviteCode: form.inviteCode }),
          },
        })
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
      <p className="muted">내역서·영수증·관리비 고지서를 올리면 AI가 알아서 정리해 드려요.</p>
      <div className="segmented">
        <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>로그인</button>
        <button className={mode === 'new' ? 'active' : ''} onClick={() => setMode('new')}>새 가계부 만들기</button>
        <button className={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')}>초대코드로 참여</button>
      </div>
      <form onSubmit={submit} className="card form">
        {mode !== 'login' && (
          <label>
            이름 <input value={form.name} onChange={set('name')} placeholder="예: 지수" required />
          </label>
        )}
        <label>
          이메일 <input type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
        </label>
        <label>
          비밀번호
          <input type="password" value={form.password} onChange={set('password')} required minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        </label>
        {mode === 'new' && (
          <label>
            가계부 이름 <input value={form.householdName} onChange={set('householdName')} placeholder="예: 지수♥민호 가계부" />
          </label>
        )}
        {mode === 'join' && (
          <label>
            초대코드 <input value={form.inviteCode} onChange={set('inviteCode')} placeholder="배우자의 설정 화면에 있는 8자리 코드" required />
          </label>
        )}
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>
          {busy ? '잠시만요…' : mode === 'login' ? '로그인' : '시작하기'}
        </button>
      </form>
    </div>
  )
}
