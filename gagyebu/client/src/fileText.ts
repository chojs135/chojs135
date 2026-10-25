// 업로드한 파일을 Claude가 읽을 수 있는 글자로 바꾼다.
// PDF와 사진은 Claude가 직접 읽으므로 여기서 다루지 않는다(claude.ts).
// 엑셀·한글·워드 같은 문서는 브라우저에서 내용을 꺼내 표 모양(탭 구분)을 살린 텍스트로 보낸다.
import JSZip from 'jszip'
import CFB from 'cfb'

export class UnsupportedFileError extends Error {}

// 아주 큰 표는 AI 한 번에 다 못 넣으므로 자르지 않고 나눠 올리라고 알린다.
const MAX_CHARS = 600_000

const SHEETJS_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'

const ext = (name: string) => name.toLowerCase().split('.').pop() ?? ''

/** 국내 은행 CSV·텍스트는 아직 EUC-KR(CP949)인 경우가 많다. */
export function decodeText(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buf)
  const text = utf8.includes('�') ? new TextDecoder('euc-kr').decode(buf) : utf8
  return text.replace(/^﻿/, '')
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
}

const clean = (s: string) => s.replace(/[ \t\r\n]+/g, ' ').trim()

/** HTML 표(은행 "엑셀 다운로드"가 실제로는 HTML인 경우가 많다) → 탭 구분 텍스트 */
export function htmlToText(html: string): string {
  const body = html.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
  const rows: string[] = []
  // 표 밖의 글(제목, 기간 등)도 남긴다.
  const parts = body.split(/(<table[\s\S]*?<\/table>)/i)
  for (const part of parts) {
    if (/^<table/i.test(part)) {
      for (const tr of part.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
        const cells = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map((c) => clean(decodeEntities(c.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))))
        if (cells.some(Boolean)) rows.push(cells.join('\t'))
      }
    } else {
      const text = clean(decodeEntities(part.replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, ' ')))
      if (text) rows.push(text)
    }
  }
  return rows.join('\n')
}

function looksLikeHtml(buf: ArrayBuffer): boolean {
  const head = decodeText(buf.slice(0, 2048)).trimStart().toLowerCase()
  return head.startsWith('<') && /<(html|table|meta|!doctype)/.test(head)
}

// ---------------------------------------------------------------- 엑셀 xlsx (OOXML)

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]

function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A'
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
}

/** 엑셀 날짜 일련번호(1900 기준) → YYYY-MM-DD (시각이 있으면 HH:MM 붙임) */
function excelDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400000)
  const iso = new Date(ms).toISOString()
  const time = iso.slice(11, 16)
  return iso.slice(0, 10) + (time !== '00:00' ? ` ${time}` : '')
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57])

