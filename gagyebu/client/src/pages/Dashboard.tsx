import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, shortWon, won, type Stats } from '../api'
import type { Ctx } from '../App'

function Delta({ cur, prev, goodWhenDown }: { cur: number; prev: number; goodWhenDown?: boolean }) {
  if (!prev) return <span className="muted small">지난달 기록 없음</span>
  const diff = cur - prev
  const pct = Math.round((diff / prev) * 100)
  const good = goodWhenDown ? diff <= 0 : diff >= 0
  return (
    <span className={`small ${good ? 'good' : 'bad'}`}>
      {diff >= 0 ? '▲' : '▼'} 지난달보다 {shortWon(Math.abs(diff))}원 ({pct > 0 ? '+' : ''}
      {pct}%)
    </span>
  )
}

const tooltipStyle = { borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }

export default function Dashboard({ ctx, goUpload }: { ctx: Ctx; goUpload: () => void }) {
  const [s, setS] = useState<Stats | null>(null)
  // '' = 우리 전체, 'shared' = 공동, 그 외 = 구성원 id
  const [who, setWho] = useState('')
  useEffect(() => {
    api<Stats>(`/stats?month=${ctx.month}${who ? `&member_id=${who}` : ''}`).then(setS)
  }, [ctx.month, who])

  if (!s) return <div className="muted">불러오는 중…</div>

  const maxCat = Math.max(1, ...s.byCategory.map((c) => Math.max(c.amount, c.budget ?? 0)))
  const trend = s.trend.map((t) => ({ ...t, label: `${Number(t.month.slice(5))}월` }))
  const daily = s.daily.map((d) => ({ ...d, label: Number(d.date.slice(8)) }))

  return (
    <div className="dashboard">
      <div className="segmented">
        <button className={who === '' ? 'active' : ''} onClick={() => setWho('')}>
          👫 전체
        </button>
        {ctx.me.members.map((m) => (
          <button key={m.id} className={who === String(m.id) ? 'active' : ''} onClick={() => setWho(String(m.id))}>
            {m.id === ctx.me.user.id ? `🙋 ${m.name}` : m.name}
          </button>
        ))}
        <button className={who === 'shared' ? 'active' : ''} onClick={() => setWho('shared')}>
          🏠 공동
        </button>
      </div>
      {s.count === 0 && (
        <div className="card empty">
          <p>이번 달 기록이 아직 없어요.</p>
          <button className="primary" onClick={goUpload}>
            📤 내역서·영수증 올리기
          </button>
        </div>
      )}

      <section className="kpis">
        <div className="card kpi">
          <div className="kpi-label">수입</div>
          <div className="kpi-value">{won(s.income)}</div>
          <Delta cur={s.income} prev={s.prev.income} />
        </div>
        <div className="card kpi">
          <div className="kpi-label">지출</div>
          <div className="kpi-value">{won(s.expense)}</div>
          <Delta cur={s.expense} prev={s.prev.expense} goodWhenDown />
        </div>
        <div className="card kpi">
          <div className="kpi-label">남은 돈</div>
          <div className={`kpi-value ${s.net < 0 ? 'bad' : ''}`}>{won(s.net)}</div>
          <span className="muted small">{s.savingsRate != null ? `저축률 ${s.savingsRate}%` : '수입 기록 없음'}</span>
        </div>
      </section>

      {s.insights.length > 0 && (
        <section className="card insights">
          <h3>💡 이번 달 체크포인트</h3>
          <ul>
            {s.insights.map((t) => (
              <li key={t}>⚠️ {t}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid-2">
        <div className="card">
          <h3>카테고리별 지출</h3>
          {s.byCategory.length === 0 && <p className="muted">지출 기록이 없어요.</p>}
          <ul className="cat-bars">
            {s.byCategory.map((c) => {
              const over = c.budget != null && c.amount > c.budget
              const share = s.expense ? Math.round((c.amount / s.expense) * 100) : 0
              return (
                <li key={c.id ?? 'none'} title={`${c.name}: ${won(c.amount)} · ${c.count}건 · 지난달 ${won(c.prevAmount)}`}>
                  <div className="cat-row">
                    <span>
                      {c.icon} {c.name} <span className="muted small">{share}%</span>
                    </span>
                    <span className="num">{won(c.amount)}</span>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(c.amount / maxCat) * 100}%` }} />
                    {c.budget != null && <div className="bar-budget" style={{ left: `${(c.budget / maxCat) * 100}%` }} />}
                  </div>
                  {c.budget != null && (
                    <div className={`small ${over ? 'bad' : 'muted'}`}>
                      {over ? `⚠️ 예산 ${won(c.budget)} 초과` : `예산 ${won(c.budget)} 중 ${Math.round((c.amount / c.budget) * 100)}% 사용`}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>

        <div className="card">
          <h3>월별 수입·지출 (최근 12개월)</h3>
          <div className="chart">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={trend} barGap={2} margin={{ left: 0, right: 4 }}>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={shortWon} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={52} />
                <Tooltip formatter={(v) => won(Number(v))} contentStyle={tooltipStyle} cursor={{ fill: 'var(--hover)' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="income" name="수입" fill="var(--series-1)" radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={14} />
                <Bar dataKey="expense" name="지출" fill="var(--series-2)" radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="grid-2">
        <div className="card">
          <h3>일별 지출</h3>
          <div className="chart">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={daily} margin={{ left: 0, right: 4 }}>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} unit="일" />
                <YAxis tickFormatter={shortWon} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={52} />
                <Tooltip formatter={(v) => [won(Number(v)), '지출']} labelFormatter={(l) => `${l}일`} contentStyle={tooltipStyle} cursor={{ fill: 'var(--hover)' }} />
                <Bar dataKey="amount" fill="var(--series-2)" radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h3>많이 쓴 곳 TOP 7</h3>
          <table className="simple">
            <tbody>
              {s.topMerchants.map((m, i) => (
                <tr key={m.merchant}>
                  <td className="muted">{i + 1}</td>
                  <td>{m.merchant}</td>
                  <td className="muted small">{m.count}회</td>
                  <td className="num">{won(m.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 style={{ marginTop: 20 }}>누가 썼나 (우리 전체)</h3>
          <table className="simple">
            <thead>
              <tr>
                <th></th>
                <th className="num">수입</th>
                <th className="num">지출</th>
              </tr>
            </thead>
            <tbody>
              {s.byMember.map((m) => (
                <tr key={m.name}>
                  <td>{m.name}</td>
                  <td className="num">{won(m.income)}</td>
                  <td className="num">{won(m.expense)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {s.bySubcategory.length > 0 && (
        <section className="card">
          <h3>세부항목별 지출</h3>
          <table className="simple">
            <tbody>
              {s.bySubcategory.map((r) => (
                <tr key={`${r.category}/${r.subcategory}`}>
                  <td>{r.category}</td>
                  <td className="muted">{r.subcategory || '-'}</td>
                  <td className="num">{won(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
