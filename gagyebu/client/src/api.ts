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

export type Member = { id: number; name: string; email: string }

export type MeResponse =
  | { state: 'setup' | 'not_member'; email: string; sheetUrl: string }
  | {
      state: 'ok'
      email: string
      sheetUrl: string
      user: Member
      household: { name: string }
      members: Member[]
      hasApiKey: boolean
    }
export type Me = Extract<MeResponse, { state: 'ok' }>

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

type GoogleScriptRun = {
  withSuccessHandler(fn: (r: string) => void): GoogleScriptRun
  withFailureHandler(fn: (e: Error) => void): GoogleScriptRun
  api(method: string, path: string, body: string): void
}
declare global {
  interface Window {
    google?: { script: { run: GoogleScriptRun } }
  }
}

// 구글 앱스 스크립트 안에서는 google.script.run으로, 로컬 개발(npm run dev)에서는 dev 서버로 보낸다.
function callBackend(method: string, path: string, body: string): Promise<string> {
  const run = window.google?.script?.run
  if (run) {
    return new Promise((resolve, reject) => run.withSuccessHandler(resolve).withFailureHandler(reject).api(method, path, body))
  }
  const user = new URLSearchParams(location.search).get('as') ?? undefined
  return fetch('/__gas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, path, body, user }) }).then((r) => r.text())
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET')
  let raw: string
  try {
    raw = await callBackend(method, path, opts.body !== undefined ? JSON.stringify(opts.body) : '')
  } catch (e) {
    throw new ApiError(0, `서버에 연결하지 못했어요: ${(e as Error).message}`)
  }
  const res = JSON.parse(raw) as { ok: true; data: T } | { ok: false; status: number; error: string }
  if (!res.ok) throw new ApiError(res.status, res.error)
  return res.data
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
