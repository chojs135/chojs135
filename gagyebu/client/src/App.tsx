import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, shiftMonth, thisMonth, type Category, type Me } from './api'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Transactions from './pages/Transactions'
import Upload from './pages/Upload'
import Settings from './pages/Settings'

type Tab = 'dashboard' | 'transactions' | 'upload' | 'settings'
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'dashboard', label: '대시보드', icon: '📊' },
  { id: 'transactions', label: '내역', icon: '📋' },
  { id: 'upload', label: '올리기', icon: '📤' },
  { id: 'settings', label: '설정', icon: '⚙️' },
]

export type Ctx = { me: Me; categories: Category[]; reloadCategories: () => void; month: string }

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined)
  const [categories, setCategories] = useState<Category[]>([])
  const [tab, setTab] = useState<Tab>('dashboard')
  const [month, setMonth] = useState(thisMonth())

  const loadMe = useCallback(() => {
    api<Me>('/me')
      .then(setMe)
      .catch((e) => (e instanceof ApiError && e.status === 401 ? setMe(null) : setMe(null)))
  }, [])
  const reloadCategories = useCallback(() => {
    api<Category[]>('/categories').then(setCategories)
  }, [])

  useEffect(loadMe, [loadMe])
  useEffect(() => {
    if (me) reloadCategories()
  }, [me, reloadCategories])

  if (me === undefined) return <div className="center muted">불러오는 중…</div>
  if (me === null) return <Login onDone={loadMe} />

  const ctx: Ctx = { me, categories, reloadCategories, month }
  const [y, m] = month.split('-')

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">💰 {me.household.name}</div>
        {(tab === 'dashboard' || tab === 'transactions') && (
          <div className="month-picker">
            <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="이전 달">‹</button>
            <span>
              {y}년 {Number(m)}월
            </span>
            <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="다음 달">›</button>
          </div>
        )}
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            <span className="tab-icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <main className="content">
        {tab === 'dashboard' && <Dashboard ctx={ctx} goUpload={() => setTab('upload')} />}
        {tab === 'transactions' && <Transactions ctx={ctx} />}
        {tab === 'upload' && <Upload ctx={ctx} onSaved={() => setTab('transactions')} />}
        {tab === 'settings' && (
          <Settings
            ctx={ctx}
            onLogout={async () => {
              await api('/auth/logout', { method: 'POST' })
              setMe(null)
            }}
          />
        )}
      </main>
    </div>
  )
}