function isDateFormat(code: string): boolean {
  const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')
  return /[ymd]/i.test(bare) && !/^[#0.,%\s]*$/.test(bare)
}

export async function xlsxToText(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf)
  const read = async (p: string) => (await zip.file(p)?.async('string')) ?? ''
  const shared = (await read('xl/sharedStrings.xml')).match(/<si>[\s\S]*?<\/si>/g)?.map((si) => decodeEntities((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join(''))) ?? []

  const styles = await read('xl/styles.xml')
  const custom = new Map<number, string>()
  for (const nf of styles.match(/<numFmt [^>]*\/?>/g) ?? []) custom.set(Number(attr(nf, 'numFmtId')), decodeEntities(attr(nf, 'formatCode') ?? ''))
  const cellXfs = styles.match(/<cellXfs[\s\S]*?<\/cellXfs>/)?.[0] ?? ''
  const dateStyle = (cellXfs.match(/<xf [^>]*?(\/>|>)/g) ?? []).map((xf) => {
    const id = Number(attr(xf, 'numFmtId') ?? 0)
    return BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!))
  })

  const workbook = await read('xl/workbook.xml')
  const rels = await read('xl/_rels/workbook.xml.rels')
  const out: string[] = []
  for (const sheet of workbook.match(/<sheet [^>]*\/>/g) ?? []) {
    const rid = attr(sheet, 'r:id')
    const target = (rels.match(/<Relationship [^>]*\/>/g) ?? []).find((r) => attr(r, 'Id') === rid)
    const path = target ? 'xl/' + (attr(target, 'Target') ?? '').replace(/^\/?xl\//, '').replace(/^\//, '') : ''
    const xml = await read(path)
    if (!xml) continue
    out.push(`### 시트: ${decodeEntities(attr(sheet, 'name') ?? '')}`)
    for (const row of xml.match(/<row[\s\S]*?<\/row>|<row [^>]*\/>/g) ?? []) {
      const cells: string[] = []
      for (const c of row.match(/<c [^>]*?\/>|<c [^>]*>[\s\S]*?<\/c>/g) ?? []) {
        const open = c.match(/<c [^>]*>/)?.[0] ?? c
        const idx = colIndex(attr(open, 'r') ?? '')
        const t = attr(open, 't')
        const v = c.match(/<v>([\s\S]*?)<\/v>/)?.[1]
        let text = ''
        if (t === 's' && v !== undefined) text = shared[Number(v)] ?? ''
        else if (t === 'inlineStr') text = decodeEntities((c.match(/<t[^>]*>[\s\S]*?<\/t>/g) ?? []).map((x) => x.replace(/<[^>]+>/g, '')).join(''))
        else if (t === 'b') text = v === '1' ? 'TRUE' : 'FALSE'
        else if (v !== undefined) {
          const num = Number(v)
          text = t !== 'str' && dateStyle[Number(attr(open, 's') ?? 0)] && isFinite(num) ? excelDate(num) : decodeEntities(v)
        }
        cells[idx] = clean(text)
      }
      if (cells.some(Boolean)) out.push(Array.from(cells, (x) => x ?? '').join('\t'))
    }
  }
  return out.join('\n')
}

// ---------------------------------------------------------------- 워드 docx · 한글 hwpx (둘 다 ZIP + XML)

/**
 * 문단/표 구조의 XML에서 글자를 꺼낸다. 표는 행마다 한 줄, 칸은 탭으로.
 * tags: 문단, 글자, 표, 행, 칸 태그 이름(접두사 제외)
 */
function xmlDocText(xml: string, tags: { p: string; t: string; tbl: string; tr: string; tc: string; tab: string[]; br: string[] }): string {
  const P = '(?:\\w+:)?'
  const textOf = (frag: string) =>
    decodeEntities(
      frag
        .replace(new RegExp(`<${P}(${tags.tab.join('|')})\\b[^>]*/>`, 'g'), '\t')
        .replace(new RegExp(`<${P}(${tags.br.join('|')})\\b[^>]*/>`, 'g'), ' ')
        .replace(new RegExp(`</${P}${tags.p}>`, 'g'), ' ')
        .match(new RegExp(`<${P}${tags.t}(?:\\s[^>]*)?>[\\s\\S]*?</${P}${tags.t}>|\\t`, 'g'))
        ?.map((m) => (m === '\t' ? '\t' : m.replace(/<[^>]+>/g, '')))
        .join('') ?? '',
    ).trim()

  const tblRe = new RegExp(`<${P}${tags.tbl}[\\s>][\\s\\S]*?</${P}${tags.tbl}>`, 'g')
  const lines: string[] = []
  let last = 0
  // 표 바깥 문단 → 줄, 표 → 행마다 한 줄 (중첩 표는 바깥 칸의 글자로 합쳐짐)
  const paragraphs = (frag: string) => {
    for (const p of frag.match(new RegExp(`<${P}${tags.p}[\\s>][\\s\\S]*?</${P}${tags.p}>`, 'g')) ?? []) {
      const t = textOf(p)
      if (t) lines.push(t)
    }
  }
  for (const m of xml.matchAll(tblRe)) {
    paragraphs(xml.slice(last, m.index))
    for (const tr of m[0].match(new RegExp(`<${P}${tags.tr}[\\s>][\\s\\S]*?</${P}${tags.tr}>`, 'g')) ?? []) {
      const cells = (tr.match(new RegExp(`<${P}${tags.tc}[\\s>][\\s\\S]*?</${P}${tags.tc}>`, 'g')) ?? []).map((tc) => clean(textOf(tc)))
      if (cells.some(Boolean)) lines.push(cells.join('\t'))
    }
    last = (m.index ?? 0) + m[0].length
  }
  paragraphs(xml.slice(last))
  return lines.join('\n')
}

