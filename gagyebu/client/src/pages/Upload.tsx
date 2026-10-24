import { useEffect, useRef, useState } from 'react'
import { api, won, type DraftItem, type TxType } from '../api'
import { extractWithClaude, MODEL_INFO, modelLabel, type AnalysisContext } from '../claude'
import type { Ctx } from '../App'
import { CategorySelect, MemberSelect } from '../components/TxForm'

type Result = { filenames: string[]; document_type: string; summary: string; items: DraftItem[]; model: string }
const BEST_MODEL = 'claude-opus-5-5'
type History = { id: number; filenames: string; doc_type: string; summary: string; created_at: string; created_by_name: string; tx_count: number }

export default function Upload({ ctx, onSaved }: { ctx: Ctx; onSaved: (months: string[], count: number) => void }) {
  const [files, setFiles] = useState<File[]>([])
  // 검토 화면에서 더 정확한 모델로 다시 분석할 수 있게 마지막 파일을 기억해 둔다.
  const [lastFiles, setLastFiles] = useState<File[]>([])
  const [memberId, setMemberId] = useState<number | null>(ctx.me.user.id)
  const [busy, setBusy] = useState<string | false>(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [history, setHistory] = useState<History[]>([])
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api<History[]>('/uploads').then(setHistory)
  }, [result])

  async function analyze(target: File[] = files, model?: string) {
    setError('')
    try {
      const context = await api<AnalysisContext>('/analysis-context')
      const used = model ?? context.model
      setBusy(`🤖 ${modelLabel(used)}가 문서를 읽고 있어요… (보통 30초~2분)`)
      const extraction = await extractWithClaude(target, context, used)
      setBusy('분류 결과를 정리하고 있어요…')
      const prepared = await api<Omit<Result, 'filenames' | 'model'>>('/uploads/prepare', { body: { extraction, member_id: memberId } })
      setResult({ ...prepared, filenames: target.map((f) => f.name), model: used })
      setLastFiles(target)
      setFiles([])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function commit() {
    if (!result) return
    setBusy('저장 중…')
    setError('')
    try {
      await api('/uploads/commit', { body: { items: result.items, filenames: result.filenames, document_type: result.document_type, summary: result.summary } })
      const saved = result.items.filter((i) => i.include)
      setResult(null)
      onSaved(saved.map((i) => i.date.slice(0, 7)), saved.length)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const update = (i: number, patch: Partial<DraftItem>) =>
    setResult((r) => r && { ...r, items: r.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) })

  if (result) {
    const included = result.items.filter((i) => i.include)
    const sum = (t: TxType) => included.filter((i) => i.type === t).reduce((a, i) => a + i.amount, 0)
    const dates = included.map((i) => i.date).sort()
    const months = [...new Set(dates.map((d) => d.slice(0, 7)))]
    const otherMonth = months.some((m) => m !== ctx.month)
    return (
      <div>
        <div className="card">
          <h3>🤖 {result.document_type}</h3>
          <p>{result.summary}</p>
          {dates.length > 0 && (
            <p className={otherMonth ? 'notice' : 'small muted'}>
              📅 날짜: {dates[0]}
              {dates.length > 1 && dates.at(-1) !== dates[0] ? ` ~ ${dates.at(-1)}` : ''}
              {otherMonth && ` — ${months.map((m) => `${Number(m.slice(5))}월`).join(', ')} 내역으로 저장돼요. 날짜가 틀리면 아래에서 고쳐 주세요.`}
            </p>
          )}
          <div className="actions" style={{ marginTop: 4 }}>
            <span className="small muted">분석: {modelLabel(result.model)}</span>
            <span style={{ flex: 1 }} />
            {result.model !== BEST_MODEL && lastFiles.length > 0 && (
              <button type="button" disabled={!!busy} onClick={() => analyze(lastFiles, BEST_MODEL)}>
                🔍 Opus로 다시 분석 ({MODEL_INFO[BEST_MODEL].receipt}~)
              </button>
            )}
          </div>
          {busy && <p className="small">{busy}</p>}
          {error && <p className="error">{error}</p>}
          <p className="small muted">
            분류가 틀린 게 있으면 바로 고쳐 주세요. 고친 가맹점은 다음부터 그대로 분류돼요. 중복으로 의심되는 항목은 기본으로 빼 두었어요.
          </p>
        </div>

        <div className="review card">
          {result.items.length === 0 && <p className="muted">추출된 거래가 없어요.</p>}
          {result.items.map((it, i) => (
            <div key={i} className={`review-row ${it.include ? '' : 'excluded'}`}>
              <input type="checkbox" checked={it.include} onChange={(e) => update(i, { include: e.target.checked })} aria-label="포함" />
              <div className="review-fields">
                <div className="review-top">
                  <input type="date" value={it.date} onChange={(e) => update(i, { date: e.target.value })} />
                  <select value={it.type} onChange={(e) => update(i, { type: e.target.value as TxType, category_id: null, subcategory: '' })}>
                    <option value="expense">지출</option>
                    <option value="income">수입</option>
                    <option value="saving">저축</option>
                    <option value="transfer">이체</option>
                  </select>
                  <input className="amount" inputMode="numeric" value={it.amount.toLocaleString('ko-KR')} onChange={(e) => update(i, { amount: Number(e.target.value.replace(/[^0-9]/g, '')) })} />
                </div>
                <div className="review-top">
                  <input className="grow" value={it.merchant} onChange={(e) => update(i, { merchant: e.target.value })} placeholder="가맹점" />
                  <CategorySelect categories={ctx.categories} type={it.type} categoryId={it.category_id} subcategory={it.subcategory} onChange={(id, sub) => update(i, { category_id: id, subcategory: sub })} />
                </div>
                <div className="small muted">
                  {it.description}
                  {it.payment_method && ` · ${it.payment_method}`}
                </div>
                <div className="badges">
                  <button type="button" className={`chip ${it.fixed ? 'on' : ''}`} onClick={() => update(i, { fixed: !it.fixed })}>
                    📌 고정{it.fixed ? ' ✓' : ''}
                  </button>
                  <button
                    type="button"
                    className={`chip ${it.tags.includes('반성') ? 'on' : ''}`}
                    onClick={() => update(i, { tags: it.tags.includes('반성') ? it.tags.filter((x) => x !== '반성') : [...it.tags, '반성'] })}
                  >
                    #반성
                  </button>
                  {it.duplicate && <span className="badge warn">⚠️ 이미 있는 내역일 수 있음</span>}
                  {it.rule_applied && <span className="badge">📌 우리집 규칙 적용</span>}
                  {it.confidence < 0.7 && <span className="badge warn">❓ 확인 필요{it.note ? `: ${it.note}` : ''}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="sticky-actions card">
          <div className="small">
            {included.length}건 · 지출 {won(sum('expense'))} · 수입 {won(sum('income'))}
            {sum('saving') > 0 && ` · 저축 ${won(sum('saving'))}`}
            {sum('transfer') > 0 && ` · 이체 ${won(sum('transfer'))}`}
          </div>
          {error && <div className="error">{error}</div>}
          <div className="actions">
            <button onClick={() => setResult(null)}>취소</button>
            <button className="primary" disabled={!!busy || included.length === 0} onClick={commit}>
              {busy || `${included.length}건 저장`}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div
        className={`card dropzone ${drag ? 'drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          setFiles([...files, ...Array.from(e.dataTransfer.files)])
        }}
        onClick={() => inputRef.current?.click()}
      >
        <div className="dropzone-icon">📤</div>
        <p>
          <b>은행·카드 내역서, 영수증, 관리비 고지서</b>를 올려 주세요
        </p>
        <p className="small muted">PDF · 사진/스크린샷(JPG, PNG) · 엑셀(XLSX) · CSV · 여러 개 한꺼번에 가능</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept=".pdf,.csv,.xlsx,.txt,image/jpeg,image/png,image/webp,image/gif"
          onChange={(e) => {
            setFiles([...files, ...Array.from(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
      </div>

      {files.length > 0 && (
        <div className="card">
          <ul className="file-list">
            {files.map((f, i) => (
              <li key={i}>
                📄 {f.name} <span className="muted small">{Math.round(f.size / 1024)}KB</span>
                <button className="icon-btn" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="빼기">
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <label className="inline">
            누구의 거래인가요? <MemberSelect members={ctx.me.members} value={memberId} onChange={setMemberId} />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="primary wide" disabled={!!busy} onClick={() => analyze()}>
            {busy || '🤖 AI로 분석하기'}
          </button>
        </div>
      )}

      {history.length > 0 && (
        <div className="card">
          <h3>최근 업로드</h3>
          <table className="simple">
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="small muted">{h.created_at.slice(0, 10)}</td>
                  <td>
                    {h.doc_type}
                    <div className="small muted">{h.filenames}</div>
                  </td>
                  <td className="small">{h.created_by_name}</td>
                  <td className="small">{h.tx_count}건 저장</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
