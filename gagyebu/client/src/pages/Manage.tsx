import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Ctx } from '../App'
import LedgerView from '../components/LedgerView'
import RecurringManager from '../components/RecurringManager'

/** 엑셀 가계부의 관리 탭들: 결제일 관리 + 자산·예비비·대출·카드·통장·이벤트 */
export default function Manage({ ctx, initial }: { ctx: Ctx; initial?: string }) {
  const [tabs, setTabs] = useState<{ type: string; name: string; icon: string }[]>([])
  const [sub, setSub] = useState(initial ?? 'recurring')
  useEffect(() => {
    api<{ type: string; name: string; icon: string }[]>('/ledgers').then(setTabs)
  }, [])
  return (
    <div>
      <div className="chip-tabs">
        <button className={sub === 'recurring' ? 'active' : ''} onClick={() => setSub('recurring')}>
          📅 결제일 관리
        </button>
        {tabs.map((t) => (
          <button key={t.type} className={sub === t.type ? 'active' : ''} onClick={() => setSub(t.type)}>
            {t.icon} {t.name}
          </button>
        ))}
      </div>
      {sub === 'recurring' ? <RecurringManager ctx={ctx} /> : <LedgerView key={sub} type={sub} ctx={ctx} />}
    </div>
  )
}