export async function docxToText(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf)
  const xml = (await zip.file('word/document.xml')?.async('string')) ?? ''
  return xmlDocText(xml, { p: 'p', t: 't', tbl: 'tbl', tr: 'tr', tc: 'tc', tab: ['tab'], br: ['br', 'cr'] })
}

export async function hwpxToText(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf)
  const sections = Object.keys(zip.files)
    .filter((p) => /^Contents\/section\d+\.xml$/i.test(p))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
  const parts: string[] = []
  for (const s of sections) {
    const xml = (await zip.file(s)?.async('string')) ?? ''
    parts.push(xmlDocText(xml, { p: 'p', t: 't', tbl: 'tbl', tr: 'tr', tc: 'tc', tab: ['tab'], br: ['lineBreak'] }))
  }
  return parts.join('\n')
}

// ---------------------------------------------------------------- 한글 hwp (HWP 5.0: OLE 복합 문서 + deflate 압축 레코드)

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// CFB는 스트림 내용을 Uint8Array 대신 일반 배열로 줄 때가 있다.
const bytes = (c: unknown): Uint8Array => (c instanceof Uint8Array ? c : Uint8Array.from((c as ArrayLike<number>) ?? []))

const HWPTAG_PARA_TEXT = 67
// 8글자(16바이트)를 차지하는 확장/인라인 컨트롤 문자들 — 표·그림 위치 표시 등이라 건너뛴다.
const HWP_WIDE_CONTROLS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23])

function hwpParaText(rec: Uint8Array): string {
  const view = new DataView(rec.buffer, rec.byteOffset, rec.byteLength)
  let out = ''
  for (let i = 0; i + 1 < rec.length; ) {
    const ch = view.getUint16(i, true)
    if (ch < 32) {
      if (ch === 9) out += '\t'
      else if (ch === 10 || ch === 13) out += '\n'
      i += HWP_WIDE_CONTROLS.has(ch) ? 16 : 2
      continue
    }
    out += String.fromCharCode(ch)
    i += 2
  }
  return out
}

export async function hwpToText(buf: ArrayBuffer): Promise<string> {
  let doc
  try {
    doc = CFB.read(new Uint8Array(buf), { type: 'array' })
  } catch {
    throw new UnsupportedFileError('한글 파일을 열지 못했어요. 한글에서 PDF로 저장해서 올려 주세요.')
  }
  const entry = CFB.find(doc, 'FileHeader')
  const header = entry ? bytes(entry.content) : undefined
  if (!header || new TextDecoder('ascii').decode(header.slice(0, 17)) !== 'HWP Document File') {
    throw new UnsupportedFileError('한글(HWP 5.0) 파일이 아니에요. 한글에서 PDF로 저장해서 올려 주세요.')
  }
  const flags = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(36, true)
  if (flags & 2) throw new UnsupportedFileError('암호가 걸린 한글 파일이에요. 암호를 풀어 저장하거나 PDF로 올려 주세요.')
  if (flags & 4) throw new UnsupportedFileError('배포용(보안) 한글 문서라 내용을 꺼낼 수 없어요. PDF로 인쇄해서 올려 주세요.')
  const compressed = (flags & 1) === 1

  const sections = doc.FullPaths.map((p, i) => ({ p, i }))
    .filter(({ p }) => /BodyText\/Section\d+$/i.test(p))
    .sort((a, b) => Number(a.p.match(/(\d+)$/)![1]) - Number(b.p.match(/(\d+)$/)![1]))
  const lines: string[] = []
  for (const { i } of sections) {
    let data = bytes(doc.FileIndex[i].content)
    if (!data?.length) continue
    if (compressed) data = await inflateRaw(data)
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    for (let pos = 0; pos + 4 <= data.length; ) {
      const h = view.getUint32(pos, true)
      const tag = h & 0x3ff
      let size = (h >>> 20) & 0xfff
      pos += 4
      if (size === 0xfff) {
        size = view.getUint32(pos, true)
        pos += 4
      }
      if (tag === HWPTAG_PARA_TEXT) {
        const text = hwpParaText(data.subarray(pos, pos + size)).trim()
        if (text) lines.push(text)
      }
      pos += size
    }
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------- 그 밖의 표 형식(xls·ods·numbers·xlsb): SheetJS를 그때만 불러온다

type SheetJS = {
  read(data: ArrayBuffer, opts: object): { SheetNames: string[]; Sheets: Record<string, unknown> }
  utils: { sheet_to_csv(ws: unknown, opts: object): string }
}

function loadSheetJS(): Promise<SheetJS> {
  const w = window as unknown as { XLSX?: SheetJS }
  if (w.XLSX) return Promise.resolve(w.XLSX)
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SHEETJS_URL
    s.onload = () => resolve(w.XLSX!)
    s.onerror = () => reject(new UnsupportedFileError('엑셀 읽기 도구를 불러오지 못했어요. 엑셀에서 xlsx나 PDF로 저장해서 올려 주세요.'))
    document.head.appendChild(s)
  })
}

