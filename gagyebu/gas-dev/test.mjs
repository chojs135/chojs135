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
assert.equal(cats.length, 24)
assert.deepEqual([...new Set(cats.map((c) => c.type))], ['expense', 'income', 'saving', 'transfer'])
assert.deepEqual(cat('식비').subcategories, ['장보기', '외식', '배달', '카페/간식', '편의점'])

// 4. 거래 입력 / 조회 / 수정 / 삭제
const t1 = ok(gas.call(H, 'POST', '/transactions', { date: '2026-10-03', type: 'expense', amount: 45000, category_id: cat('식비').id, subcategory: '외식', merchant: '김밥천국 강남점', member_id: husbandId }))
ok(gas.call(W, 'POST', '/transactions', { date: '2026-10-05', type: 'expense', amount: 30000, category_id: cat('식비').id, subcategory: '배달', merchant: '배달의민족', member_id: wifeId }))
ok(gas.call(H, 'POST', '/transactions', { date: '2026-10-25', type: 'income', amount: 3500000, category_id: cat('급여').id, subcategory: '월급', merchant: '회사', member_id: husbandId }))
ok(gas.call(H, 'POST', '/transactions', { date: '2026-10-20', type: 'expense', amount: 320000, category_id: cat('주거/관리비').id, subcategory: '관리비', merchant: '래미안 관리비', member_id: null, fixed: true, tags: ['#확인필요', '확인필요', ' 관리비 '] }))
ok(gas.call(H, 'POST', '/transactions', { date: '2026-09-20', type: 'expense', amount: 300000, category_id: cat('주거/관리비').id, subcategory: '관리비', merchant: '래미안 관리비', member_id: null }))
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
ok(gas.call(H, 'PUT', '/budgets', { items: [{ category_id: cat('식비').id, amount: 50000 }, { category_id: cat('주거/관리비').id, amount: 400000 }] }))
let budgets = ok(gas.call(H, 'GET', '/budgets'))
assert.equal(budgets.length, 2)
ok(gas.call(H, 'PUT', '/budgets', { items: [{ category_id: cat('주거/관리비').id, amount: 0 }] }))
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
assert.equal(s.byCategory[0].name, '주거/관리비')
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

// 월별요약 탭
const monthly = gas.sheets.find((x) => x.name === '월별요약').data
assert.deepEqual(monthly[0], ['월', '수입', '지출', '저축', '남은 돈', '저축률(%)'])
assert.deepEqual(monthly[1], ['2026-10', 3500000, 395000, 1000000, 2105000, 28.6])
assert.equal(monthly[2][0], '2026-09')

// 6. 업로드: 분석 컨텍스트 → 결과 정리 → 저장
// 연간 리포트
const yr = ok(gas.call(H, 'GET', '/annual?year=2026'))
assert.equal(yr.activeMonths, 2)
assert.equal(yr.expense, 695000)
assert.equal(yr.totals[9].saving, 1000000)
const feeRow = yr.expenseTable.find((r) => r.name === '주거/관리비')
assert.equal(feeRow.months[8], 300000)
assert.equal(feeRow.months[9], 320000)
assert.equal(feeRow.total, 620000)
assert.equal(feeRow.average, 310000)
assert.equal(yr.expenseTable[0].name, '식비', '카테고리 순서대로')
assert.deepEqual(yr.savingTable.map((r) => r.name), ['저축'])

const actx = ok(gas.call(W, 'GET', '/analysis-context'))
assert.equal(actx.apiKey, 'sk-ant-test')
assert.equal(actx.model, 'claude-opus-5-5')
assert.ok(actx.system.includes('"김밥천국" → 식비 / 배달'), '가맹점 규칙이 프롬프트에 들어가야 함')
assert.ok(actx.schema.properties.transactions.items.properties.category.enum.includes('주거/관리비'))
assert.deepEqual(actx.schema.properties.transactions.items.properties.type.enum, ['expense', 'income', 'saving', 'transfer'])
assert.ok(actx.system.includes('저축 카테고리:\n- 저축: 적금'))

const extraction = {
  document_type: '카드 이용내역',
  summary: '10월 카드 3건',
  transactions: [
    { date: '2026-10-07', type: 'expense', amount: 12000, merchant: '김밥천국 역삼점', description: '분식', category: '식비', subcategory: '외식', payment_method: '신한카드', confidence: 0.9, note: '' },
    { date: '2026-10-05', type: 'expense', amount: -30000, merchant: '배달의민족', description: '배달', category: '식비', subcategory: '배달', payment_method: '신한카드', confidence: 0.95, note: '' },
    { date: '2026-10-08', type: 'expense', amount: 18000, merchant: '넷플릭스', description: '구독', category: '문화/여가', subcategory: '없는세부', payment_method: '', fixed: true, confidence: 0.5, note: '흐림' },
  ],
}
const prepared = ok(gas.call(W, 'POST', '/uploads/prepare', { extraction, member_id: wifeId }))
const [a, b, c] = prepared.items
assert.equal(a.rule_applied, true)
assert.equal(a.subcategory, '배달', '규칙(배달)이 AI 결과(외식)보다 우선')
assert.equal(b.amount, 30000, '음수 금액은 양수로')
assert.equal(b.duplicate, true)
assert.equal(b.include, false, '중복 의심은 기본 제외')
assert.equal(c.subcategory, '', '없는 세부항목은 비움')
assert.equal(c.member_id, wifeId)
assert.equal(c.fixed, true)
assert.equal(a.fixed, false)

c.category_id = cat('문화/여가').id
c.subcategory = '구독서비스' // 사용자가 고침 → 규칙 학습
const committed = ok(gas.call(W, 'POST', '/uploads/commit', { items: prepared.items, filenames: ['카드.pdf'], document_type: prepared.document_type, summary: prepared.summary }))
assert.equal(committed.saved, 2)
rules = ok(gas.call(H, 'GET', '/rules'))
assert.ok(rules.some((r) => r.keyword === '넷플릭스' && r.subcategory === '구독서비스'))
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
ok(gas.call(H, 'DELETE', `/categories/${cat('문화/여가').id}`))
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
ok(gas.call(H, 'PUT', '/settings', { apiKey: ' sk-ant-new ' }))
assert.equal(gas.props.ANTHROPIC_API_KEY, 'sk-ant-new')
fail(gas.call('stranger@gmail.com', 'GET', '/analysis-context'), 403)
fail(gas.call('', 'GET', '/me'), 401)
fail(gas.call(H, 'GET', '/nope'), 404)

console.log('✅ gas/Code.js 테스트 모두 통과')
