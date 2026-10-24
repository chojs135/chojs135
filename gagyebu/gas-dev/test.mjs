// node gas-dev/test.mjs — gas/Code.js의 주요 흐름을 흉내 시트 위에서 검사한다.
import assert from 'node:assert/strict'
import { createGas } from './gas-mock.mjs'

const gas = createGas()
const H = 'husband@gmail.com'
const W = 'wife@gmail.com'
const ok = (res) => {
  assert.equal(res.ok, true, res.error)
  return res.data
}
const fail = (res, status) => {
  assert.equal(res.ok, false)
  assert.equal(res.status, status, res.error)
  return res.error
}

// 1. 처음 접속: 설정 필요
assert.equal(ok(gas.call(H, 'GET', '/me')).state, 'setup')
fail(gas.call(H, 'GET', '/categories'), 403)
ok(gas.call(H, 'POST', '/setup', { name: '민호', householdName: '지수♥민호', apiKey: 'sk-ant-test' }))
fail(gas.call(W, 'POST', '/setup', { name: '지수' }), 409)
assert.ok(!gas.sheets.some((s) => s.name === '우리집 가계부'), '빈 기본 탭은 지워져야 함')

let me = ok(gas.call(H, 'GET', '/me'))
assert.equal(me.state, 'ok')
assert.equal(me.user.name, '민호')
assert.equal(me.hasApiKey, true)

// 2. 배우자는 추가 전엔 못 들어옴 → 추가 후 들어옴, 시트 공유됨
assert.equal(ok(gas.call(W, 'GET', '/me')).state, 'not_member')
fail(gas.call(W, 'GET', '/transactions'), 403)
assert.equal(ok(gas.call(H, 'POST', '/members', { name: '지수', email: 'Wife@Gmail.com' })).shared, true)
assert.deepEqual(gas.editors, ['wife@gmail.com'])
const wifeMe = ok(gas.call(W, 'GET', '/me'))
assert.equal(wifeMe.state, 'ok')
const husbandId = me.user.id
const wifeId = wifeMe.user.id

// 3. 카테고리
const cats = ok(gas.call(H, 'GET', '/categories'))
const cat = (name) => cats.find((c) => c.name === name)
assert.equal(cats.length, 16)
assert.deepEqual([...new Set(cats.map((c) => c.type))], ['income', 'saving', 'expense', 'transfer'])
assert.deepEqual(cats.filter((c) => c.type === 'expense').map((c) => c.name).slice(0, 3), ['고정지출', '식비', '용돈'], '엑셀 가계부 순서')
assert.deepEqual(cat('식비').subcategories, ['식재료', '편의점/까페', '외식', '배달'])

// 4. 거래 입력 / 조회 / 수정 / 삭제
const t1 = ok(gas.call(H, 'POST', '/transactions', { date: '2026-10-03', type: 'expense', amount: 45000, category_id: cat('식비').id, subcategory: '외식', merchant: '김밥천국 강남점', member_id: husbandId }))
ok(gas.call(W, 'POST', '/transactions', { date: '2026-10-05', type: 'expense', amount: 30000, category_id: cat('식비').id, subcategory: '배달', merchant: '배달의민족', member_id: wifeId }))
ok(gas.call(H, 'POST', '/transactions', { date: '2026-10-25', type: 'income', amount: 3500000, category_id: cat('수입').id, subcategory: '월급', merchant: '회사', member_id: husbandId }))
ok(gas.call(H, 'POST', '/transactions', { date: '2026-10-20', type: 'expense', amount: 320000, category_id: cat('고정지출').id, subcategory: '관리비', merchant: '래미안 관리비', member_id: null, fixed: true, tags: ['#확인필요', '확인필요', ' 관리비 '] }))
ok(gas.call(H, 'POST', '/transactions', { date: '2026-09-20', type: 'expense', amount: 300000, category_id: cat('고정지출').id, subcategory: '관리비', merchant: '래미안 관리비', member_id: null }))
ok(gas.call(H, 'POST', '/transactions', { date: '2026-10-15', type: 'saving', amount: 1000000, category_id: cat('저축').id, subcategory: '적금', merchant: '청년적금', fixed: true }))
ok(gas.call(H, 'POST', '/transactions', { date: '2026-10-16', type: 'transfer', amount: 800000, category_id: cat('이체').id, subcategory: '카드대금', merchant: '신한카드 대금' }))
fail(gas.call(H, 'POST', '/transactions', { date: '2026/10/01', type: 'expense', amount: 1 }), 400)
fail(gas.call(H, 'POST', '/transactions', { date: '2026-10-01', type: 'expense', amount: 0 }), 400)

let list = ok(gas.call(H, 'GET', '/transactions?month=2026-10'))
assert.equal(list.length, 6)
const fee = list.find((t) => t.merchant === '래미안 관리비')
assert.equal(fee.fixed, true)
assert.deepEqual(fee.tags, ['확인필요', '관리비'], '태그는 # 제거, 중복 제거, 공백 정리')
assert.equal(ok(gas.call(H, 'GET', '/transactions?tag=' + encodeURIComponent('확인필요'))).length, 1)
assert.equal(ok(gas.call(H, 'GET', '/transactions?month=2026-10&fixed=1')).length, 2)
assert.equal(list[0].date, '2026-10-25', '최신순, 날짜는 YYYY-MM-DD로 돌아와야 함')
assert.equal(list.find((t) => t.merchant === '래미안 관리비').member_id, null)
assert.equal(ok(gas.call(H, 'GET', `/transactions?month=2026-10&member_id=${wifeId}`)).length, 1)
assert.equal(ok(gas.call(H, 'GET', '/transactions?month=2026-10&member_id=shared')).length, 3)
assert.equal(ok(gas.call(H, 'GET', '/transactions?q=' + encodeURIComponent('김밥'))).length, 1)

// 수기 입력은 가맹점 규칙을 남긴다
let rules = ok(gas.call(H, 'GET', '/rules'))
assert.ok(rules.some((r) => r.keyword === '김밥천국' && r.category === '식비'))

// 분류를 바꾸면 규칙이 갱신된다
ok(gas.call(H, 'PUT', `/transactions/${t1.id}`, { date: '2026-10-03', type: 'expense', amount: 45000, category_id: cat('식비').id, subcategory: '배달', merchant: '김밥천국 강남점', member_id: husbandId, memo: '야식' }))
rules = ok(gas.call(H, 'GET', '/rules'))
assert.equal(rules.find((r) => r.keyword === '김밥천국').subcategory, '배달')
assert.equal(ok(gas.call(H, 'GET', '/transactions?q=' + encodeURIComponent('김밥')))[0].memo, '야식')