async function sheetJsToText(buf: ArrayBuffer): Promise<string> {
  const XLSX = await loadSheetJS()
  let wb
  try {
    wb = XLSX.read(buf, { type: 'array', cellDates: true, dateNF: 'yyyy-mm-dd' })
  } catch (e) {
    if (/password|encrypt/i.test(String(e))) throw new UnsupportedFileError('비밀번호가 걸린 엑셀 파일이에요. 엑셀에서 열어 비밀번호 없이 저장하거나 PDF로 올려 주세요.')
    throw new UnsupportedFileError('엑셀 파일을 읽지 못했어요. xlsx나 PDF로 저장해서 올려 주세요.')
  }
  return wb.SheetNames.map((n) => `### 시트: ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: '\t', blankrows: false, dateNF: 'yyyy-mm-dd' })}`).join('\n')
}

// ---------------------------------------------------------------- 진입점

/** 문서를 글자로. PDF·사진처럼 Claude가 직접 읽는 파일이면 null. */
export async function fileToText(name: string, mime: string, buf: ArrayBuffer): Promise<string | null> {
  const e = ext(name)
  let text: string
  if (e === 'pdf' || mime === 'application/pdf' || mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'].includes(e)) return null
  else if (e === 'hwpx') text = await hwpxToText(buf)
  else if (e === 'hwp') text = await hwpToText(buf)
  else if (e === 'docx') text = await docxToText(buf)
  else if (e === 'doc' || e === 'ppt' || e === 'pptx') throw new UnsupportedFileError(`${name}: 이 형식은 아직 못 읽어요. PDF로 저장해서 올려 주세요.`)
  else if (['xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'numbers'].includes(e)) {
    // 은행 "엑셀 다운로드"는 확장자만 xls인 HTML 표인 경우가 많다.
    if (looksLikeHtml(buf)) text = htmlToText(decodeText(buf))
    else if (e === 'xlsx' || e === 'xlsm') {
      try {
        text = await xlsxToText(buf)
      } catch {
        text = await sheetJsToText(buf) // 암호가 걸렸거나 특이한 xlsx
      }
    } else text = await sheetJsToText(buf)
  } else if (e === 'html' || e === 'htm' || looksLikeHtml(buf)) text = htmlToText(decodeText(buf))
  else if (['csv', 'tsv', 'txt', 'text', 'md', 'json', 'xml'].includes(e) || mime.startsWith('text/')) text = decodeText(buf)
  else throw new UnsupportedFileError(`${name}: 지원하지 않는 파일 형식이에요. PDF·사진·엑셀·한글·워드·CSV로 올려 주세요.`)

  // 끝의 탭은 남긴다(마지막 줄의 빈 칸도 열 위치를 지키도록).
  text = text.replace(/^\s+/, '').replace(/[\r\n ]+$/, '')
  if (!text) throw new UnsupportedFileError(`${name}: 파일에서 글자를 찾지 못했어요. 스캔한 문서라면 PDF나 사진으로 올려 주세요.`)
  if (text.length > MAX_CHARS) throw new UnsupportedFileError(`${name}: 내용이 너무 길어요(${text.length.toLocaleString('ko-KR')}자). 기간을 나눠서 올려 주세요.`)
  return text
}
