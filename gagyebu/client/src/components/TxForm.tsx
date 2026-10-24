import { useState } from 'react'
import { TYPE_LABEL, type Category, type Member, type Tx, type TxType } from '../api'

export function CategorySelect({
  categories,
  type,
  categoryId,
  subcategory,
  onChange,
}: {
  categories: Category[]
  type: TxType
  categoryId: number | null
  subcategory: string
  onChange: (categoryId: number | null, subcategory: string) => void
}) {
  // 대분류/세부항목을 한 개의 select로 고른다. 값 형식: "카테고리ID|세부항목"
  const options = categories.filter((c) => c.type === type)
  return (
    <select value={`${categoryId ?? ''}|${subcategory}`} onChange={(e) => {
      const [id, sub] = e.target.value.split('|')
      onChange(id ? Number(id) : null, sub ?? '')
    }}>
      <option value="|">미분류</option>
      {options.map((c) => (
        <optgroup key={c.id} label={`${c.icon} ${c.name}`}>
          <option value={`${c.id}|`}>{c.name}</option>
          {c.subcategories.map((s) => (
            <option key={s} value={`${c.id}|${s}`}>
              {c.name} › {s}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

export function MemberSelect({ members, value, onChange }: { members: Member[]; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">공동</option>
      {members.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  )
}

/** 쉼표로 구분한 태그 입력. 자주 쓰는 태그는 눌러서 추가. */
export function TagInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(', '))
  const commit = (t: string) => onChange([...new Set(t.split(',').map((x) => x.replace(/^#/, '').trim()).filter(Boolean))])
  return (
    <div className="tag-input">
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          commit(e.target.value)
        }}
        placeholder="예: 반성, 확인필요, 여행"
      />
      <div className="tag-suggest">
        {SUGGESTED_TAGS.filter((t) => !value.includes(t)).map((t) => (
          <button
            type="button"
            key={t}
            className="chip"
            onClick={() => {
              const next = [...value, t]
              setText(next.join(', '))
              onChange(next)
            }}
          >
            #{t}
          </button>
        ))}
      </div>
    </div>
  )
}
const SUGGESTED_TAGS = ['반성', '확인필요', '여행', '경조사']

export default function TxForm({
  initial,
  categories,
  members,
  onSave,
  onDelete,
  onClose,
}: {
  initial: Tx
  categories: Category[]
  members: Member[]
  onSave: (t: Tx) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
}) {
  const [t, setT] = useState<Tx>(initial)
  const [error, setError] = useState('')
  const set = <K extends keyof Tx>(k: K, v: Tx[K]) => setT((p) => ({ ...p, [k]: v }))

  async function save(e: React.FormEvent) {
    e.preventDefault()
    try {
      await onSave(t)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal card form" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h3>{initial.id ? '내역 수정' : '직접 입력'}</h3>
        <div className="segmented">
          {(Object.keys(TYPE_LABEL) as TxType[]).map((k) => (
            <button type="button" key={k} className={t.type === k ? 'active' : ''} onClick={() => setT({ ...t, type: k, category_id: null, subcategory: '' })}>
              {TYPE_LABEL[k]}
            </button>
          ))}
        </div>
        <label>
          금액
          <input inputMode="numeric" value={t.amount ? t.amount.toLocaleString('ko-KR') : ''} onChange={(e) => set('amount', Number(e.target.value.replace(/[^0-9]/g, '')))} placeholder="0" required autoFocus />
        </label>
        <label>
          날짜 <input type="date" value={t.date} onChange={(e) => set('date', e.target.value)} required />
        </label>
        <label>
          카테고리
          <CategorySelect categories={categories} type={t.type} categoryId={t.category_id} subcategory={t.subcategory} onChange={(id, sub) => setT({ ...t, category_id: id, subcategory: sub })} />
        </label>
        <label>
          가맹점/상대 <input value={t.merchant} onChange={(e) => set('merchant', e.target.value)} />
        </label>
        <label>
          내용 <input value={t.description} onChange={(e) => set('description', e.target.value)} />
        </label>
        <div className="row-2">
          <label>
            결제수단 <input value={t.payment_method} onChange={(e) => set('payment_method', e.target.value)} placeholder="예: 신한카드" />
          </label>
          <label>
            사용자 <MemberSelect members={members} value={t.member_id} onChange={(v) => set('member_id', v)} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={t.fixed} onChange={(e) => set('fixed', e.target.checked)} />
          매달 나가는 고정지출이에요 (관리비·통신비·보험·구독 등)
        </label>
        <label>
          태그 <TagInput value={t.tags} onChange={(v) => set('tags', v)} />
        </label>
        <label>
          메모 <input value={t.memo} onChange={(e) => set('memo', e.target.value)} />
        </label>
        {error && <div className="error">{error}</div>}
        <div className="actions">
          {onDelete && (
            <button type="button" className="danger" onClick={() => confirm('이 내역을 삭제할까요?') && onDelete()}>
              삭제
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button className="primary">저장</button>
        </div>
      </form>
    </div>
  )
}
