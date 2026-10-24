export type TxType = 'expense' | 'income' | 'transfer'

export type Category = {
  id: number
  type: TxType
  name: string
  icon: string
  color: string
  subcategories: string[]
  sort: number
}

export type Member = { id: number; name: string }

export type Me = {
  user: { id: number; householdId: number; name: string; email: string }
  household: { id: number; name: string; invite_code: string }
  members: Member[]
}

export type Tx = {
  id?: number
  date: string
  type: TxType
  amount: number
  category_id: number | null
  subcategory: string
  merchant: string
  description: string
  payment_method: string
  member_id: number | null
  memo: string
  source?: string
  created_by_name?: string
}

export type DraftItem = Tx & {
  confidence: number
  note: string
  duplicate: boolean
  rule_applied: boolean
  ai_category_id: number | null
  ai_subcategory: string
  include: boolean
}

export type Stats = {
  month: string
  income: number
  expense: number
  net: number
  count: number
  savingsRate: number | null
  prev: { income: number; expense: number }
  byCategory: { id: number | null; name: string; icon: string; color: string; amount: number; count: number; budget: number | null; prevAmount: number }[]
  bySubcategory: { category: string; subcategory: string; amount: number }[]
  byMember: { name: string; expense: number; income: number }[]
  daily: { date: string; amount: number }[]
  trend: { month: string; income: number; expense: number }[]
  topMerchants: { merchant: string; amount: number; count: number }[]
  insights: string[]
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'),
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
    credentials: 'same-origin',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.error ?? '요청에 실패했습니다.')
  return data as T
}

export const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`
export const shortWon = (n: number) => {
  const a = Math.abs(n)
  if (a >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`
  if (a >= 10_000) return `${Math.round(n / 10_000).toLocaleString('ko-KR')}만`
  return n.toLocaleString('ko-KR')
}
export const TYPE_LABEL: Record<TxType, string> = { expense: '지출', income: '수입', transfer: '이체' }
export const thisMonth = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 7)
export const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
