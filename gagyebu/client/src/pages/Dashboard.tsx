import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, shortWon, today, won, type Annual, type AnnualRow, type Category, type Stats } from '../api'
import type { Ctx } from '../App'
import Donut from '../components/Donut'
import { categorySlices, type Slice } from '../components/slices'

/** 수입이 어디로 갔나: 지출 / 저축 / 남은 돈 */
function incomeSlices(income: number, expense: number, saving: number): Slice[] {
  const net = income - expense - saving
  return [
    { key: 'expense', label: '지출', amount: expense, color: 'var(--series-2)' },
    { key: 'saving', label: '저축·투자', amount: saving, color: 'var(--series-3)' },
    ...(net > 0 ? [{ key: 'net', label: '남은 돈', amount: net, color: 'var(--series-1)' }] : []),
  ]
}

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
const axisTick = { fontSize: 11, fill: 'var(--muted)' }
const INSIGHT_ICON = { warn: '⚠️', info: '💬', good: '🎉' }

/** 수입·지출·저축 월별 막대(같은 축, 같은 단위) */
function TrendChart({ data, height = 260 }: { data: { label: string; income: number; expense: number; saving: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} barGap={2} margin={{ left: 0, right: 4 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={shortWon} tick={axisTick} tickLine={false} axisLine={false} width={52} />
        <Tooltip formatter={(v) => won(Number(v))} contentStyle={tooltipStyle} cursor={{ fill: 'var(--hover)' }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} itemSorter={null} />
        <Bar dataKey="income" name="수입" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={12} isAnimationActive={false} />
        <Bar dataKey="expense" name="지출" fill="var(--series-2)" radius={[4, 4, 0, 0]} maxBarSize={12} isAnimationActive={false} />
        <Bar dataKey="saving" name="저축" fill="var(--series-3)" radius={[4, 4, 0, 0]} maxBarSize={12} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function Calendar({ s }: { s: Stats }) {
  const first = new Date(s.month + '-01T00:00:00').getDay()
  const t = today()
  return (
    <div className="card">
      <h3>
        달력 <span className="muted small">🌱 무지출 데이 {s.noSpendDays}일</span>
      </h3>
      <div className="calendar">
        {['일', '월', '화', '수', '목', '금', '토'].map((d) => (
          <div key={d} className="dow">
            {d}
          </div>
        ))}
        {Array.from({ length: first }, (_, i) => (
          <div key={`b${i}`} className="cell blank" />
        ))}
        {s.calendar.map((c) => (
          <div
            key={c.date}
            className={`cell ${c.noSpend ? 'nospend' : ''} ${c.future ? 'future' : ''} ${c.date === t ? 'today' : ''}`}
            title={`${c.date} 지출 ${won(c.expense)}${c.income ? ` · 수입 ${won(c.income)}` : ''}${c.saving ? ` · 저축 ${won(c.saving)}` : ''}`}
          >
            <span className="d">{Number(c.date.slice(8))}</span>
            <span className="amt">{c.noSpend ? '🌱' : c.expense ? shortWon(c.expense) : ''}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Monthly({ s, goUpload, order }: { s: Stats; goUpload: () => void; order: number[] }) {
  const maxCat = Math.max(1, ...s.byCategory.map((c) => Math.max(c.amount, c.budget ?? 0)))
  const trend = s.trend.map((t) => ({ ...t, label: `${Number(t.month.slice(5))}월` }))
  const variable = s.expense - s.fixedExpense

  return (
    <>
      {s.count === 0 && (
        <div className="card empty">
          <p>이번 달 기록이 아직 없어요.</p>
          <button className="primary" onClick={goUpload}>
            📤 내역서·영수증 올리기
          </button>
        </div>
      )}

      <section className="kpis kpis-4">
        <div className="card kpi">
          <div className="kpi-label">수입</div>
          <div className="kpi-value">{won(s.income)}</div>
          <Delta cur={s.income} prev={s.prev.income} />
        </div>
        <div className="card kpi">
          <div className="kpi-label">지출</div>
          <div className="kpi-value">{won(s.expense)}</div>
          <div className="small muted">
            고정 {shortWon(s.fixedExpense)} · 변동 {shortWon(variable)}
          </div>
          <Delta cur={s.expense} prev={s.prev.expense} goodWhenDown />
        </div>
        <div className="card kpi">
          <div className="kpi-label">저축·투자</div>
          <div className="kpi-value">{won(s.saving)}</div>
          <span className="muted small">{s.savingsRate != null ? `저축률 ${s.savingsRate}%` : '수입 기록 없음'}</span>
        </div>
        <div className="card kpi">
          <div className="kpi-label">남은 돈</div>
          <div className={`kpi-value ${s.net < 0 ? 'bad' : ''}`}>{won(s.net)}</div>
          <span className="muted small">수입 − 지출 − 저축</span>
        </div>
      </section>

      <section className="grid-2">
        <Donut
          title="어디에 썼나"
          centerLabel="지출"
          centerValue={s.expense}
          empty="지출 기록이 없어요."
          slices={categorySlices(
            s.byCategory.map((c) => ({ ...c, note: c.budget ? `예산 ${Math.round((c.amount / c.budget) * 100)}%${c.amount > c.budget ? ' ⚠️' : ''}` : undefined })),
            order,
          )}
        />
        <Donut
          title={s.net < 0 ? `수입은 어디로 갔나 (⚠️ ${won(-s.net)} 초과)` : '수입은 어디로 갔나'}
          centerLabel="수입"
          centerValue={s.income}
          empty="이번 달 수입 기록이 없어요."
          slices={s.income ? incomeSlices(s.income, s.expense, s.saving) : []}
        />
      </section>

      {s.insights.length > 0 && (
        <section className="card insights">
          <h3>💡 이번 달 체크포인트</h3>
          <ul>
            {s.insights.map((t) => (
              <li key={t.text} className={t.level}>
                {INSIGHT_ICON[t.level]} {t.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Calendar s={s} />

      <details className="more">
        <summary>📊 자세히 보기 (예산 · 12개월 추이 · 결제수단 · 많이 쓴 곳 · 세부항목)</summary>
      <section>
        <div className="card">
          <h3>카테고리별 지출 · 예산</h3>
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
      </section>

      <section className="grid-2">
        <div className="card">
          <h3>월별 수입·지출·저축 (최근 12개월)</h3>
          <div className="chart">
            <TrendChart data={trend} />
          </div>
        </div>
        <div className="card">
          <h3>결제수단별 지출</h3>
          {s.byPayment.length === 0 && <p className="muted small">지출 기록이 없어요.</p>}
          <table className="simple">
            <tbody>
              {s.byPayment.map((p) => (
                <tr key={p.method}>
                  <td>{p.method}</td>
                  <td className="muted small">{p.count}건</td>
                  <td className="num">{won(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {s.bySaving.length > 0 && (
            <>
              <h3 style={{ marginTop: 20 }}>저축·투자 내역</h3>
              <table className="simple">
                <tbody>
                  {s.bySaving.map((c) => (
                    <tr key={c.name}>
                      <td>
                        {c.icon} {c.name}
                      </td>
                      <td className="muted small">{c.count}건</td>
                      <td className="num">{won(c.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </section>

      <section className="grid-2">
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
                <th className="num">저축</th>
              </tr>
            </thead>
            <tbody>
              {s.byMember.map((m) => (
                <tr key={m.name}>
                  <td>{m.name}</td>
                  <td className="num">{shortWon(m.income)}</td>
                  <td className="num">{shortWon(m.expense)}</td>
                  <td className="num">{shortWon(m.saving)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
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
          {s.byTag.length > 0 && (
            <>
              <h3 style={{ marginTop: 20 }}>태그별 지출</h3>
              <table className="simple">
                <tbody>
                  {s.byTag.map((t) => (
                    <tr key={t.tag}>
                      <td>#{t.tag}</td>
                      <td className="muted small">{t.count}건</td>
                      <td className="num">{won(t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </section>
      </details>
    </>
  )
}

function AnnualTable({ title, rows }: { title: string; rows: AnnualRow[] }) {
  if (!rows.length) return null
  const totals = Array.from({ length: 12 }, (_, i) => rows.reduce((a, r) => a + r.months[i], 0))
  const total = rows.reduce((a, r) => a + r.total, 0)
  const avg = rows.reduce((a, r) => a + r.average, 0)
  const cell = (v: number, k: number | string) => (
    <td key={k} className={v ? '' : 'zero'}>
      {v ? v.toLocaleString('ko-KR') : '-'}
    </td>
  )
  return (
    <section className="card">
      <h3>{title}</h3>
      <div className="scroll-x">
        <table className="annual">
          <thead>
            <tr>
              <th></th>
              {Array.from({ length: 12 }, (_, i) => (
                <th key={i}>{i + 1}월</th>
              ))}
              <th>합계</th>
              <th>월평균</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>
                  {r.icon} {r.name}
                </td>
                {r.months.map(cell)}
                {cell(r.total, 't')}
                {cell(r.average, 'a')}
              </tr>
            ))}
            <tr className="total">
              <td>합계</td>
              {totals.map(cell)}
              {cell(total, 't')}
              {cell(avg, 'a')}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Yearly({ a, categories, order }: { a: Annual; categories: Category[]; order: number[] }) {
  const data = a.totals.map((t) => ({ ...t, label: `${Number(t.month.slice(5))}월` }))
  const idOf = (name: string) => categories.find((c) => c.type === 'expense' && c.name === name)?.id ?? null
  return (
    <>
      <section className="kpis kpis-4">
        <div className="card kpi">
          <div className="kpi-label">{a.year}년 수입</div>
          <div className="kpi-value">{won(a.income)}</div>
          <span className="muted small">월평균 {shortWon(Math.round(a.income / a.activeMonths))}원</span>
        </div>
        <div className="card kpi">
          <div className="kpi-label">지출</div>
          <div className="kpi-value">{won(a.expense)}</div>
          <span className="muted small">월평균 {shortWon(Math.round(a.expense / a.activeMonths))}원</span>
        </div>
        <div className="card kpi">
          <div className="kpi-label">저축·투자</div>
          <div className="kpi-value">{won(a.saving)}</div>
          <span className="muted small">{a.savingsRate != null ? `저축률 ${a.savingsRate}%` : ''}</span>
        </div>
        <div className="card kpi">
          <div className="kpi-label">남은 돈</div>
          <div className={`kpi-value ${a.net < 0 ? 'bad' : ''}`}>{won(a.net)}</div>
          <span className="muted small">기록된 {a.activeMonths}개월 기준</span>
        </div>
      </section>
      <section className="grid-2">
        <Donut
          title={`${a.year}년 어디에 썼나`}
          centerLabel="연간 지출"
          centerValue={a.expense}
          slices={categorySlices(a.expenseTable.map((r) => ({ id: idOf(r.name), name: r.name, icon: r.icon, amount: r.total, note: `월평균 ${shortWon(r.average)}원` })), order)}
        />
        <Donut title={`${a.year}년 수입은 어디로 갔나`} centerLabel="연간 수입" centerValue={a.income} empty="수입 기록이 없어요." slices={a.income ? incomeSlices(a.income, a.expense, a.saving) : []} />
      </section>
      <section className="card">
        <h3>{a.year}년 월별 흐름</h3>
        <div className="chart">
          <TrendChart data={data} />
        </div>
      </section>
      <details className="more">
        <summary>📋 월별 상세표 (구글 시트의 통합시트와 같은 표)</summary>
        <AnnualTable title="지출 (대분류 × 월)" rows={a.expenseTable} />
        <AnnualTable title="수입" rows={a.incomeTable} />
        <AnnualTable title="저축·투자" rows={a.savingTable} />
      </details>
    </>
  )
}

export default function Dashboard({ ctx, goUpload }: { ctx: Ctx; goUpload: () => void }) {
  const [view, setView] = useState<'month' | 'year'>('month')
  // '' = 우리 전체, 'shared' = 공동, 그 외 = 구성원 id
  const [who, setWho] = useState('')
  const [s, setS] = useState<Stats | null>(null)
  const [a, setA] = useState<Annual | null>(null)
  const year = ctx.month.slice(0, 4)
  const order = ctx.categories.filter((c) => c.type === 'expense').map((c) => c.id)

  useEffect(() => {
    if (view === 'month') api<Stats>(`/stats?month=${ctx.month}${who ? `&member_id=${who}` : ''}`).then(setS)
  }, [ctx.month, who, view])
  useEffect(() => {
    if (view === 'year') api<Annual>(`/annual?year=${year}`).then(setA)
  }, [year, view])

  return (
    <div className="dashboard">
      <div className="segmented">
        <button className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>
          📅 월간
        </button>
        <button className={view === 'year' ? 'active' : ''} onClick={() => setView('year')}>
          📆 {year}년 연간
        </button>
      </div>
      {view === 'month' && (
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
      )}
      {view === 'month' && (s ? <Monthly s={s} goUpload={goUpload} order={order} /> : <div className="muted">불러오는 중…</div>)}
      {view === 'year' && (a ? <Yearly a={a} categories={ctx.categories} order={order} /> : <div className="muted">불러오는 중…</div>)}
    </div>
  )
}
