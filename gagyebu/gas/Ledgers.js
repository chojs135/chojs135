/**
 * 관리 탭 — 참고용 엑셀 가계부의 자산관리·예비비·대출 관리·카드 관리·통장관리·이벤트 관리
 *
 * 탭마다 열이 정해진 표 하나이고, 앱의 "관리" 화면과 시트 어느 쪽에서 고쳐도 된다.
 * 앱은 여기에 거래내역을 엮어 자동 계산을 덧붙인다:
 *  - 카드: 이번 달 사용액과 전월실적 달성 여부 (지출 방법이 카드사/카드명과 같은 지출)
 *  - 대출: 상환한 원금 누계와 남은 원금 (저축 › 대출상환 중 내용에 대출명/금융기관이 들어간 것)
 *  - 자산: 총자산 · 부채 · 순자산
 *  - 예비비: 잔액과 목표 달성률
 *  - 이벤트: 받을 날짜가 지났는데 아직 대기 중인 것
 */

// type: text | money | number | date | day(매월 n일) | select | member(구성원 이름 또는 공동)
var LEDGERS = {
  asset: {
    name: '자산관리',
    icon: '💎',
    hint: '통장 잔액, 적금, 투자, 연금, 부동산, 대출 같은 자산과 부채를 적어 두면 순자산을 계산해요. 금액은 가끔 최신으로 고쳐 주세요.',
    fields: [
      { key: '구분', type: 'select', options: ['유동자산', '투자', '노후대비', '부동산', '기타자산', '부채'], required: true },
      { key: '항목', type: 'text', required: true, primary: true, placeholder: '예: 비상금 파킹통장, 키움증권, 주택담보대출' },
      { key: '명의', type: 'member' },
      { key: '금액', type: 'money', required: true },
      { key: '기준일', type: 'date' },
      { key: '비고', type: 'text' },
    ],
  },
  reserve: {
    name: '예비비',
    icon: '🫙',
    hint: '여행·경조사·건강처럼 목적별로 따로 모아 두는 돈이에요.',
    fields: [
      { key: '분류', type: 'text', required: true, primary: true, placeholder: '예: 여행자금, 경조사, 건강' },
      { key: '목표 금액', type: 'money' },
      { key: '모은 금액', type: 'money' },
      { key: '쓴 금액', type: 'money' },
      { key: '비고', type: 'text' },
    ],
  },
  loan: {
    name: '대출 관리',
    icon: '🏦',
    hint: '원금을 갚을 때 내역을 "저축 › 대출상환"으로 기록하고 내용에 대출명(또는 은행)을 넣으면 남은 원금이 자동으로 줄어요.',
    fields: [
      { key: '금융기관', type: 'text', placeholder: '예: 부산은행' },
      { key: '대출명', type: 'text', required: true, primary: true, placeholder: '예: 중도금대출' },
      { key: '대출목적', type: 'select', options: ['부동산', '생활', '자동차', '학자금', '가족', '기타'] },
      { key: '대출원금', type: 'money', required: true },
      { key: '금리(%)', type: 'number' },
      { key: '금리종류', type: 'select', options: ['고정', '변동', '혼합', '무이자'] },
      { key: '상환방식', type: 'select', options: ['원리금균등', '원금균등', '만기일시', '자유상환'] },
      { key: '시작일', type: 'date' },
      { key: '만기일', type: 'date' },
      { key: '납입일', type: 'day' },
      { key: '월 납입금', type: 'money' },
      { key: '비고', type: 'text' },
    ],
  },
  card: {
    name: '카드 관리',
    icon: '💳',
    hint: '내역의 "지출 방법"이 카드사나 카드명과 같으면 이번 달 사용액과 전월실적 달성 여부를 자동으로 계산해요.',
    fields: [
      { key: '카드사', type: 'text', required: true, placeholder: '예: 삼성카드' },
      { key: '카드명', type: 'text', primary: true, placeholder: '예: 삼성 네이버카드' },
      { key: '종류', type: 'select', options: ['신용', '체크'] },
      { key: '명의', type: 'member' },
      { key: '용도', type: 'text', placeholder: '예: 생활비, 관리비 자동이체' },
      { key: '결제일', type: 'day' },
      { key: '결제계좌', type: 'text' },
      { key: '전월실적', type: 'money', placeholder: '혜택 받는 데 필요한 한 달 사용액' },
      { key: '혜택', type: 'text' },
      { key: '연회비', type: 'money' },
      { key: '발급일', type: 'date' },
      { key: '비고', type: 'text' },
    ],
  },
  account: {
    name: '통장관리',
    icon: '📒',
    hint: '계좌번호는 뒤 4자리만 적는 걸 추천해요(시트는 공유되는 파일이에요).',
    fields: [
      { key: '은행', type: 'text', required: true, placeholder: '예: 케이뱅크' },
      { key: '통장종류', type: 'select', options: ['입출금', '적금', '예금', '청약', '파킹', 'CMA', '증권', '기타'] },
      { key: '계좌번호', type: 'text', placeholder: '뒤 4자리, 예: 1224' },
      { key: '명의', type: 'member' },
      { key: '용도', type: 'text', primary: true, placeholder: '예: 생활비, 비상금, 월급통장' },
      { key: '잔액', type: 'money' },
      { key: '비고', type: 'text' },
    ],
  },
  event: {
    name: '이벤트 관리',
    icon: '🎁',
    hint: '받기로 한 캐시백·쿠폰·사은품을 적어 두고, 받으면 상태를 "받음"으로 바꾸세요.',
    fields: [
      { key: '내용', type: 'text', required: true, primary: true, placeholder: '예: 신한카드 결제계좌 변경 이벤트' },
      { key: '신청일', type: 'date' },
      { key: '수령 예정일', type: 'date' },
      { key: '조건', type: 'text' },
      { key: '수령방법', type: 'text' },
      { key: '받을 것', type: 'text', placeholder: '예: 1만 포인트, 커피쿠폰 2잔' },
      { key: '상태', type: 'select', options: ['대기', '받음', '취소'] },
      { key: '비고', type: 'text' },
    ],
  },
};
var LEDGER_TYPES = ['asset', 'reserve', 'loan', 'card', 'account', 'event'];