// 5. 예산 / 통계
ok(gas.call(H, 'PUT', '/budgets', { items: [{ category_id: cat('식비').id, amount: 50000 }, { category_id: cat('고정지출').id, amount: 400000 }] }))
let budgets = ok(gas.call(H, 'GET', '/budgets'))
assert.equal(budgets.length, 2)
ok(gas.call(H, 'PUT', '/budgets', { items: [{ category_id: cat('고정지출').id, amount: 0 }] }))
budgets = ok(gas.call(H, 'GET', '/budgets'))
assert.deepEqual(budgets, [{ category_id: cat('식비').id, amount: 50000 }])

let s = ok(gas.call(H, 'GET', '/stats?month=2026-10'))
assert.equal(s.income, 3500000)
assert.equal(s.expense, 45000 + 30000 + 320000, '저축·이체는 지출에서 빠져야 함')
assert.equal(s.saving, 1000000)
assert.equal(s.net, 3500000 - 395000 - 1000000)
assert.equal(s.savingsRate, 28.6, '저축률 = 저축/수입')
assert.equal(s.fixedExpense, 320000)
assert.deepEqual(s.bySaving.map((x) => x.name), ['저축'])
assert.deepEqual(s.byPayment.map((x) => x.method), ['미입력'])
assert.equal(s.byTag[0].tag, '확인필요')
assert.equal(s.calendar.length, 31)
assert.equal(s.calendar[2].expense, 45000)
assert.equal(s.calendar[2].noSpend, false)
assert.equal(s.calendar[0].noSpend, true)
assert.equal(s.calendar[30].future, true, '오늘(2026-10-24) 이후는 무지출로 세지 않음')
assert.equal(s.noSpendDays, 24 - 3)
assert.equal(s.prev.expense, 300000)
assert.equal(s.byCategory[0].name, '고정지출')
assert.equal(s.byCategory.find((c) => c.name === '식비').budget, 50000)
assert.ok(s.insights.some((i) => i.text.includes('식비 예산')))
assert.ok(s.insights.some((i) => i.level === 'good' && i.text.includes('무지출')))
assert.equal(s.trend.length, 12)
assert.equal(s.trend[11].month, '2026-10')
assert.equal(s.trend[0].month, '2025-11')
assert.deepEqual(s.byMember.map((m) => m.name).sort(), ['공동', '민호', '지수'])

s = ok(gas.call(W, 'GET', `/stats?month=2026-10&member_id=${wifeId}`))
assert.equal(s.expense, 30000)
assert.equal(s.income, 0)
assert.equal(s.byCategory[0].budget, null, '사람별 보기에서는 예산 숨김')
s = ok(gas.call(H, 'GET', '/stats?month=2026-10&member_id=shared'))
assert.equal(s.expense, 320000)

// 구글 시트 보고서 탭 (엑셀 가계부 구성)
const names = gas.sheets.map((x) => x.name)
assert.deepEqual(names.slice(0, 13), ['통합시트', '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'], '보고서 탭이 앞에')
assert.deepEqual(names.slice(13, 22), ['결제일 관리', '자산관리', '예비비', '대출 관리', '카드 관리', '통장관리', '이벤트 관리', '2026 거래내역', '설정'], '결제일 관리 → 관리 탭 → 연도별 거래내역 → 설정')
assert.ok(!names.includes('거래내역'), '하나짜리 거래내역 탭은 없음')
const y26 = gas.sheets.find((x) => x.name === '2026 거래내역')
assert.deepEqual(y26.data[0].slice(0, 10), ['No', '날짜', '구분', '내용', '금액', '대분류', '소분류', '지출 방법', '태그', '사용자'], '엑셀 가계부 열 순서')
const dates = y26.data.slice(1).map((r) => r[1].getTime())
assert.deepEqual(dates, [...dates].sort((a, b) => a - b), '날짜순 정렬')
const settingsTab = gas.sheets.find((x) => x.name === '설정')
assert.ok(settingsTab.find('대분류 / 소분류') && settingsTab.find('지출 방법') && settingsTab.find('월 예산'))
const [cr] = settingsTab.find('🍚 식비')
assert.deepEqual(settingsTab.data[cr - 1].slice(1, 7), ['지출', '🍚 식비', '식재료', '편의점/까페', '외식', '배달'])
for (const tab of ['통합시트', '설정', ...Array.from({ length: 12 }, (_, i) => `${i + 1}월`)]) {
  const sh = gas.sheets.find((x) => x.name === tab)
  assert.ok(sh.data.every((r) => (r ?? []).every((v) => !(v instanceof Object && typeof v.getTime === 'function'))), `${tab}: 날짜 값이 들어가면 숫자로 보임`)
}
assert.ok(settingsTab.data.every((r) => (r ?? []).every((v) => typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) && (r ?? []).every((v) => !(v instanceof Object && typeof v.getTime === 'function'))), '보고서 탭에 날짜 값(숫자로 보임)이 없어야 함')
assert.ok(!names.includes('월별요약'))
const annual = gas.sheets.find((x) => x.name === '통합시트')
assert.equal(annual.getCharts().length, 1, '월별 차트')
// 총 수입·총 저축·총 지출·저축률·남은 돈
const [kr, kc] = annual.find('총 수입')
assert.deepEqual([0, 1, 2, 3, 4].map((i) => annual.cell(kr + 1, kc + i)), [3500000, 1000000, 695000, '28.6%', 3500000 - 1000000 - 695000])
// 수입 월별 상세표: 사람별로 나뉜 월급
const [ir] = annual.find('수입 월별 상세표')
assert.deepEqual(annual.data[ir].slice(1, 6), ['대분류', '소분류', '합계', '1월', '2월'])
const wageRow = annual.data.slice(ir).find((r) => r[2] === '월급(민호)')
assert.equal(wageRow[3], 3500000)
assert.equal(wageRow[3 + 10], 3500000, '10월 칸')
// 지출 월별 상세표: 고정지출 > 관리비, 대분류 합계, 총 지출
const [er] = annual.find('지출 월별 상세표')
const exp = annual.data.slice(er)
const rent = exp.find((r) => r[1] === '고정지출' && r[2] === '주거비')
assert.ok(rent, '설정된 소분류는 금액이 없어도 줄이 있음')
const mgmt = exp.find((r) => r[2] === '관리비')
assert.equal(mgmt[3], 620000)
assert.equal(mgmt[3 + 9], 300000)
assert.equal(mgmt[16], 310000, '평균(기록 있는 2개월)')
assert.equal(exp.find((r) => r[1] === '고정지출 합계')[3], 620000)
assert.equal(exp.find((r) => r[1] === '총 지출')[3], 695000)

