import { useCallback, useEffect, useState } from 'react'
import { api, shiftMonth, thisMonth, type Category, type Me, type MeResponse } from './api'
import Setup from './pages/Setup'
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

export type Ctx = { me: Me; reloadMe: () => void; categories: Category[]; reloadCategories: () => void; month: string }

export default function App() {
  const [me, setMe] = useState<MeResponse | undefined>(undefined)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [tab, setTab] = useState<Tab>('dashboard')
  const [month, setMonth] = useState(thisMonth())

  const loadMe = useCallback(() => {
    api<MeResponse>('/me')
      .then(setMe)
      .catch((e) => setError((e as Error).message))
  }, [])
  const reloadCategories = useCallback(() => {
    api<Category[]>('/categories').then(setCategories)
  }, [])

  useEffect(loadMe, [loadMe])
  useEffect(() => {
    if (me?.state === 'ok') reloadCategories()
  }, [me, reloadCategories])

  if (error) return <div className="center error">{error}</div>
  if (me === undefined) return <div className="center muted">불러오는 중…</div>
  if (me.state !== 'ok') return <Setup me={me} onDone={loadMe} />

  const ctx: Ctx = { me, reloadMe: loadMe, categories, reloadCategories, month }
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
          <button
            key={t.id}
            className={tab === t.id ? 'active' : ''}
            onClick={() => {
              setTab(t.id)
              setFlash('')
            }}
          >
            <span className="tab-icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <main className="content">
        {flash && (
          <div className="card flash" onClick={() => setFlash('')}>
            ✅ {flash}
          </div>
        )}
        {tab === 'dashboard' && <Dashboard ctx={ctx} goUpload={() => setTab('upload')} />}
        {tab === 'transactions' && <Transactions ctx={ctx} />}
        {tab === 'upload' && (
          <Upload
            ctx={ctx}
            onSaved={(months, count, filled) => {
              // 저장한 내역이 가장 많은 달로 이동해서 바로 보이게 한다.
              const counts = new Map<string, number>()
              months.forEach((m) => counts.set(m, (counts.get(m) ?? 0) + 1))
              const top = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
              if (top) setMonth(top)
              const label = [...counts.keys()].sort().map((m) => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`).join(', ')
              setFlash(
                `${count}건을 저장했어요${label ? ` (${label})` : ''}.${filled ? ` 기존 내역 ${filled}건에 결제수단을 채웠어요.` : ''} 구글 시트 '거래내역' 탭에도 바로 들어가 있어요.`,
              )
              setTab('transactions')
            }}
          />
        )}
        {tab === 'settings' && <Settings ctx={ctx} />}
      </main>
    </div>
  )
}
