import { useEffect, useState } from 'react'
import { api, TYPE_LABEL, type Category, type TxType } from '../api'
import type { Ctx } from '../App'

type Rule = { id: number; keyword: string; type: TxType; category: string; subcategory: string }
type SheetStatus = { configured: boolean; serviceAccountEmail: string | null; sheetId: string | null; lastSync: { at: string; ok: boolean; message: string } | null }

function Budgets({ ctx }: { ctx: Ctx }) {
  const [values, setValues] = useState<Record<number, string>>({})
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    api<{ category_id: number; amount: number }[]>('/budgets').then((b) =>
      setValues(Object.fromEntries(b.map((x) => [x.category_id, x.amount.toLocaleString('ko-KR')]))),
    )
  }, [])
  const expense = ctx.categories.filter((c) => c.type === 'expense')
  async function save() {
    await api('/budgets', {
      method: 'PUT',
      body: { items: expense.map((c) => ({ category_id: c.id, amount: Number((values[c.id] ?? '').replace(/[^0-9]/g, '')) })) },
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }
  const total = expense.reduce((a, c) => a + Number((values[c.id] ?? '').replace(/[^0-9]/g, '')), 0)
  return (
    <section className="card">
      <h3>월 예산</h3>
      <p className="small muted">비워 두면 예산 없음. 대시보드에서 사용률과 초과 여부를 보여 드려요.</p>
      <div className="budget-grid">
        {expense.map((c) => (
          <label key={c.id} className="inline">
            <span>
              {c.icon} {c.name}
            </span>
            <input
              inputMode="numeric"
              placeholder="0"
              value={values[c.id] ?? ''}
              onChange={(e) => {
                const n = e.target.value.replace(/[^0-9]/g, '')
                setValues({ ...values, [c.id]: n ? Number(n).toLocaleString('ko-KR') : '' })
              }}
            />
          </label>
        ))}
      </div>
      <div className="actions">
        <span className="small muted">합계 {total.toLocaleString('ko-KR')}원</span>
        <span style={{ flex: 1 }} />
        <button className="primary" onClick={save}>
          {saved ? '저장됨 ✓' : '예산 저장'}
        </button>
      </div>
    </section>
  )
}

function Categories({ ctx }: { ctx: Ctx }) {
  const [type, setType] = useState<TxType>('expense')
  const [newName, setNewName] = useState('')
  const list = ctx.categories.filter((c) => c.type === type)

  async function updateSubs(c: Category, text: string) {
    const subs = text.split(',').map((s) => s.trim()).filter(Boolean)
    await api(`/categories/${c.id}`, { method: 'PUT', body: { subcategories: subs } })
    ctx.reloadCategories()
  }
  return (
    <section className="card">
      <h3>카테고리</h3>
      <div className="segmented">
        {(Object.keys(TYPE_LABEL) as TxType[]).map((k) => (
          <button key={k} className={type === k ? 'active' : ''} onClick={() => setType(k)}>
            {TYPE_LABEL[k]}
          </button>
        ))}
      </div>
      <ul className="cat-edit">
        {list.map((c) => (
          <li key={c.id}>
            <input
              className="cat-icon"
              defaultValue={c.icon}
              onBlur={(e) => e.target.value !== c.icon && api(`/categories/${c.id}`, { method: 'PUT', body: { icon: e.target.value } }).then(ctx.reloadCategories)}
            />
            <input
              defaultValue={c.name}
              onBlur={(e) => e.target.value && e.target.value !== c.name && api(`/categories/${c.id}`, { method: 'PUT', body: { name: e.target.value } }).then(ctx.reloadCategories)}
            />
            <input
              className="grow"
              defaultValue={c.subcategories.join(', ')}
              placeholder="세부항목 (쉼표로 구분)"
              onBlur={(e) => e.target.value !== c.subcategories.join(', ') && updateSubs(c, e.target.value)}
            />
            <button
              className="icon-btn"
              aria-label="삭제"
              onClick={async () => {
                if (!confirm(`'${c.name}' 카테고리를 삭제할까요? 기존 내역은 미분류가 됩니다.`)) return
                await api(`/categories/${c.id}`, { method: 'DELETE' })
                ctx.reloadCategories()
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form
        className="inline"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!newName.trim()) return
          await api('/categories', { body: { type, name: newName.trim(), icon: '🏷️' } })
          setNewName('')
          ctx.reloadCategories()
        }}
      >
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="새 카테고리 이름" />
        <button>추가</button>
      </form>
    </section>
  )
}

function Rules() {
  const [rules, setRules] = useState<Rule[]>([])
  const load = () => api<Rule[]>('/rules').then(setRules)
  useEffect(() => {
    load()
  }, [])
  return (
    <section className="card">
      <h3>자동 분류 규칙</h3>
      <p className="small muted">내역의 분류를 고치면 가맹점별로 자동 저장돼요. 다음 업로드부터 AI보다 우선 적용됩니다.</p>
      {rules.length === 0 && <p className="muted small">아직 규칙이 없어요.</p>}
      <table className="simple">
        <tbody>
          {rules.map((r) => (
            <tr key={r.id}>
              <td>"{r.keyword}"</td>
              <td>
                {TYPE_LABEL[r.type]} › {r.category}
                {r.subcategory && ` › ${r.subcategory}`}
              </td>
              <td>
                <button className="icon-btn" aria-label="삭제" onClick={() => api(`/rules/${r.id}`, { method: 'DELETE' }).then(load)}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function Sheets() {
  const [s, setS] = useState<SheetStatus | null>(null)
  const [input, setInput] = useState('')
  const [msg, setMsg] = useState('')
  useEffect(() => {
    api<SheetStatus>('/sheets').then((x) => {
      setS(x)
      setInput(x.sheetId ?? '')
    })
  }, [])
  if (!s) return null
  return (
    <section className="card">
      <h3>구글 스프레드시트 연동</h3>
      {!s.configured ? (
        <p className="small muted">서버에 GOOGLE_SERVICE_ACCOUNT_KEY가 설정되지 않았어요. README의 "구글 시트 연동" 절차를 따라 설정해 주세요.</p>
      ) : (
        <>
          <p className="small">
            1) 구글 시트를 만들고 <b>{s.serviceAccountEmail}</b> 을(를) 편집자로 공유하세요.
            <br />
            2) 시트 주소를 아래에 붙여 넣으면, 내역이 바뀔 때마다 "거래내역"·"월별요약" 탭이 자동으로 갱신돼요.
          </p>
          <form
            className="inline"
            onSubmit={async (e) => {
              e.preventDefault()
              setS(await api<SheetStatus>('/sheets', { method: 'PUT', body: { sheetId: input } }))
              setMsg('저장됨')
            }}
          >
            <input className="grow" value={input} onChange={(e) => setInput(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
            <button>저장</button>
          </form>
          <div className="actions">
            <span className="small muted">
              {s.lastSync ? `${s.lastSync.ok ? '✅' : '❌'} ${new Date(s.lastSync.at).toLocaleString('ko-KR')} ${s.lastSync.message}` : msg}
            </span>
            <span style={{ flex: 1 }} />
            <button
              disabled={!s.sheetId}
              onClick={async () => {
                setMsg('동기화 중…')
                try {
                  await api('/sheets/sync', { method: 'POST' })
                } catch (e) {
                  setMsg((e as Error).message)
                }
                setS(await api<SheetStatus>('/sheets'))
              }}
            >
              지금 동기화
            </button>
          </div>
        </>
      )}
    </section>
  )
}

export default function Settings({ ctx, onLogout }: { ctx: Ctx; onLogout: () => void }) {
  return (
    <div className="settings">
      <section className="card">
        <h3>우리 가계부</h3>
        <p>
          구성원: {ctx.me.members.map((m) => m.name).join(', ')}
        </p>
        <p>
          초대코드 <code className="invite">{ctx.me.household.invite_code}</code>
          <span className="small muted"> — 배우자가 가입할 때 "초대코드로 참여"에 입력하면 같은 가계부를 함께 써요.</span>
        </p>
        <div className="actions">
          <span className="small muted">{ctx.me.user.email}</span>
          <span style={{ flex: 1 }} />
          <button onClick={onLogout}>로그아웃</button>
        </div>
      </section>
      <Budgets ctx={ctx} />
      <Categories ctx={ctx} />
      <Rules />
      <Sheets />
    </div>
  )
}