// 10월 탭: 이달의 정리, 고정지출 내역, 전체 내역, 무지출 달력
const oct = gas.sheets.find((x) => x.name === '10월')
assert.equal(oct.cell(...oct.find('2026년 10월 가계부')), '2026년 10월 가계부')
const [sr, sc] = oct.find('총 지출')
assert.equal(oct.cell(sr, sc + 1), 395000)
assert.equal(oct.cell(sr + 1, sc + 1), 320000, '고정지출')
assert.equal(oct.cell(sr + 2, sc + 1), 75000, '비고정지출')
const [fr, fc] = oct.find('이달의 고정지출 내역')
assert.deepEqual(oct.data[fr].slice(fc - 1, fc + 3), ['No', '날짜', '내용', '금액'])
assert.equal(oct.cell(fr + 2, fc + 2), '래미안 관리비')
const [ar, ac] = oct.find('이달의 수입 · 저축 · 지출 내역')
assert.equal(oct.cell(ar + 2, ac + 1), '10.03(토)')
assert.equal(oct.cell(ar + 2, ac + 3), '김밥천국 강남점')
assert.ok(oct.find('이달의 무지출 Day 🌱 21일'))
// 주간별: 10/3(토)은 1주, 10/5(월)은 2주
const weekly = oct.data.slice(oct.find('대분류별 지출 (주간별)')[0])
const foodWeek = weekly.find((r) => r[1] === '식비 합계')
assert.deepEqual(foodWeek.slice(3, 6), [75000, 45000, 30000])
// 예산(목표) 관리: 식비 예산 50,000 중 75,000 사용
const [br, bc] = oct.find('예산(목표) 관리')
assert.deepEqual(oct.data[br + 1].slice(bc - 1, bc + 4), ['식비', 50000, 75000, '150%', -25000])
// 사람별 이름은 소분류에만: 수입은 월급(민호)
const sep = gas.sheets.find((x) => x.name === '9월')
assert.equal(sep.cell(...sep.find('총 지출')), '총 지출')

// 6. 업로드: 분석 컨텍스트 → 결과 정리 → 저장
// 연간 리포트
const yr = ok(gas.call(H, 'GET', '/annual?year=2026'))
assert.equal(yr.activeMonths, 2)
assert.equal(yr.expense, 695000)
assert.equal(yr.totals[9].saving, 1000000)
const feeRow = yr.expenseTable.find((r) => r.name === '고정지출')
assert.equal(feeRow.months[8], 300000)
assert.equal(feeRow.months[9], 320000)
assert.equal(feeRow.total, 620000)
assert.equal(feeRow.average, 310000)
assert.equal(yr.expenseTable[0].name, '고정지출', '카테고리 순서대로')
assert.deepEqual(yr.savingTable.map((r) => r.name), ['저축'])

const actx = ok(gas.call(W, 'GET', '/analysis-context'))
assert.equal(actx.apiKey, 'sk-ant-test')
assert.equal(actx.model, 'claude-haiku-5-5', '기본은 저렴한 Haiku')
assert.ok(actx.system.includes('"김밥천국" → 식비 / 배달'), '가맹점 규칙이 프롬프트에 들어가야 함')
assert.ok(actx.schema.properties.transactions.items.properties.category.enum.includes('고정지출'))
assert.deepEqual(actx.schema.properties.transactions.items.properties.type.enum, ['expense', 'income', 'saving', 'transfer'])
assert.ok(actx.system.includes('저축 카테고리:\n- 저축: 적금'))

const extraction = {
  document_type: '카드 이용내역',
  summary: '10월 카드 3건',
  transactions: [
    { date: '2026-10-07', type: 'expense', amount: 12000, merchant: '김밥천국 역삼점', description: '분식', category: '식비', subcategory: '외식', payment_method: '신한카드', confidence: 0.9, note: '' },
    { date: '2026-10-05', type: 'expense', amount: -30000, merchant: '배달의민족', description: '배달', category: '식비', subcategory: '배달', payment_method: '신한카드', confidence: 0.95, note: '' },
    { date: '2026-10-08', type: 'expense', amount: 18000, merchant: '넷플릭스', description: '구독', category: '문화생활', subcategory: '없는세부', payment_method: '', fixed: true, confidence: 0.5, note: '흐림' },
  ],
}
const prepared = ok(gas.call(W, 'POST', '/uploads/prepare', { extraction, member_id: wifeId }))
const [a, b, c] = prepared.items
assert.equal(a.rule_applied, true)
assert.equal(a.subcategory, '배달', '규칙(배달)이 AI 결과(외식)보다 우선')
assert.equal(b.amount, 30000, '음수 금액은 양수로')
assert.equal(b.duplicate.level, 'strong')
assert.ok(b.duplicate.reason.includes('배달의민족'))
assert.equal(b.include, false, '중복 의심은 기본 제외')
assert.equal(c.subcategory, '', '없는 세부항목은 비움')
assert.equal(c.member_id, wifeId)
assert.equal(c.fixed, true)
assert.equal(a.fixed, false)

c.category_id = cat('문화생활').id
c.subcategory = 'OTT' // 사용자가 고침 → 규칙 학습
const committed = ok(gas.call(W, 'POST', '/uploads/commit', { items: prepared.items, filenames: ['카드.pdf'], document_type: prepared.document_type, summary: prepared.summary }))
assert.equal(committed.saved, 2)
rules = ok(gas.call(H, 'GET', '/rules'))
assert.ok(rules.some((r) => r.keyword === '넷플릭스' && r.subcategory === 'OTT'))
const uploads = ok(gas.call(H, 'GET', '/uploads'))
assert.equal(uploads[0].tx_count, 2)
assert.equal(uploads[0].created_by_name, '지수')
list = ok(gas.call(H, 'GET', '/transactions?month=2026-10'))
const auto = list.filter((t) => t.source === 'upload')
assert.equal(auto.length, 2)
assert.ok(auto.every((t) => t.created_by_name === '지수' && t.member_id === wifeId))

