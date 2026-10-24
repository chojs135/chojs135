export type Slice = { key: string; label: string; amount: number; color: string; icon?: string; note?: string }

const SLOTS = 8
const OTHER = 'var(--cat-other)'

/**
 * 카테고리 색은 순위가 아니라 카테고리 자체에 붙는다(설정 순서 기준 8가지 색).
 * 화면에 같이 나오는 조각끼리 색이 겹치면 다음 빈 색을 쓴다.
 */
export function categorySlices(
  rows: { id: number | null; name: string; icon: string; amount: number; note?: string }[],
  order: number[],
  max = 7,
): Slice[] {
  const sorted = [...rows].filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount)
  const shown = sorted.length > max ? sorted.slice(0, max - 1) : sorted
  const rest = sorted.slice(shown.length)
  const used = new Set<number>()
  const slices: Slice[] = shown.map((r) => {
    let slot = Math.max(0, order.indexOf(r.id ?? -1)) % SLOTS
    for (let i = 0; i < SLOTS && used.has(slot); i++) slot = (slot + 1) % SLOTS
    used.add(slot)
    return { key: String(r.id), label: r.name, icon: r.icon, amount: r.amount, color: `var(--cat-${slot + 1})`, note: r.note }
  })
  if (rest.length) {
    slices.push({ key: 'other', label: `그 외 ${rest.length}개`, amount: rest.reduce((a, r) => a + r.amount, 0), color: OTHER, note: rest.map((r) => r.name).join(', ') })
  }
  return slices
}
