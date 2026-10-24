import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, today, won, TYPE_LABEL, type Tx } from '../api'
import type { Ctx } from '../App'
import TxForm from '../components/TxForm'

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

export default function Transactions({ ctx }: { ctx: Ctx }) {
  const [rows, setRows] = useState<Tx[]>([])
  const [filter, setFilter] = useState({ type: '', category_id: '', member_id: '', q: '' })
  const [editing, setEditing] = useState<Tx | null>(null)

  const load = useCallback(() => {
    const p = new URLSearchParams({ month: ctx.month, ...filter })
    for (const [k, v] of [...p]) if (!v) p.delete(k)
    api<Tx[]>(`/transactions?${p}`).then(setRows)
  }, [ctx.month, filter])
  useEffect(load, [load])

  const catById = useMemo(() => new Map(ctx.categories.map((c) => [c.id, c])), [ctx.categories])
  const memberName = (id: number | null) => ctx.me.members.find((m) => m.id === id)?.name ?? '공동'

  const groups = useMemo(() => {
    const g = new Map<string, Tx[]>()
    for (const r of rows) g.set(r.date, [...(g.get(r.date) ?? []), r])
    return [...g]
  }, [rows])

  const sum = (type: string) => rows.filter((r) => r.type === type).reduce((a, r) => a + r.amount, 0)

  async function save(t: Tx) {
    if (t.id) await api(`/transactions/${t.id}`, { method: 'PUT', body: t })
    else await api('/transactions', { body: t })
    setEditing(null)
    load()
  }

  return (
    <div>
      <div className="toolbar">
        <input className="search" placeholder="🔍 가맹점·내용 검색" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        <select value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })}>
          <option value="">전체</option>
          <option value="expense">지출</option>
          <option value="income">수입</option>
          <option value="transfer">이체</option>
        </select>
        <select value={filter.category_id} onChange={(e) => setFilter({ ...filter, category_id: e.target.value })}>
          <option value="">모든 카테고리</option>
          {ctx.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.name}
            </option>
          ))}
        </select>
        <select value={filter.member_id} onChange={(e) => setFilter({ ...filter, member_id: e.target.value })}>
          <option value="">모든 사람</option>
          <option value="shared">공동</option>
          {ctx.me.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <button
          className="primary"
          onClick={() =>
            setEditing({ date: today(), type: 'expense', amount: 0, category_id: null, subcategory: '', merchant: '', description: '', payment_method: '', member_id: ctx.me.user.id, memo: '' })
          }
        >
          ＋ 직접 입력
        </button>
      </div>

      <div className="summary-line">
        <span>수입 <b className="income">{won(sum('income'))}</b></span>
        <span>지출 <b className="expense">{won(sum('expense'))}</b></span>
        <span className="muted">{rows.length}건</span>
        <a className="muted small" href="/api/transactions/export.csv">CSV 내려받기</a>
      </div>

      {groups.length === 0 && <div className="card muted">이 기간에 내역이 없어요.</div>}

      {groups.map(([date, items]) => {
        const d = new Date(date + 'T00:00:00')
        return (
          <section key={date} className="day">
            <div className="day-head">
              {d.getMonth() + 1}월 {d.getDate()}일 ({WEEKDAY[d.getDay()]})
            </div>
            <ul className="tx-list card">
              {items.map((t) => {
                const c = t.category_id ? catById.get(t.category_id) : undefined
                return (
                  <li key={t.id} onClick={() => setEditing(t)}>
                    <span className="tx-icon">{c?.icon ?? '❔'}</span>
                    <div className="tx-main">
                      <div>{t.merchant || t.description || c?.name || '내역'}</div>
                      <div className="muted small">
                        {c ? `${c.name}${t.subcategory ? ` › ${t.subcategory}` : ''}` : '미분류'}
                        {t.payment_method && ` · ${t.payment_method}`} · {memberName(t.member_id)}
                        {t.source === 'upload' && ' · 🤖'}
                      </div>
                    </div>
                    <div className={`tx-amount ${t.type}`}>
                      {t.type === 'expense' ? '-' : t.type === 'income' ? '+' : ''}
                      {won(t.amount)}
                      {t.type === 'transfer' && <div className="muted small">{TYPE_LABEL.transfer}</div>}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}

      {editing && (
        <TxForm
          initial={editing}
          categories={ctx.categories}
          members={ctx.me.members}
          onClose={() => setEditing(null)}
          onSave={save}
          onDelete={
            editing.id
              ? async () => {
                  await api(`/transactions/${editing.id}`, { method: 'DELETE' })
                  setEditing(null)
                  load()
                }
              : undefined
          }
        />
      )}
    </div>
  )
}
