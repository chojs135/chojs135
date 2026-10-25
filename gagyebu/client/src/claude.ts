import Anthropic from '@anthropic-ai/sdk'
import { fileToText, UnsupportedFileError } from './fileText'

// Apps Script의 외부 요청은 60초에서 끊기므로 Claude는 브라우저에서 직접(스트리밍으로) 호출한다.
// API 키는 구성원 확인을 거친 뒤 서버(시트의 스크립트 속성)에서 받아온다.

export type AnalysisContext = { apiKey: string; model: string; system: string; schema: Record<string, unknown> }

// 대략적인 비용(원). 사진 영수증 1장 / 카드·은행 내역 PDF 몇 쪽 기준, 환율 1,400원 가정.
export const MODEL_INFO: Record<string, { label: string; note: string; receipt: string; statement: string }> = {
  'claude-haiku-5-5': { label: 'Haiku 5.5 (기본·저렴)', note: '가장 싸고 빨라요. 대부분의 영수증·내역서에 충분해요.', receipt: '약 3원', statement: '약 10원' },
  'claude-sonnet-5-5': { label: 'Sonnet 5.5 (균형)', note: '흐린 사진이나 복잡한 문서에서 더 정확해요.', receipt: '약 50원', statement: '약 150원' },
  'claude-opus-5-5': { label: 'Opus 5.5 (최고 정확도)', note: '가장 정확하지만 가장 비싸요.', receipt: '약 100원', statement: '약 300원' },
}
export const modelLabel = (m: string) => MODEL_INFO[m]?.label ?? m

export type Extraction = {
  document_type: string
  summary: string
  transactions: {
    date: string
    type: 'expense' | 'income' | 'transfer'
    amount: number
    merchant: string
    description: string
    category: string
    subcategory: string
    payment_method: string
    confidence: number
    note: string
  }[]
}

type Block = Anthropic.Beta.BetaContentBlockParam
type ImageType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const HEIC2ANY_URL = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js'

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1])
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

/** 휴대폰 사진은 API 이미지 한도(5MB)를 넘기 쉬워서 긴 변 2400px JPEG로 줄인다. */
async function shrinkImage(file: File): Promise<{ data: string; type: ImageType }> {
  if (file.size < 3_500_000) return { data: await toBase64(file), type: file.type as ImageType }
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.85))
  return { data: await toBase64(blob), type: 'image/jpeg' }
}

/** 아이폰 HEIC 사진은 API가 못 읽어서 JPEG로 바꾼다(변환 도구는 그때만 불러옴). */
async function heicToJpeg(file: File): Promise<File> {
  const w = window as unknown as { heic2any?: (o: { blob: Blob; toType: string; quality: number }) => Promise<Blob | Blob[]> }
  if (!w.heic2any) {
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script')
      s.src = HEIC2ANY_URL
      s.onload = () => resolve()
      s.onerror = () => reject(new UnsupportedFileError(`${file.name}: HEIC 사진 변환 도구를 불러오지 못했어요. 스크린샷이나 JPG로 올려 주세요.`))
      document.head.appendChild(s)
    })
  }
  const out = await w.heic2any!({ blob: file, toType: 'image/jpeg', quality: 0.85 })
  const blob = Array.isArray(out) ? out[0] : out
  return new File([blob], file.name.replace(/\.hei[cf]$/i, '.jpg'), { type: 'image/jpeg' })
}

async function fileToBlocks(original: File): Promise<Block[]> {
  let file = original
  const label = `[파일: ${file.name}]`
  const name = file.name.toLowerCase()
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
    return [
      { type: 'text', text: label },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await toBase64(file) } },
    ]
  }
  if (/\.hei[cf]$/.test(name) || file.type === 'image/heic' || file.type === 'image/heif') file = await heicToJpeg(file)
  if (IMAGE_TYPES.includes(file.type)) {
    const img = await shrinkImage(file)
    return [
      { type: 'text', text: label },
      { type: 'image', source: { type: 'base64', media_type: img.type, data: img.data } },
    ]
  }
  // 엑셀·한글·워드·CSV 등은 브라우저에서 글자로 꺼내서 보낸다.
  const text = await fileToText(file.name, file.type, await file.arrayBuffer())
  if (text === null) throw new UnsupportedFileError(`${file.name}: 이 이미지 형식은 지원하지 않아요. JPG나 PNG로 올려 주세요.`)
  return [{ type: 'text', text: `${label}\n${text}` }]
}

/** API 오류를 사람이 읽을 수 있는 말로 바꾼다. 원래 메시지도 함께 보여 줘야 원인을 찾기 쉽다. */
function explain(e: unknown): Error {
  if (e instanceof Anthropic.AuthenticationError) {
    return new Error(`Anthropic이 API 키를 거절했어요(401). 키를 다시 복사해 설정에 넣어 주세요. [${e.message}]`)
  }
  if (e instanceof Anthropic.PermissionDeniedError) return new Error(`이 키로는 사용할 수 없는 기능이에요(403). [${e.message}]`)
  if (e instanceof Anthropic.RateLimitError) return new Error('요청이 많아 잠시 막혔어요. 1분 뒤에 다시 시도해 주세요.')
  if (e instanceof Anthropic.BadRequestError && /credit|balance/i.test(e.message)) {
    return new Error('Anthropic 계정 잔액이 부족해요. console.anthropic.com → Billing에서 충전해 주세요.')
  }
  if (e instanceof Anthropic.APIError) return new Error(`AI 요청 실패 (${e.status ?? '네트워크'}): ${e.message}`)
  return e instanceof Error ? e : new Error(String(e))
}

/** 키가 맞는지만 가볍게 확인한다(모델 목록 조회, 요금 없음). */
export async function testApiKey(apiKey: string): Promise<void> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
  try {
    await client.models.list({ limit: 1 })
  } catch (e) {
    throw explain(e)
  }
}

export async function extractWithClaude(files: File[], ctx: AnalysisContext, model = ctx.model): Promise<Extraction> {
  const content: Block[] = []
  for (const f of files) content.push(...(await fileToBlocks(f)))
  content.push({ type: 'text', text: '위 자료에서 모든 거래를 추출하고 분류해 주세요.' })

  const client = new Anthropic({ apiKey: ctx.apiKey, dangerouslyAllowBrowser: true })
  let message: Anthropic.Beta.BetaMessage
  try {
    message = await client.beta.messages
      .stream({
        model,
        max_tokens: 64000,
        // Haiku는 서버 측 대체 모델(fallbacks)을 지원하지 않는다.
        ...(model.startsWith('claude-haiku') ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: ctx.schema } },
        system: ctx.system,
        messages: [{ role: 'user', content }],
      })
      .finalMessage()
  } catch (e) {
    throw explain(e)
  }

  if (message.stop_reason === 'refusal') throw new Error('AI가 이 문서의 처리를 거절했어요. 다른 파일로 시도해 주세요.')
  if (message.stop_reason === 'max_tokens') throw new Error('문서가 너무 커서 한 번에 처리하지 못했어요. 기간을 나눠 올려 주세요.')
  const text = message.content.find((b) => b.type === 'text')
  if (!text || text.type !== 'text') throw new Error('AI 응답을 해석하지 못했어요.')
  return JSON.parse(text.text) as Extraction
}
