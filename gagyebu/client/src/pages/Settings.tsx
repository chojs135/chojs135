import { useEffect, useState } from 'react'
import { api, TYPE_LABEL, type Category, type TxType } from '../api'
import type { Ctx } from '../App'

type Rule = { keyword: string; type: TxType; category: string; subcategory: string }

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
            <tr key={r.keyword}>
              <td>"{r.keyword}"</td>
              <td>
                {TYPE_LABEL[r.type]} › {r.category}
                {r.subcategory && ` › ${r.subcategory}`}
              </td>
              <td>
                <button className="icon-btn" aria-label="삭제" onClick={() => api(`/rules/${encodeURIComponent(r.keyword)}`, { method: 'DELETE' }).then(load)}>
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

function Members({ ctx }: { ctx: Ctx }) {
  const [form, setForm] = useState({ name: '', email: '' })
  const [msg, setMsg] = useState('')
  async function add(e: React.FormEvent) {
    e.preventDefault()
    setMsg('')
    try {
      const r = await api<{ shared: boolean }>('/members', { body: form })
      setMsg(
        r.shared
          ? `${form.name}님을 추가하고 구글 시트도 공유했어요. 이 페이지 주소를 보내 주세요.`
          : `${form.name}님을 추가했어요. 구글 시트의 [공유] 버튼으로 ${form.email}을(를) 편집자로 추가해 주세요.`,
      )
      setForm({ name: '', email: '' })
      ctx.reloadMe()
    } catch (err) {
      setMsg((err as Error).message)
    }
  }
  return (
    <section className="card">
      <h3>구성원</h3>
      <table className="simple">
        <tbody>
          {ctx.me.members.map((m) => (
            <tr key={m.id}>
              <td>{m.name}</td>
              <td className="muted small">{m.email}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted" style={{ marginTop: 12 }}>
        배우자의 <b>구글 계정 이메일</b>을 추가하면 같은 가계부를 함께 써요. 각자 자기 구글 계정으로 들어오고, 올린 내역은 올린 사람 것으로 기록돼요.
      </p>
      <form className="inline" onSubmit={add}>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="이름" style={{ width: 90 }} required />
        <input className="grow" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="구글 계정 이메일" required />
        <button>추가</button>
      </form>
      {msg && <p className="small">{msg}</p>}
    </section>
  )
}

function ApiKey({ ctx }: { ctx: Ctx }) {
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState('')
  return (
    <section className="card">
      <h3>AI 분석 (Anthropic API 키)</h3>
      <p className="small">{ctx.me.hasApiKey ? '✅ 설정되어 있어요.' : '⚠️ 아직 없어요. 키가 있어야 문서·사진을 자동으로 분석할 수 있어요.'}</p>
      <form
        className="inline"
        onSubmit={async (e) => {
          e.preventDefault()
          await api('/settings', { method: 'PUT', body: { apiKey: key } })
          setKey('')
          setMsg('저장했어요.')
          ctx.reloadMe()
        }}
      >
        <input className="grow" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-... (바꿀 때만 입력)" autoComplete="off" required />
        <button>저장</button>
      </form>
      {msg && <p className="small">{msg}</p>}
    </section>
  )
}

export default function Settings({ ctx }: { ctx: Ctx }) {
  return (
    <div className="settings">
      <section className="card">
        <h3>{ctx.me.household.name}</h3>
        <p className="small">
          로그인: {ctx.me.user.name} ({ctx.me.user.email})
        </p>
        <p className="small muted">
          모든 데이터는 구글 시트에 저장돼요. 시트의 [파일 → 버전 기록]으로 예전 상태를 되돌릴 수도 있어요.
        </p>
        <a className="button-link" href={ctx.me.sheetUrl} target="_blank" rel="noreferrer">
          📗 구글 시트 열기
        </a>
      </section>
      <Members ctx={ctx} />
      <ApiKey ctx={ctx} />
      <Budgets ctx={ctx} />
      <Categories ctx={ctx} />
      <Rules />
    </div>
  )
}
