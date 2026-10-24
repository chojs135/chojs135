import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { shortWon, won } from '../api'
import type { Slice } from './slices'

export default function Donut({ title, slices, centerLabel, centerValue, empty }: { title: string; slices: Slice[]; centerLabel: string; centerValue: number; empty?: string }) {
  const total = slices.reduce((a, s) => a + s.amount, 0)
  return (
    <div className="card donut-card">
      <h3>{title}</h3>
      {total === 0 ? (
        <p className="muted small">{empty ?? '기록이 없어요.'}</p>
      ) : (
        <div className="donut-wrap">
          <div className="donut">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={slices} dataKey="amount" nameKey="label" innerRadius="62%" outerRadius="96%" startAngle={90} endAngle={-270} stroke="var(--surface)" strokeWidth={2} isAnimationActive={false}>
                  {slices.map((s) => (
                    <Cell key={s.key} fill={s.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v, name) => [`${won(Number(v))} (${Math.round((Number(v) / total) * 100)}%)`, name]}
                  contentStyle={{ borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-center">
              <span className="muted small">{centerLabel}</span>
              <b>{shortWon(centerValue)}원</b>
            </div>
          </div>
          <ul className="donut-legend">
            {slices.map((s) => (
              <li key={s.key} title={s.note}>
                <span className="swatch" style={{ background: s.color }} />
                <span className="legend-name">
                  {s.icon} {s.label}
                  {s.note && <span className="muted small legend-note"> {s.note}</span>}
                </span>
                <span className="muted small">{Math.round((s.amount / total) * 100)}%</span>
                <span className="num">{won(s.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