// 7. 카테고리 이름 변경은 거래/규칙/예산에도 반영, 삭제하면 거래는 미분류
ok(gas.call(H, 'PUT', `/categories/${cat('식비').id}`, { name: '먹거리', subcategories: ['장보기', '외식', '배달', '카페/간식', '술'] }))
list = ok(gas.call(H, 'GET', '/transactions?q=' + encodeURIComponent('김밥')))
assert.ok(list.every((t) => t.category_id === cat('식비').id), '이름이 바뀌어도 같은 카테고리로 연결')
assert.ok(ok(gas.call(H, 'GET', '/rules')).some((r) => r.keyword === '김밥천국' && r.category === '먹거리'))
assert.equal(ok(gas.call(H, 'GET', '/budgets'))[0].category_id, cat('식비').id)
const newCat = ok(gas.call(H, 'POST', '/categories', { type: 'expense', name: '술값' }))
fail(gas.call(H, 'POST', '/categories', { type: 'expense', name: '술값' }), 409)
ok(gas.call(H, 'DELETE', `/categories/${cat('문화생활').id}`))
const netflix = ok(gas.call(H, 'GET', '/transactions?q=' + encodeURIComponent('넷플릭스')))[0]
assert.equal(netflix.category_id, null)
assert.ok(!ok(gas.call(H, 'GET', '/rules')).some((r) => r.keyword === '넷플릭스'))
assert.ok(ok(gas.call(H, 'GET', '/categories')).some((x) => x.id === newCat.id))

// 8. 삭제, 규칙 삭제
ok(gas.call(H, 'DELETE', `/transactions/${netflix.id}`))
assert.equal(ok(gas.call(H, 'GET', '/transactions?q=' + encodeURIComponent('넷플릭스'))).length, 0)
ok(gas.call(H, 'DELETE', `/rules/${encodeURIComponent('김밥천국')}`))
assert.ok(!ok(gas.call(H, 'GET', '/rules')).some((r) => r.keyword === '김밥천국'))

