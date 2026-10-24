import { useCallback, useEffect, useState } from 'react'
import { api, won, type LedgerData, type LedgerField, type LedgerRow } from '../api'
import type { Ctx } from '../App'

type Values = Record<string, string | number | null>

function fmt(f: LedgerField, v: unknown) {
  if (v === null || v === undefined || v === '') return ''
  if (f.type === 'money') return won(Number(v))
  if (f.type === 'day') return `매월 ${v}일`
  if (f.type === 'number' && f.key.includes('%')) return `${v}%`
  return String(v)
}

function Field({ f, value, onChange, ctx }: { f: LedgerField; value: string | number | null; onChange: (v: string | number | null) => void; ctx: Ctx }) {
  const v = value ?? ''
  if (f.type === 'select' || f.type === 'member') {
    const options = f.type === 'member' ? [...ctx.me.members.map((m) => m.name), '공동'] : (f.options ?? [])
    return (
      <select value={String(v)} onChange={(e) => onChange(e.target.value)}>
        <option value="">{f.required ? '선택' : '-'}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  }
  if (f.type === 'day') {
    return (
      <select value={String(v)} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">-</option>
        {Array.from({ length: 31 }, (_, i) => (
          <option key={i + 1} value={i + 1}>
            매월 {i + 1}일
          </option>
        ))}
      </select>
    )
  }
  if (f.type === 'date') return <input type="date" value={String(v)} onChange={(e) => onChange(e.target.value)} />
  if (f.type === 'money') {
    return (
      <input
        inputMode="numeric"
        value={v === '' ? '' : Number(v).toLocaleString('ko-KR')}
        placeholder={f.placeholder ?? '0'}
        onChange={(e) => {
          const n = e.target.value.replace(/[^0-9]/g, '')
          onChange(n ? Number(n) : null)
        }}
      />
    )
  }
  if (f.type === 'number') return <input inputMode="decimal" value={String(v)} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />
  return <input value={String(v)} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />
}

/** 관리 탭 하나(자산·예비비·대출·카드·통장·이벤트): 요약 + 목록 + 입력 폼. 열 정의는 서버(gas/Ledgers.js)에서 온다. */
export default function LedgerView({ type, ctx }: { type: string; ctx: Ctx }) {
  const [data, setData] = useState<LedgerData | null>(null)
  const [editing, setEditing] = useState<Values | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    api<LedgerData>(`/ledgers/${type}`).then(setData)
  }, [type])
  // 탭이 바뀌면 부모가 key로 새로 그리므로 여기서는 불러오기만 한다.
  useEffect(load, [load])
  if (!data) return <div className="muted">불러오는 중…</div>

  const primary = data.fields.find((f) => f.primary) ?? data.fields[0]

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!editing) return
    setError('')
    try {
      if (editing.id) await api(`/ledgers/${type}/${editing.id}`, { method: 'PUT', body: editing })
      else await api(`/ledgers/${type}`, { body: editing })
      setEditing(null)
      load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div>
      {data.summary.length > 0 && (
        <section className="kpis ledger-kpis">
          {data.summary.map((s) => (
            <div key={s.label} className="card kpi">
              <div className="kpi-label">{s.label}</div>
              <div className={`kpi-value ${s.strong ? '' : 'small-kpi'} ${s.value < 0 ? 'bad' : ''}`}>{s.unit ? `${s.value}${s.unit}` : won(s.value)}</div>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <h3>
          {data.icon} {data.name}
        </h3>
        <p className="small muted">{data.hint}</p>

        {data.rows.length === 0 && !editing && <p className="muted small">아직 없어요.</p>}
        <ul className="ledger-list">
          {data.rows.map((r: LedgerRow) => (
            <li key={r.id} onClick={() => setEditing({ ...(r as unknown as Values) })}>
              <div className="ledger-title">
                <b>{String(r[primary.key] ?? '') || '(이름 없음)'}</b>
                {/* 오른쪽 금액: 자동 계산 값(이번 달 사용, 남은 원금, 잔액)이 있으면 그것, 없으면 첫 금액 */}
                {(() => {
                  const calc = r._calc && Object.values(r._calc).find((x) => typeof x === 'number')
                  if (typeof calc === 'number') return <span className="num">{won(calc)}</span>
                  const f = data.fields.find((x) => x.type === 'money' && r[x.key])
                  return f ? <span className="num">{fmt(f, r[f.key])}</span> : null
                })()}
              </div>
              <div className="small muted">
                {data.fields
                  .filter((f) => f !== primary && r[f.key] !== '' && r[f.key] !== null && r[f.key] !== undefined)
                  .map((f) => `${f.key} ${fmt(f, r[f.key])}`)
                  .join(' · ')}
              </div>
              {r._calc && (
                <div className="badges">
                  {Object.entries(r._calc).map(([k, val]) => (
                    <span key={k} className={`badge ${String(val).includes('남음') || k === '알림' ? 'warn' : ''}`}>
                      {k} {typeof val === 'number' ? won(val) : val}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>

        {editing ? (
          <form className="form ledger-form" onSubmit={save}>
            {data.fields.map((f) => (
              <label key={f.key}>
                {f.key}
                {f.required && ' *'}
                <Field f={f} ctx={ctx} value={(editing[f.key] as string | number | null) ?? ''} onChange={(v) => setEditing({ ...editing, [f.key]: v })} />
              </label>
            ))}
            {error && <div className="error">{error}</div>}
            <div className="actions">
              {editing.id && (
                <button
                  type="button"
                  className="danger"
                  onClick={async () => {
                    if (!confirm('지울까요?')) return
                    await api(`/ledgers/${type}/${editing.id}`, { method: 'DELETE' })
                    setEditing(null)
                    load()
                  }}
                >
                  삭제
                </button>
              )}
              <span style={{ flex: 1 }} />
              <button type="button" onClick={() => setEditing(null)}>
                취소
              </button>
              <button className="primary">{editing.id ? '저장' : '추가'}</button>
            </div>
          </form>
        ) : (
          <div className="actions">
            <button className="primary" onClick={() => setEditing({})}>
              ＋ 추가
            </button>
            <span style={{ flex: 1 }} />
            <a className="small muted" href={ctx.me.sheetUrl} target="_blank" rel="noreferrer">
              시트의 '{data.name}' 탭에서도 고칠 수 있어요
            </a>
          </div>
        )}
      </section>
    </div>
  )
}
