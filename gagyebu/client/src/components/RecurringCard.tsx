import { useEffect, useState } from 'react'
import { api, shortWon, won, type RecurringInfo } from '../api'

const STATUS = { paid: '✅ 나감', upcoming: '⏳ 예정', missing: '❓ 아직 없음' }

/** 대시보드용: 이번 달 정기결제(결제일 관리) 현황 */
export default function RecurringCard({ month, onManage }: { month: string; onManage: () => void }) {
  const [info, setInfo] = useState<RecurringInfo | null>(null)
  useEffect(() => {
    api<RecurringInfo>(`/recurring?month=${month}`).then(setInfo)
  }, [month])
  if (!info) return null
  const { items, paid, remaining } = info.status
  return (
    <section className="card">
      <h3>
        📅 이번 달 정기결제{' '}
        <span className="muted small">
          {items.length ? `나감 ${shortWon(paid)}원 · 남음 ${shortWon(remaining)}원` : ''}
        </span>
      </h3>
      {items.length === 0 ? (
        <p className="small muted">
          월세·통신비·보험·구독·적금처럼 매달 나가는 돈을 등록하면 결제일에 자동으로 기록돼요.{' '}
          <button className="chip" onClick={onManage}>
            등록하러 가기
          </button>
          {info.suggestions.length > 0 && ` (지난 내역에서 ${info.suggestions.length}개 찾았어요)`}
        </p>
      ) : (
        <ul className="recurring-list">
          {items.map((i) => (
            <li key={i.id} className={i.status}>
              <span className="r-day">{i.day === 31 ? '말일' : `${i.day}일`}</span>
              <span className="r-name">
                {i.name}
                {!i.auto && <span className="muted small"> (금액 변동)</span>}
              </span>
              <span className="small r-status">{STATUS[i.status]}</span>
              <span className="num">{won(i.status === 'paid' ? i.paid_amount : i.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
