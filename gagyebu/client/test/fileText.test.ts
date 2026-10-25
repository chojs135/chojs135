// node --experimental-strip-types test/fileText.test.ts
// 업로드 파일 → 글자 변환(엑셀·한글·워드·CSV·HTML) 검사. HWP는 형식 명세대로 여기서 직접 만든다.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import CFB from 'cfb'
import { fileToText, UnsupportedFileError } from '../src/fileText.ts'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const load = (name: string) => {
  const b = fs.readFileSync(path.join(dir, name))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
const toAB = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer

// 엑셀 xlsx: 시트 이름, 날짜 서식 칸 → YYYY-MM-DD, 시각, 특수문자, 두 번째 시트
let t = (await fileToText('카드내역.xlsx', '', load('card.xlsx')))!
assert.match(t, /### 시트: 카드이용내역/)
assert.match(t, /이용일자\t가맹점명\t이용금액\t승인시각/)
assert.match(t, /2026-10-03\t이마트 해운대점\t52300\t2026-10-03 14:25/)
assert.match(t, /2026-10-05\t스타벅스 & 커피 <테스트>\t4500/, '사용자 지정 날짜 서식도 날짜로')
assert.match(t, /### 시트: 요약\n\t합계\t56800/, '빈 칸 위치 유지')

// 은행 "엑셀" = EUC-KR HTML 표
t = (await fileToText('거래내역.xls', 'application/vnd.ms-excel', load('statement.xls')))!
assert.match(t, /국민은행 거래내역 조회/)
assert.match(t, /거래일시\t적요\t출금액/)
assert.match(t, /2026\.10\.02\t카드대금 출금\t1,200,000/)
assert.match(t, /2026\.10\.25\t급여 입금\t/)
assert.ok(!t.includes('td{}'), 'style 제거')

// EUC-KR CSV
t = (await fileToText('bank.csv', 'text/csv', load('bank.csv')))!
assert.equal(t, '거래일,내용,금액\n2026-10-09,SKT 통신요금,89000')

// 워드
t = (await fileToText('관리비.docx', '', load('bill.docx')))!
assert.deepEqual(t.split('\n'), ['래미안 아파트 관리비 고지서', '2026년 10월분 \t납부마감 10/25', '항목\t금액', '일반관리비\t158,000', '전기료\t72,000', '합계 230,000 & 끝'])

// 한글 hwpx
t = (await fileToText('관리비.hwpx', '', load('bill.hwpx')))!
assert.deepEqual(t.split('\n'), ['관리비 부과 내역서', '수도료\t38,000', '난방비\t60,000', '납부기한 2026\t10.25', '두 번째 구역'])

// 한글 hwp (HWP 5.0): FileHeader + BodyText/SectionN, deflate 압축 레코드
function utf16(s: string) {
  const out = new Uint8Array(s.length * 2)
  for (let i = 0; i < s.length; i++) new DataView(out.buffer).setUint16(i * 2, s.charCodeAt(i), true)
  return out
}
function record(tag: number, body: Uint8Array) {
  const head = new Uint8Array(4)
  new DataView(head.buffer).setUint32(0, tag | (1 << 10) | (body.length << 20), true)
  return Buffer.concat([head, body])
}
// 컨트롤 문자: 11=표(확장, 8글자 차지), 9=탭(인라인, 8글자 차지), 13=문단 끝
const ctrl = (code: number, wide: boolean) => {
  const u = new Uint8Array(wide ? 16 : 2)
  new DataView(u.buffer).setUint16(0, code, true)
  if (wide) new DataView(u.buffer).setUint16(14, code, true)
  return u
}
function makeHwp(flags: number, paragraphs: Uint8Array[][]) {
  const header = new Uint8Array(256)
  header.set(new TextEncoder().encode('HWP Document File'))
  new DataView(header.buffer).setUint32(32, 0x05000300, true)
  new DataView(header.buffer).setUint32(36, flags, true)
  const recs = Buffer.concat(paragraphs.flatMap((parts) => [record(66, new Uint8Array(22)), record(67, Buffer.concat(parts))]))
  const body = flags & 1 ? zlib.deflateRawSync(recs) : recs
  const doc = CFB.utils.cfb_new()
  CFB.utils.cfb_add(doc, '/FileHeader', header)
  CFB.utils.cfb_add(doc, '/BodyText/Section0', body)
  CFB.utils.cfb_add(doc, '/BodyText/Section1', flags & 1 ? zlib.deflateRawSync(record(67, Buffer.concat([utf16('끝'), ctrl(13, false)]))) : record(67, utf16('끝')))
  return toAB(CFB.write(doc, { type: 'array' }) as Uint8Array)
}
const hwp = makeHwp(1, [
  [utf16('카드 이용 대금 명세서'), ctrl(13, false)],
  [ctrl(11, true), utf16('이용일'), ctrl(9, true), utf16('금액'), ctrl(13, false)],
  [utf16('10/03'), ctrl(9, true), utf16('52,300'), ctrl(13, false)],
])
t = (await fileToText('명세서.hwp', '', hwp))!
assert.deepEqual(t.split('\n'), ['카드 이용 대금 명세서', '이용일\t금액', '10/03\t52,300', '끝'])
// 압축 안 된 hwp
t = (await fileToText('a.hwp', '', makeHwp(0, [[utf16('비압축 문서')]])))!
assert.match(t, /비압축 문서/)
// 암호 / 배포용 문서는 알기 쉬운 오류
await assert.rejects(fileToText('a.hwp', '', makeHwp(1 | 2, [[utf16('x')]])), /암호/)
await assert.rejects(fileToText('a.hwp', '', makeHwp(1 | 4, [[utf16('x')]])), /배포용/)
await assert.rejects(fileToText('a.hwp', '', load('bill.docx')), UnsupportedFileError)

// PDF·사진은 Claude가 직접 읽으므로 null
assert.equal(await fileToText('a.pdf', 'application/pdf', new ArrayBuffer(4)), null)
assert.equal(await fileToText('a.HEIC', '', new ArrayBuffer(4)), null)
// 지원하지 않는 형식, 빈 파일
await assert.rejects(fileToText('a.doc', '', new ArrayBuffer(4)), /PDF로 저장/)
await assert.rejects(fileToText('a.zip', 'application/zip', new ArrayBuffer(4)), /지원하지 않는/)
await assert.rejects(fileToText('a.txt', 'text/plain', new TextEncoder().encode('   ').buffer as ArrayBuffer), /글자를 찾지 못했어요/)

console.log('✅ fileText 테스트 모두 통과')