// 9. 설정
ok(gas.call(H, 'PUT', '/settings', { apiKey: ' "sk-ant-api03-abcdefghijklmnopqrstuvwxyz\n" ' }))
assert.equal(gas.props.ANTHROPIC_API_KEY, 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz', '따옴표·공백·줄바꿈 제거')
assert.equal(ok(gas.call(H, 'GET', '/me')).apiKeyHint, 'sk-ant-api03…wxyz (39자)')
ok(gas.call(H, 'PUT', '/settings', { model: 'claude-sonnet-5-5' }))
assert.equal(ok(gas.call(W, 'GET', '/analysis-context')).model, 'claude-sonnet-5-5')
assert.equal(ok(gas.call(W, 'GET', '/me')).model, 'claude-sonnet-5-5')
fail(gas.call(H, 'PUT', '/settings', { model: 'gpt-4' }), 400)
fail(gas.call('stranger@gmail.com', 'GET', '/analysis-context'), 403)
fail(gas.call('', 'GET', '/me'), 401)
fail(gas.call(H, 'GET', '/nope'), 404)

// 9-1. 시트 권한을 빼고 허용한 경우(부분 동의): 권한 페이지와 다시 허용 주소
assert.equal(gas.doGet().file, 'Index')
gas.authState.missing = true
assert.ok(gas.doGet().html.includes('권한 허용하기'))
const denied = gas.call(W, 'GET', '/me')
assert.equal(denied.ok, false)
assert.equal(denied.status, 401)
assert.equal(denied.authUrl, 'https://script.google.com/macros/auth?mock')
gas.authState.missing = false

// 10. 중복 찾기: 영수증 ↔ 카드 내역
{
  const g = createGas()
  const U = 'u@gmail.com'
  ok(g.call(U, 'POST', '/setup', { name: '나', apiKey: 'sk-ant-test' }))
  const cs = ok(g.call(U, 'GET', '/categories'))
  const food = cs.find((c) => c.name === '식비').id
  const house = cs.find((c) => c.name === '고정지출').id
  const tx = (o) => ({ type: 'expense', category: '식비', subcategory: '', description: '', payment_method: '', fixed: false, confidence: 0.9, note: '', source_file: '', ...o })
  const prep = (transactions) => ok(g.call(U, 'POST', '/uploads/prepare', { extraction: { document_type: 'x', summary: '', transactions } })).items
  const commit = (items) => ok(g.call(U, 'POST', '/uploads/commit', { items, filenames: ['f'] }))

  // 영수증 사진 먼저 저장 (결제수단 모름)
  commit(prep([tx({ date: '2026-08-15', amount: 52300, merchant: '이마트 해운대점' })]))
  // 관리비 고지서를 항목별로 저장
  commit(prep([
    tx({ date: '2026-08-25', amount: 170000, merchant: '래미안 일반관리비', category: '고정지출' }),
    tx({ date: '2026-08-25', amount: 72000, merchant: '래미안 전기료', category: '고정지출' }),
    tx({ date: '2026-08-25', amount: 38000, merchant: '래미안 수도료', category: '고정지출' }),
  ]))
  ok(g.call(U, 'POST', '/transactions', { date: '2026-08-16', type: 'expense', amount: 4500, category_id: food, merchant: '스타벅스' }))

  // 카드 내역 PDF: 날짜 하루 차이 + 다른 표기, 관리비 합계 한 줄, 같은 금액 다른 가맹점, 진짜 새 결제
  const card = prep([
    tx({ date: '2026-08-16', amount: 52300, merchant: '이마트(주)해운대', payment_method: '삼성카드' }),
    tx({ date: '2026-08-27', amount: 280000, merchant: '래미안아파트관리비', category: '고정지출', payment_method: '삼성카드' }),
    tx({ date: '2026-08-18', amount: 4500, merchant: '메가커피', payment_method: '삼성카드' }),
    tx({ date: '2026-08-20', amount: 15000, merchant: '김밥천국', payment_method: '삼성카드' }),
  ])
  assert.equal(card[0].duplicate.level, 'strong', '하루 차이 + 비슷한 가맹점명 → 확실한 중복')
  assert.equal(card[0].include, false)
  assert.ok(card[0].duplicate.reason.includes('1일 차이'))
  assert.equal(card[1].duplicate.level, 'strong', '관리비 항목 합계와 같은 한 줄')
  assert.equal(card[1].include, false)
  assert.ok(card[1].duplicate.reason.includes('합계'))
  assert.equal(card[2].duplicate.level, 'weak', '같은 금액이지만 다른 가게 → 표시만')
  assert.equal(card[2].include, true)
  assert.equal(card[3].duplicate, null)

  // 건너뛴 영수증 내역에 카드 결제수단이 채워진다
  const r = commit(card)
  assert.equal(r.saved, 2)
  assert.equal(r.filled, 1)
  const emart = ok(g.call(U, 'GET', '/transactions?q=' + encodeURIComponent('이마트')))
  assert.equal(emart.length, 1)
  assert.equal(emart[0].payment_method, '삼성카드')

  // 같은 결제가 1:1로만 짝지어진다: 같은 날 같은 금액 두 번 결제했는데 하나만 기록돼 있었으면 하나는 새 결제
  ok(g.call(U, 'POST', '/transactions', { date: '2026-09-01', type: 'expense', amount: 12000, category_id: food, merchant: '편의점' }))
  const twice = prep([
    tx({ date: '2026-09-01', amount: 12000, merchant: '편의점' }),
    tx({ date: '2026-09-01', amount: 12000, merchant: '편의점' }),
  ])
  assert.equal(twice[0].duplicate.level, 'strong')
  assert.equal(twice[1].duplicate, null)

  // 반대 순서: 카드 내역(합계 한 줄)을 먼저, 고지서(항목별)를 나중에
  ok(g.call(U, 'POST', '/transactions', { date: '2026-09-26', type: 'expense', amount: 300000, category_id: house, merchant: '아파트관리비 카드결제' }))
  const bill = prep([
    tx({ date: '2026-09-25', amount: 200000, merchant: '일반관리비', category: '고정지출' }),
    tx({ date: '2026-09-25', amount: 100000, merchant: '난방비', category: '고정지출' }),
  ])
  assert.ok(bill.every((i) => i.duplicate?.level === 'weak' && i.include), '합계가 같으면 알려 주되 선택은 사람에게')

  // 한꺼번에 올린 영수증 + 카드 내역
  const batch = prep([
    tx({ date: '2026-09-10', amount: 33000, merchant: '교보문고', source_file: '영수증.jpg' }),
    tx({ date: '2026-09-11', amount: 33000, merchant: '교보문고 광화문', source_file: '카드내역.pdf' }),
    tx({ date: '2026-09-11', amount: 7000, merchant: '교보문고 광화문', source_file: '카드내역.pdf' }),
  ])
  assert.equal(batch[0].duplicate, null)
  assert.equal(batch[1].duplicate.level, 'strong')
  assert.ok(batch[1].duplicate.reason.includes('영수증.jpg'))
  assert.equal(batch[2].duplicate, null)

  assert.ok(ok(g.call(U, 'GET', '/analysis-context')).system.includes('한 번만 기록'))
}

// 11. 이전 기본 분류를 쓰던 가계부 → 엑셀 기준 분류로 자동 이전
{
  const g = createGas()
  const U = 'old@gmail.com'
  ok(g.call(U, 'POST', '/setup', { name: '민호' }))
  const sheet = (n) => g.sheets.find((x) => x.name === n)
  // 이전 버전 상태를 만든다
  delete g.props.CATEGORY_PRESET
  const catHeader = sheet('카테고리').data[0]
  sheet('카테고리').data = [
    catHeader,
    [1, '지출', '식비', '🍚', '#f97316', '장보기, 외식, 배달, 카페/간식, 편의점', 1],
    [2, '지출', '주거/관리비', '🏠', '#0ea5e9', '관리비, 전기, 수도', 2],
    [3, '지출', '통신/구독', '📱', '#8b5cf6', '휴대폰, 구독서비스', 3],
    [4, '수입', '급여', '💼', '#16a34a', '월급, 상여금', 4],
    [5, '저축', '투자', '📈', '#7c3aed', '주식/ETF', 5],
    [6, '지출', '골프', '⛳', '#000000', '라운딩', 6],
  ]
  // 예전 버전처럼 '거래내역' 탭 하나에 옛 열 순서로 들어 있던 상태
  const txHeader = ['ID', '날짜', '구분', '금액', '카테고리', '세부항목', '가맹점', '내용', '결제수단', '사용자', '고정', '태그', '메모', '입력방식', '업로드ID', '입력자', '입력일시', '수정일시']
  const row = (o) => txHeader.map((h) => o[h] ?? '')
  const Legacy = sheet('카테고리').constructor
  g.sheets.push(new Legacy('거래내역'))
  sheet('거래내역').data = [
    txHeader,
    row({ ID: 1, 날짜: '2026-10-02', 구분: '지출', 금액: 50000, 카테고리: '식비', 세부항목: '장보기', 가맹점: '이마트', 사용자: '민호' }),
    row({ ID: 2, 날짜: '2026-10-09', 구분: '지출', 금액: 89000, 카테고리: '통신/구독', 세부항목: '휴대폰', 가맹점: 'SKT', 사용자: '공동' }),
    row({ ID: 3, 날짜: '2026-10-20', 구분: '지출', 금액: 72000, 카테고리: '주거/관리비', 세부항목: '전기', 가맹점: '전기료', 사용자: '공동' }),
    row({ ID: 4, 날짜: '2026-10-25', 구분: '수입', 금액: 3000000, 카테고리: '급여', 세부항목: '월급', 가맹점: '회사', 사용자: '민호' }),
    row({ ID: 5, 날짜: '2026-10-26', 구분: '저축', 금액: 300000, 카테고리: '투자', 세부항목: '주식/ETF', 가맹점: '키움', 사용자: '민호' }),
    row({ ID: 6, 날짜: '2026-10-27', 구분: '지출', 금액: 150000, 카테고리: '골프', 세부항목: '라운딩', 가맹점: '골프장', 사용자: '민호' }),
    row({ ID: 7, 날짜: '2025-12-24', 구분: '지출', 금액: 80000, 카테고리: '식비', 세부항목: '외식', 가맹점: '작년 크리스마스', 사용자: '공동', 결제수단: '현대카드', 메모: '메모 유지' }),
  ]
  sheet('예산').data = [sheet('예산').data[0], ['주거/관리비', 300000], ['통신/구독', 100000], ['식비', 500000]]
  sheet('자동분류규칙').data = [sheet('자동분류규칙').data[0], ['SKT', '지출', '통신/구독', '휴대폰', '']]
  g.sheets.push(Object.assign(sheet('예산').constructor ? new (sheet('예산').constructor)('월별요약') : {}, {}))

  const list = ok(g.call(U, 'GET', '/transactions'))
  const by = (m) => list.find((t) => t.merchant === m)
  const cats = ok(g.call(U, 'GET', '/categories'))
  const nameOf = (id) => cats.find((c) => c.id === id)?.name
  assert.equal(g.props.CATEGORY_PRESET, 'excel-v1')
  assert.deepEqual([nameOf(by('이마트').category_id), by('이마트').subcategory], ['식비', '식재료'])
  assert.deepEqual([nameOf(by('SKT').category_id), by('SKT').subcategory, by('SKT').fixed], ['고정지출', '통신비', true])
  assert.deepEqual([nameOf(by('전기료').category_id), by('전기료').subcategory], ['고정지출', '공과금'])
  assert.deepEqual([nameOf(by('회사').category_id), by('회사').subcategory], ['수입', '월급'])
  assert.deepEqual([nameOf(by('키움').category_id), by('키움').subcategory], ['저축', '주식'])
  assert.equal(nameOf(by('골프장').category_id), '골프', '직접 만든 카테고리는 그대로')
  // 연도별 탭으로 옮겨짐
  assert.ok(!sheet('거래내역'), '옛 탭은 지워짐')
  assert.equal(sheet('2026 거래내역').data.length - 1, 6)
  const x25 = sheet('2025 거래내역').data
  assert.equal(x25.length - 1, 1)
  assert.deepEqual([x25[1][0], x25[1][3], x25[1][4], x25[1][5], x25[1][6], x25[1][7], x25[1][11]], [7, '작년 크리스마스', 80000, '식비', '외식', '현대카드', '메모 유지'])
  assert.equal(list.length, 7)
  // 연도를 바꿔 고치면 그 연도 탭으로 옮겨감
  const xmas = by('작년 크리스마스')
  ok(g.call(U, 'PUT', `/transactions/${xmas.id}`, { ...xmas, date: '2026-01-02' }))
  assert.equal(sheet('2025 거래내역').data.length - 1, 0)
  assert.ok(sheet('2026 거래내역').data.some((r) => r[3] === '작년 크리스마스'))
  assert.ok(!cats.some((c) => c.name === '주거/관리비' || c.name === '통신/구독'))
  const budgets = ok(g.call(U, 'GET', '/budgets'))
  assert.equal(budgets.find((b) => nameOf(b.category_id) === '고정지출').amount, 400000, '합쳐진 예산')
  assert.equal(ok(g.call(U, 'GET', '/rules'))[0].category, '고정지출')
  assert.ok(!g.sheets.some((x) => x.name === '월별요약'))
  assert.ok(sheet('10월').find('이달의 고정지출 내역'))
  const order = g.sheets.map((x) => x.name)
  assert.ok(order.indexOf('2025 거래내역') > order.indexOf('이벤트 관리') && order.indexOf('2025 거래내역') < order.indexOf('설정'), '옮긴 뒤 탭 순서 정리')
  // 두 번째 호출에서는 다시 옮기지 않는다
  ok(g.call(U, 'GET', '/transactions'))
  assert.equal(ok(g.call(U, 'GET', '/categories')).length, cats.length)
}

// 12. 정기결제 (결제일 관리) — 오늘은 2026-10-24
{
  const g = createGas()
  const U = 'r@gmail.com'
  ok(g.call(U, 'POST', '/setup', { name: '민호' }))
  const cs = ok(g.call(U, 'GET', '/categories'))
  const cid = (n) => cs.find((c) => c.name === n).id
  const me = ok(g.call(U, 'GET', '/me')).user.id
  const base = { type: 'expense', category_id: cid('고정지출'), payment_method: '네이버페이', member_id: null, auto: true }

  // 8월부터 매달 3일 넷플릭스 → 8·9·10월이 바로 기록됨
  const nf = ok(g.call(U, 'POST', '/recurring', { ...base, name: '넷플릭스', amount: 17000, day: 3, subcategory: '구독료', start: '2026-08' }))
  let list = ok(g.call(U, 'GET', '/transactions?q=' + encodeURIComponent('넷플릭스')))
  assert.deepEqual(list.map((t) => t.date).sort(), ['2026-08-03', '2026-09-03', '2026-10-03'])
  assert.ok(list.every((t) => t.source === 'recurring' && t.fixed && t.recurring_id === nf.id && t.payment_method === '네이버페이'))
  // 이미 이번 달에 직접 입력해 둔 결제를 등록하면 또 넣지 않는다
  ok(g.call(U, 'POST', '/transactions', { date: '2026-10-09', type: 'expense', amount: 89000, category_id: cid('고정지출'), subcategory: '통신비', merchant: 'SKT 통신요금' }))
  ok(g.call(U, 'POST', '/recurring', { ...base, name: 'SKT', amount: 89000, day: 9, subcategory: '통신비' }))
  assert.equal(ok(g.call(U, 'GET', '/transactions?month=2026-10&q=SKT')).length, 1, '중복 자동 기록 없음')
  assert.equal(g.sheets.find((x) => x.name === '결제일 관리').data.find((r) => r[1] === 'SKT')[12], '2026-10', '그 달은 처리한 것으로')
  // 이번 달 28일 월세는 아직 기록 안 됨, 31일 결제는 말일로
  ok(g.call(U, 'POST', '/recurring', { ...base, name: '월세', amount: 500000, day: 28, subcategory: '주거비', member_id: me }))
  assert.equal(ok(g.call(U, 'GET', '/transactions?q=' + encodeURIComponent('월세'))).length, 0)
  ok(g.call(U, 'POST', '/recurring', { ...base, name: '적금', type: 'saving', category_id: cid('저축'), subcategory: '적금', amount: 300000, day: 31, start: '2026-09' }))
  assert.deepEqual(ok(g.call(U, 'GET', '/transactions?q=' + encodeURIComponent('적금'))).map((t) => t.date), ['2026-09-30'])
  // 금액이 달라지는 관리비: 자동 기록하지 않고 예정으로만
  ok(g.call(U, 'POST', '/recurring', { ...base, name: '아파트 관리비', amount: 300000, day: 25, subcategory: '관리비', auto: false }))
  fail(g.call(U, 'POST', '/recurring', { ...base, name: '빈 금액', amount: 0, day: 5 }), 400)

  let st = ok(g.call(U, 'GET', '/recurring?month=2026-10')).status
  const byName = (n) => st.items.find((i) => i.name === n)
  assert.equal(byName('넷플릭스').status, 'paid')
  assert.equal(byName('월세').status, 'upcoming')
  assert.equal(byName('아파트 관리비').status, 'upcoming')
  assert.equal(byName('적금').status, 'upcoming', '10/31')
  assert.deepEqual(st.items.map((i) => i.day), [3, 9, 25, 28, 31], '결제일 순')
  assert.equal(st.items.find((i) => i.name === 'SKT').status, 'paid')
  assert.equal(st.paid, 17000 + 89000)
  assert.equal(st.remaining, 500000 + 300000 + 300000)
  // 관리비 고지서가 올라오면 '나감'
  ok(g.call(U, 'POST', '/transactions', { date: '2026-10-25', type: 'expense', amount: 312000, category_id: cid('고정지출'), subcategory: '관리비', merchant: '래미안 관리비' }))
  st = ok(g.call(U, 'GET', '/recurring?month=2026-10')).status
  assert.equal(byName('아파트 관리비').status, 'paid')
  assert.equal(byName('아파트 관리비').paid_amount, 312000)

  // 자동 기록을 지워도 다시 넣지 않는다
  const sep = list.find((t) => t.date === '2026-09-03')
  ok(g.call(U, 'DELETE', `/transactions/${sep.id}`))
  g.props.RECURRING_CHECKED = ''
  ok(g.call(U, 'GET', '/me'))
  ok(g.call(U, 'GET', '/categories'))
  assert.equal(ok(g.call(U, 'GET', '/transactions?q=' + encodeURIComponent('넷플릭스'))).length, 2)

  // 카드 내역에 같은 넷플릭스 결제가 있으면 중복으로 빠지고 결제수단은 유지
  const prepared = ok(g.call(U, 'POST', '/uploads/prepare', { extraction: { document_type: '카드', summary: '', transactions: [
    { date: '2026-10-04', type: 'expense', amount: 17000, merchant: 'NETFLIX.COM 넷플릭스', description: '', category: '고정지출', subcategory: '구독료', payment_method: '삼성카드', fixed: true, source_file: 'c.pdf', confidence: 0.9, note: '' },
  ] } })).items
  assert.equal(prepared[0].duplicate.level, 'strong')

  // 시트: 결제일 관리 탭이 12월 뒤에
  const names = g.sheets.map((x) => x.name)
  assert.equal(names[13], '결제일 관리')
  const rec = g.sheets.find((x) => x.name === '결제일 관리')
  assert.deepEqual(rec.data[0].slice(0, 5), ['ID', '내용', '구분', '금액', '결제일'])
  assert.equal(rec.data.find((r) => r[1] === '넷플릭스')[12], '2026-10', '마지막 기록')
  // 10월 탭 고정지출 내역에 자동 기록이 보임
  const oct = g.sheets.find((x) => x.name === '10월')
  const [fr, fc] = oct.find('이달의 고정지출 내역')
  assert.ok(oct.data.slice(fr).some((r) => r[fc + 1] === '넷플릭스 · 정기결제'))

  // 시작 연·월을 작년으로: 그 달부터 지금까지 채움, 끝나는 달 이후는 안 넣음
  const ins = ok(g.call(U, 'POST', '/recurring', { ...base, name: '운전자보험', amount: 25000, day: 5, subcategory: '보험료', start: '2025-11', end: '2026-08' }))
  let ins_ = ok(g.call(U, 'GET', '/transactions?q=' + encodeURIComponent('운전자보험'))).map((t) => t.date).sort()
  assert.equal(ins_.length, 10)
  assert.equal(ins_[0], '2025-11-05')
  assert.equal(ins_.at(-1), '2026-08-05')
  // 시작을 더 앞으로 당기면 빠진 달만 채움(중복 없음)
  ok(g.call(U, 'PUT', `/recurring/${ins.id}`, { ...base, name: '운전자보험', amount: 25000, day: 5, subcategory: '보험료', start: '2025-09', end: '2026-08' }))
  ins_ = ok(g.call(U, 'GET', '/transactions?q=' + encodeURIComponent('운전자보험'))).map((t) => t.date).sort()
  assert.equal(ins_.length, 12)
  assert.equal(ins_[0], '2025-09-05')
  assert.equal(new Set(ins_).size, 12)
  fail(g.call(U, 'POST', '/recurring', { ...base, name: 'x', amount: 1, day: 1, start: '2026-05', end: '2026-01' }), 400)
  const insItem = ok(g.call(U, 'GET', '/recurring?month=2026-08')).status.items.find((i) => i.name === '운전자보험')
  assert.deepEqual([insItem.start, insItem.end], ['2025-09', '2026-08'])
  assert.ok(!ok(g.call(U, 'GET', '/recurring?month=2026-10')).status.items.some((i) => i.name === '운전자보험'), '끝난 정기결제는 이번 달 목록에 없음')

  // 수정·삭제
  ok(g.call(U, 'PUT', `/recurring/${nf.id}`, { ...base, name: '넷플릭스', amount: 13500, day: 3, subcategory: '구독료' }))
  assert.equal(ok(g.call(U, 'GET', '/recurring')).status.items.find((i) => i.name === '넷플릭스').amount, 13500)
  ok(g.call(U, 'DELETE', `/recurring/${nf.id}`))
  assert.ok(!ok(g.call(U, 'GET', '/recurring')).status.items.some((i) => i.name === '넷플릭스'))
  assert.equal(ok(g.call(U, 'GET', '/transactions?q=' + encodeURIComponent('넷플릭스'))).length, 2, '이미 기록된 내역은 남김')

  // 추천: 두 달 이상 반복된 고정지출
  ok(g.call(U, 'POST', '/transactions', { date: '2026-08-09', type: 'expense', amount: 89000, category_id: cid('고정지출'), subcategory: '통신비', merchant: 'SKT 통신요금' }))
  ok(g.call(U, 'POST', '/transactions', { date: '2026-09-09', type: 'expense', amount: 89000, category_id: cid('고정지출'), subcategory: '통신비', merchant: 'SKT 통신요금' }))
  ok(g.call(U, 'POST', '/transactions', { date: '2026-09-15', type: 'expense', amount: 50000, category_id: cid('식비'), subcategory: '외식', merchant: '한 번만' }))
  ok(g.call(U, 'POST', '/transactions', { date: '2026-08-11', type: 'expense', amount: 33000, category_id: cid('고정지출'), subcategory: '통신비', merchant: '유플러스 인터넷' }))
  ok(g.call(U, 'POST', '/transactions', { date: '2026-09-11', type: 'expense', amount: 33000, category_id: cid('고정지출'), subcategory: '통신비', merchant: '유플러스 인터넷' }))
  const sug = ok(g.call(U, 'GET', '/recurring')).suggestions
  assert.deepEqual(sug.map((x) => [x.name, x.day, x.amount, x.auto]), [['유플러스 인터넷', 11, 33000, true]], 'SKT는 이미 등록돼 있어서 추천하지 않음')
}

// 13. 관리 탭 (자산·예비비·대출·카드·통장·이벤트) — 오늘은 2026-10-24
{
  const g = createGas()
  const U = 'm@gmail.com'
  ok(g.call(U, 'POST', '/setup', { name: '민호' }))
  const cs = ok(g.call(U, 'GET', '/categories'))
  const cid = (n) => cs.find((c) => c.name === n).id
  assert.deepEqual(ok(g.call(U, 'GET', '/ledgers')).map((l) => l.name), ['자산관리', '예비비', '대출 관리', '카드 관리', '통장관리', '이벤트 관리'])
  const names = g.sheets.map((x) => x.name)
  assert.deepEqual(names.slice(13, 20), ['결제일 관리', '자산관리', '예비비', '대출 관리', '카드 관리', '통장관리', '이벤트 관리'], '엑셀처럼 관리 탭이 시트에')
  assert.deepEqual(g.sheets.find((x) => x.name === '카드 관리').data[0].slice(0, 4), ['No', '카드사', '카드명', '종류'])

  // 자산: 순자산
  ok(g.call(U, 'POST', '/ledgers/asset', { 구분: '유동자산', 항목: '파킹통장', 금액: '5,000,000', 명의: '민호' }))
  ok(g.call(U, 'POST', '/ledgers/asset', { 구분: '부동산', 항목: '아파트', 금액: 400000000, 기준일: '2026-10-01' }))
  ok(g.call(U, 'POST', '/ledgers/asset', { 구분: '부채', 항목: '주택담보대출', 금액: 250000000 }))
  fail(g.call(U, 'POST', '/ledgers/asset', { 구분: '이상한구분', 항목: 'x', 금액: 1 }), 400)
  fail(g.call(U, 'POST', '/ledgers/asset', { 구분: '투자', 금액: 1 }), 400)
  let v = ok(g.call(U, 'GET', '/ledgers/asset'))
  assert.deepEqual(v.summary.map((x) => x.value), [405000000, 250000000, 155000000])
  assert.equal(v.rows.find((r) => r['항목'] === '아파트')['기준일'], '2026-10-01')

  // 예비비
  ok(g.call(U, 'POST', '/ledgers/reserve', { 분류: '여행자금', '목표 금액': 2000000, '모은 금액': 500000, '쓴 금액': 120000 }))
  v = ok(g.call(U, 'GET', '/ledgers/reserve'))
  assert.deepEqual(v.rows[0]._calc, { 잔액: 380000, 달성률: '25%' })

  // 대출: 저축 › 대출상환 내역으로 남은 원금 계산
  const loan = ok(g.call(U, 'POST', '/ledgers/loan', { 금융기관: '부산은행', 대출명: '중도금대출', 대출원금: 100000000, '금리(%)': 4.2, 납입일: 11 }))
  ok(g.call(U, 'POST', '/transactions', { date: '2026-09-11', type: 'saving', amount: 1000000, category_id: cid('저축'), subcategory: '대출상환', merchant: '부산은행 중도금' }))
  ok(g.call(U, 'POST', '/transactions', { date: '2026-10-11', type: 'saving', amount: 1500000, category_id: cid('저축'), subcategory: '대출상환', merchant: '중도금대출 상환' }))
  ok(g.call(U, 'POST', '/transactions', { date: '2026-10-12', type: 'saving', amount: 999, category_id: cid('저축'), subcategory: '적금', merchant: '부산은행 적금' }))
  v = ok(g.call(U, 'GET', '/ledgers/loan'))
  assert.deepEqual(v.rows[0]._calc, { '상환한 원금': 2500000, '남은 원금': 97500000 })
  assert.equal(v.rows[0]['금리(%)'], 4.2)
  assert.equal(v.rows[0]['납입일'], 11)
  fail(g.call(U, 'POST', '/ledgers/loan', { 대출명: 'x', 대출원금: 1, 납입일: 40 }), 400)

  // 카드: 지출 방법으로 이번 달 사용액·전월실적
  ok(g.call(U, 'POST', '/ledgers/card', { 카드사: '삼성카드', 카드명: '삼성 네이버카드', 종류: '신용', 전월실적: 300000 }))
  ok(g.call(U, 'POST', '/transactions', { date: '2026-10-05', type: 'expense', amount: 120000, category_id: cid('식비'), merchant: '이마트', payment_method: '삼성카드(솔)' }))
  ok(g.call(U, 'POST', '/transactions', { date: '2026-09-05', type: 'expense', amount: 350000, category_id: cid('식비'), merchant: '코스트코', payment_method: '삼성카드' }))
  ok(g.call(U, 'POST', '/transactions', { date: '2026-10-06', type: 'expense', amount: 50000, category_id: cid('식비'), merchant: '외식', payment_method: '신한카드' }))
  v = ok(g.call(U, 'GET', '/ledgers/card'))
  assert.deepEqual(v.rows[0]._calc, { '이번 달 사용': 120000, '지난달 사용': 350000, '이번 달 실적': '180,000원 남음' })

  // 통장, 이벤트
  ok(g.call(U, 'POST', '/ledgers/account', { 은행: '케이뱅크', 통장종류: '입출금', 용도: '생활비', 잔액: 1200000 }))
  assert.equal(ok(g.call(U, 'GET', '/ledgers/account')).summary[0].value, 1200000)
  const ev = ok(g.call(U, 'POST', '/ledgers/event', { 내용: '알뜰폰 개통 이벤트', '수령 예정일': '2026-10-01', 상태: '대기', '받을 것': '네이버페이 3만원' }))
  ok(g.call(U, 'POST', '/ledgers/event', { 내용: '신한카드 계좌변경', '수령 예정일': '2026-12-01', 상태: '대기' }))
  v = ok(g.call(U, 'GET', '/ledgers/event'))
  assert.deepEqual(v.summary.map((x) => x.value), [2, 1])
  // 수정·삭제, 시트 내용
  ok(g.call(U, 'PUT', `/ledgers/event/${ev.id}`, { 내용: '알뜰폰 개통 이벤트', '수령 예정일': '2026-10-01', 상태: '받음' }))
  assert.deepEqual(ok(g.call(U, 'GET', '/ledgers/event')).summary.map((x) => x.value), [1, 0])
  ok(g.call(U, 'DELETE', `/ledgers/loan/${loan.id}`))
  assert.equal(ok(g.call(U, 'GET', '/ledgers/loan')).rows.length, 0)
  const evTab = g.sheets.find((x) => x.name === '이벤트 관리')
  assert.equal(evTab.data[1][1], '알뜰폰 개통 이벤트')
  fail(g.call(U, 'GET', '/ledgers/nope'), 404)
}

console.log('✅ gas/Code.js 테스트 모두 통과')