function ledgerKey_(type) {
  var def = LEDGERS[type];
  if (!def) throw httpError_(404, '알 수 없는 관리 탭이에요.');
  var key = 'ledger_' + type;
  if (!SHEETS[key]) SHEETS[key] = { name: def.name, headers: ['No'].concat(def.fields.map(function (f) { return f.key; })) };
  return key;
}

function ledgerRows_(type) {
  var def = LEDGERS[type];
  return read_(ledgerKey_(type)).map(function (r) {
    var o = { id: Number(r.No), _row: r._row };
    def.fields.forEach(function (f) {
      var v = r[f.key];
      if (f.type === 'money' || f.type === 'number') o[f.key] = v === '' ? null : Number(String(v).replace(/[^0-9.\-]/g, '')) || 0;
      else if (f.type === 'date') o[f.key] = v === '' ? '' : ymd_(v);
      else if (f.type === 'day') o[f.key] = v === '' ? null : parseInt(String(v), 10) || null;
      else o[f.key] = String(v === null || v === undefined ? '' : v);
    });
    return o;
  });
}

function cleanLedgerBody_(type, body) {
  var def = LEDGERS[type];
  var o = {};
  def.fields.forEach(function (f) {
    var v = body[f.key];
    if (f.required && (v === undefined || v === null || String(v).trim() === '')) throw httpError_(400, f.key + '을(를) 입력해 주세요.');
    if (v === undefined || v === null) v = '';
    if ((f.type === 'money' || f.type === 'number' || f.type === 'day') && v !== '') {
      v = Number(String(v).replace(/[^0-9.\-]/g, ''));
      if (!isFinite(v)) throw httpError_(400, f.key + ' 값을 확인해 주세요.');
      if (f.type === 'day' && (v < 1 || v > 31)) throw httpError_(400, f.key + '은(는) 1~31 사이로 적어 주세요.');
    }
    if (f.type === 'select' && v !== '' && f.options.indexOf(v) < 0) throw httpError_(400, f.key + ' 값이 올바르지 않아요.');
    o[f.key] = v;
  });
  return o;
}

function createLedger_(type, body) {
  var key = ledgerKey_(type);
  var o = cleanLedgerBody_(type, body);
  o.No = nextLedgerId_(key);
  append_(key, [o]);
  return { id: o.No };
}

function nextLedgerId_(key) {
  var max = 0;
  read_(key).forEach(function (r) { max = Math.max(max, Number(r.No) || 0); });
  return max + 1;
}

function updateLedger_(type, id, body) {
  var key = ledgerKey_(type);
  var cur = read_(key).filter(function (r) { return Number(r.No) === id; })[0];
  if (!cur) throw httpError_(404, '항목을 찾을 수 없어요.');
  var o = cleanLedgerBody_(type, body);
  o.No = id;
  writeRow_(key, cur._row, o);
  return true;
}

function deleteLedger_(type, id) {
  var key = ledgerKey_(type);
  deleteRows_(key, read_(key).filter(function (r) { return Number(r.No) === id; }).map(function (r) { return r._row; }));
  return true;
}

