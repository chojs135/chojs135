import { useCallback, useEffect, useState } from 'react'
import { api, TYPE_LABEL, won, type Recurring, type RecurringInfo, type TxType } from '../api'
import type { Ctx } from '../App'
import { CategorySelect, MemberSelect } from './TxForm'

const EMPTY: Recurring = { name: '', type: 'expense', amount: 0, day: 1, category_id: null, subcategory: '', payment_method: '', member_id: null, auto: true }

function Form({ ctx, initial, onDone, onCancel }: { ctx: Ctx; initial: Recurring; onDone: () => void; onCancel: () => void }) {
  const [r, setR] = useState<Recurring>(initial)
  const [error, setError] = useState('')
  const set = <K extends keyof Recurring>(k: K, v: Recurring[K]) => setR((p) => ({ ...p, [k]: v }))
  return (
    <form
      className="form recurring-form"
      onSubmit={async (e) => {
        e.preventDefault()
        try {
          if (r.id) await api(`/recurring/${r.id}`, { method: 'PUT', body: r })
          else await api('/recurring', { body: r })
          onDone()
        } catch (err) {
          setError((err as Error).message)
        }
      }}
    >
      <div className="segmented">
        {(['expense', 'saving', 'income'] as TxType[]).map((k) => (
          <button type="button" key={k} className={r.type === k ? 'active' : ''} onClick={() => setR({ ...r, type: k, category_id: null, subcategory: '' })}>
            {TYPE_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="row-2">
        <label>
          내용 <input value={r.name} onChange={(e) => set('name', e.target.value)} placeholder="예: 넷플릭스, 월세, 청년적금" required />
        </label>
        <label>
          매달 결제일
          <select value={r.day} onChange={(e) => set('day', Number(e.target.value))}>
            {Array.from({ length: 31 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1 === 31 ? '말일(31일)' : `${i + 1}일`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row-2">
        <label>
          금액 <input inputMode="numeric" value={r.amount ? r.amount.toLocaleString('ko-KR') : ''} onChange={(e) => set('amount', Number(e.target.value.replace(/[^0-9]/g, '')))} placeholder="0" />
        </label>
        <label>
          분류
          <CategorySelect categories={ctx.categories} type={r.type} categoryId={r.category_id} subcategory={r.subcategory} onChange={(id, sub) => setR({ ...r, category_id: id, subcategory: sub })} />
        </label>
      </div>
      <div className="row-2">
        <label>
          결제수단 <input value={r.payment_method} onChange={(e) => set('payment_method', e.target.value)} placeholder="예: 삼성카드, 농협 자동이체" />
        </label>
        <label>
          사용자 <MemberSelect members={ctx.me.members} value={r.member_id} onChange={(v) => set('member_id', v)} />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={r.auto} onChange={(e) => set('auto', e.target.checked)} />
        금액이 매달 같아요 → 결제일에 자동으로 기록 (관리비·가스비처럼 달라지면 끄세요. 고지서를 올리면 '나감'으로 표시돼요)
      </label>
      {error && <div className="error">{error}</div>}
      <div className="actions">
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onCancel}>
          취소
        </button>
        <button className="primary">{r.id ? '저장' : '등록'}</button>
      </div>
    </form>
  )
}

/** 설정용: 정기결제(결제일 관리) 목록·등록·추천 */
export default function RecurringManager({ ctx }: { ctx: Ctx }) {
  const [info, setInfo] = useState<RecurringInfo | null>(null)
  const [editing, setEditing] = useState<Recurring | null>(null)
  const load = useCallback(() => {
    api<RecurringInfo>('/recurring').then(setInfo)
  }, [])
  useEffect(load, [load])
  if (!info) return null
  const done = () => {
    setEditing(null)
    load()
  }
  const catName = (id: number | null) => ctx.categories.find((c) => c.id === id)?.name ?? '미분류'

  return (
    <section className="card" id="recurring">
      <h3>📅 정기결제 (결제일 관리)</h3>
      <p className="small muted">매달 나가는 돈을 등록해 두면 결제일이 지나면 자동으로 그 달 내역에 들어가요. 구글 시트의 "결제일 관리" 탭과 같은 목록이에요.</p>
      {info.status.items.length > 0 && (
        <ul className="recurring-list">
          {info.status.items.map((i) => (
            <li key={i.id}>
              <span className="r-day">{i.day === 31 ? '말일' : `${i.day}일`}</span>
              <span className="r-name">
                {i.name}{' '}
                <span className="muted small">
                  {TYPE_LABEL[i.type]} · {catName(i.category_id)}
                  {i.subcategory && ` › ${i.subcategory}`}
                  {i.payment_method && ` · ${i.payment_method}`} · {i.auto ? '자동 기록' : '금액 변동(기록 안 함)'}
                </span>
              </span>
              <span className="num">{won(i.amount)}</span>
              <span>
                <button className="icon-btn" aria-label="수정" onClick={() => setEditing(i)}>
                  ✏️
                </button>
                <button
                  className="icon-btn"
                  aria-label="삭제"
                  onClick={async () => {
                    if (!confirm(`'${i.name}' 정기결제를 지울까요? 이미 기록된 내역은 남아요.`)) return
                    await api(`/recurring/${i.id}`, { method: 'DELETE' })
                    load()
                  }}
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <Form ctx={ctx} initial={editing} onDone={done} onCancel={() => setEditing(null)} />
      ) : (
        <div className="actions">
          <button className="primary" onClick={() => setEditing({ ...EMPTY })}>
            ＋ 정기결제 추가
          </button>
        </div>
      )}
      {info.suggestions.length > 0 && !editing && (
        <>
          <h3 style={{ marginTop: 20 }}>💡 지난 내역에서 찾은 정기결제</h3>
          <ul className="recurring-list">
            {info.suggestions.map((sug) => (
              <li key={sug.name}>
                <span className="r-day">{sug.day}일</span>
                <span className="r-name">
                  {sug.name} <span className="muted small">{sug.months}개월 반복 · {sug.auto ? '금액 같음' : '금액 변동'}</span>
                </span>
                <span className="num">{won(sug.amount)}</span>
                <button className="chip" onClick={() => setEditing({ ...sug })}>
                  등록
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
