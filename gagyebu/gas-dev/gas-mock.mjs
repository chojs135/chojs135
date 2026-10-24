// gas/Code.js를 Node에서 실행하기 위한 Apps Script 흉내.
// 시트는 메모리 2차원 배열이고, 실제 시트처럼 "2026-10-03" 같은 문자열을 Date로 바꿔 저장한다.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const CODE = fs.readFileSync(path.join(here, '../gas/Code.js'), 'utf8')

// 스크립트 쪽의 `instanceof Date`가 통하도록 vm 컨텍스트 안의 Date로 만든다.
let ScriptDate = Date
function coerce(v) {
  // Sheets는 날짜처럼 보이는 문자열을 날짜로 저장한다.
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new ScriptDate(`${v}T00:00:00+09:00`)
  return v
}

class Range {
  constructor(sheet, row, col, nrows, ncols) {
    Object.assign(this, { sheet, row, col, nrows, ncols })
  }
  getValues() {
    const out = []
    for (let r = 0; r < this.nrows; r++) {
      const line = this.sheet.data[this.row - 1 + r] ?? []
      out.push(Array.from({ length: this.ncols }, (_, c) => line[this.col - 1 + c] ?? ''))
    }
    return out
  }
  setValues(values) {
    if (values.length !== this.nrows || values.some((v) => v.length !== this.ncols)) {
      throw new Error(`setValues 크기 불일치: ${values.length}x${values[0]?.length} → ${this.nrows}x${this.ncols}`)
    }
    values.forEach((line, r) => {
      const target = (this.sheet.data[this.row - 1 + r] ??= [])
      line.forEach((v, c) => (target[this.col - 1 + c] = coerce(v)))
    })
    return this
  }
  setValue(v) {
    return this.setValues([[v]])
  }
  clearContent() {
    for (let r = 0; r < this.nrows; r++) {
      const line = this.sheet.data[this.row - 1 + r]
      if (line) for (let c = 0; c < this.ncols; c++) line[this.col - 1 + c] = ''
    }
    // 실제 시트처럼 끝의 빈 행은 lastRow에서 빠진다.
    while (this.sheet.data.length && this.sheet.data.at(-1).every((v) => v === '' || v == null)) this.sheet.data.pop()
    return this
  }
  setFontWeight() {
    return this
  }
  setNumberFormat() {
    return this
  }
}

class Sheet {
  constructor(name) {
    this.name = name
    this.data = []
  }
  getName() {
    return this.name
  }
  getLastRow() {
    return this.data.length
  }
  getRange(a, b, c = 1, d = 1) {
    if (typeof a === 'string') return new Range(this, 1, 1, 0, 0) // 'B:B' 같은 열 서식 지정용
    if (a < 1 || b < 1 || c < 1 || d < 1) throw new Error(`잘못된 범위 ${a},${b},${c},${d}`)
    return new Range(this, a, b, c, d)
  }
  deleteRow(r) {
    if (r < 1 || r > this.data.length) throw new Error(`없는 행 삭제: ${r}`)
    this.data.splice(r - 1, 1)
  }
  setFrozenRows() {}
}

export function createGas({ persistFile } = {}) {
  const sheets = [Object.assign(new Sheet('우리집 가계부'), { data: [['ID', '날짜']] })]
  const props = {}
  if (persistFile && fs.existsSync(persistFile)) {
    const saved = JSON.parse(fs.readFileSync(persistFile, 'utf8'), (_, v) => (typeof v === 'string' && v.startsWith('__date:') ? v.slice(7) : v))
    sheets.length = 0
    for (const s of saved.sheets) sheets.push(Object.assign(new Sheet(s.name), { data: s.data, _isoDates: true }))
    Object.assign(props, saved.props)
  }
  const editors = []
  const spreadsheet = {
    getSheetByName: (n) => sheets.find((s) => s.name === n) ?? null,
    insertSheet: (n) => {
      const s = new Sheet(n)
      sheets.push(s)
      return s
    },
    getSheets: () => [...sheets],
    deleteSheet: (s) => sheets.splice(sheets.indexOf(s), 1),
    getSpreadsheetTimeZone: () => 'Asia/Seoul',
    getUrl: () => 'https://docs.google.com/spreadsheets/d/mock/edit',
    addEditor: (e) => editors.push(e),
  }
  let currentUser = ''
  const context = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    Session: { getActiveUser: () => ({ getEmail: () => currentUser }) },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => (props[k] = String(v)) }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      formatDate(d, tz, fmt) {
        const p = Object.fromEntries(
          new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
            .formatToParts(d)
            .map((x) => [x.type, x.value]),
        )
        return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second)
      },
    },
    HtmlService: {},
  })
  vm.runInContext(CODE, context, { filename: 'Code.js' })
  ScriptDate = vm.runInContext('Date', context)
  // 저장 파일에서 읽은 ISO 문자열을 스크립트 Date로 되살린다.
  for (const s of sheets) {
    if (!s._isoDates) continue
    s.data = s.data.map((line) => line.map((v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(v) ? new ScriptDate(v) : v)))
    delete s._isoDates
  }

  function save() {
    if (!persistFile) return
    const json = JSON.stringify({ sheets: sheets.map((s) => ({ name: s.name, data: s.data })), props }, (k, v) => v)
    // Date는 toJSON으로 ISO가 되므로 표시만 붙여 둔다.
    fs.writeFileSync(persistFile, json.replace(/"(\d{4}-\d{2}-\d{2}T[^"]+Z)"/g, '"__date:$1"'))
  }

  return {
    sheets,
    props,
    editors,
    /** 화면의 google.script.run.api(...) 와 같은 호출 */
    call(user, method, pathname, body) {
      currentUser = user
      const raw = context.api(method, pathname, body === undefined ? '' : JSON.stringify(body))
      save()
      return JSON.parse(raw)
    },
    callRaw(user, method, pathname, bodyJson) {
      currentUser = user
      const raw = context.api(method, pathname, bodyJson)
      save()
      return raw
    },
  }
}