/** 표 + 자동 계산 + 요약 */
function ledgerView_(type) {
  var def = LEDGERS[type];
  var rows = ledgerRows_(type).map(stripRow_);
  var summary = [];
  var today = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  var month = today.slice(0, 7);

  if (type === 'asset') {
    var assets = 0;
    var debts = 0;
    rows.forEach(function (r) { if (r['구분'] === '부채') debts += r['금액'] || 0; else assets += r['금액'] || 0; });
    summary = [{ label: '총자산', value: assets }, { label: '부채', value: debts }, { label: '순자산', value: assets - debts, strong: true }];
  }
  if (type === 'reserve') {
    rows.forEach(function (r) {
      r._calc = { 잔액: (r['모은 금액'] || 0) - (r['쓴 금액'] || 0) };
      if (r['목표 금액']) r._calc['달성률'] = Math.round(((r['모은 금액'] || 0) / r['목표 금액']) * 100) + '%';
    });
    var saved = rows.reduce(function (a, r) { return a + (r['모은 금액'] || 0); }, 0);
    var spent = rows.reduce(function (a, r) { return a + (r['쓴 금액'] || 0); }, 0);
    summary = [{ label: '모은 금액', value: saved }, { label: '쓴 금액', value: spent }, { label: '잔액', value: saved - spent, strong: true }];
  }
  if (type === 'loan') {
    var txs = allTx_().filter(function (t) { return t.type === 'saving' && t.subcategory === '대출상환'; });
    rows.forEach(function (r) {
      var repaid = txs
        .filter(function (t) { return (r['대출명'] && similarMerchant_(t.merchant + ' ' + t.description, r['대출명'])) || (r['금융기관'] && String(t.merchant).indexOf(r['금융기관']) >= 0); })
        .reduce(function (a, t) { return a + t.amount; }, 0);
      r._calc = { '상환한 원금': repaid, '남은 원금': Math.max(0, (r['대출원금'] || 0) - repaid) };
    });
    summary = [
      { label: '대출원금 합계', value: rows.reduce(function (a, r) { return a + (r['대출원금'] || 0); }, 0) },
      { label: '남은 원금', value: rows.reduce(function (a, r) { return a + r._calc['남은 원금']; }, 0), strong: true },
      { label: '월 납입금', value: rows.reduce(function (a, r) { return a + (r['월 납입금'] || 0); }, 0) },
    ];
  }
  if (type === 'card') {
    var exp = allTx_().filter(function (t) { return t.type === 'expense' && t.payment_method; });
    var usage = function (r, ym) {
      return exp
        .filter(function (t) { return t.date.slice(0, 7) === ym && (similarMerchant_(t.payment_method, r['카드사']) || (r['카드명'] && similarMerchant_(t.payment_method, r['카드명']))); })
        .reduce(function (a, t) { return a + t.amount; }, 0);
    };
    rows.forEach(function (r) {
      var now = usage(r, month);
      var prev = usage(r, shiftMonth_(month, -1));
      r._calc = { '이번 달 사용': now, '지난달 사용': prev };
      if (r['전월실적']) r._calc['이번 달 실적'] = now >= r['전월실적'] ? '달성' : (r['전월실적'] - now).toLocaleString('ko-KR') + '원 남음';
    });
    summary = [{ label: '이번 달 카드 사용', value: rows.reduce(function (a, r) { return a + r._calc['이번 달 사용']; }, 0), strong: true }];
  }
  if (type === 'account') {
    summary = [{ label: '잔액 합계', value: rows.reduce(function (a, r) { return a + (r['잔액'] || 0); }, 0), strong: true }];
  }
  if (type === 'event') {
    rows.forEach(function (r) {
      if ((r['상태'] || '대기') === '대기' && r['수령 예정일'] && r['수령 예정일'] < today) r._calc = { 알림: '받을 날짜가 지났어요' };
    });
    summary = [
      { label: '대기 중', value: rows.filter(function (r) { return (r['상태'] || '대기') === '대기'; }).length, unit: '건' },
      { label: '날짜 지남', value: rows.filter(function (r) { return r._calc; }).length, unit: '건', strong: true },
    ];
  }
  return { type: type, name: def.name, icon: def.icon, hint: def.hint, fields: def.fields, rows: rows, summary: summary };
}

/** 시트에 관리 탭들을 만들고 금액·날짜 열 서식을 맞춘다. */
function ensureLedgerSheets_() {
  LEDGER_TYPES.forEach(function (t) {
    var key = ledgerKey_(t);
    var sh = sheet_(key);
    LEDGERS[t].fields.forEach(function (f, i) {
      var col = colA1_(i + 2);
      if (f.type === 'money') sh.getRange(col + ':' + col).setNumberFormat('#,##0');
      if (f.type === 'date') sh.getRange(col + ':' + col).setNumberFormat('yyyy-mm-dd');
      sh.setColumnWidth(i + 2, f.type === 'text' ? 160 : 100);
    });
    sh.setColumnWidth(1, 44);
  });
}

function ledgerList_() {
  return LEDGER_TYPES.map(function (t) { return { type: t, name: LEDGERS[t].name, icon: LEDGERS[t].icon }; });
}
