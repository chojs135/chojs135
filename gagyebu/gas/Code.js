/**
 * 우리집 가계부 — Google Apps Script 서버
 *
 * 데이터는 이 스크립트가 연결된 구글 시트의 탭에 저장된다(거래내역, 카테고리, 예산, ...).
 * 화면(Index.html)은 google.script.run으로 api(method, path, body)를 호출한다.
 * Claude 분석은 Apps Script의 외부 요청 60초 제한을 피하려고 브라우저에서 직접 호출하고,
 * 여기서는 분석에 필요한 프롬프트와 분석 결과의 후처리(카테고리 매칭, 규칙, 중복 검사)만 한다.
 */

var SHEETS = {
  tx: {
    name: '거래내역',
    headers: ['ID', '날짜', '구분', '금액', '카테고리', '세부항목', '가맹점', '내용', '결제수단', '사용자', '고정', '태그', '메모', '입력방식', '업로드ID', '입력자', '입력일시', '수정일시'],
  },
  cat: { name: '카테고리', headers: ['ID', '구분', '이름', '아이콘', '색', '세부항목', '순서'] },
  budget: { name: '예산', headers: ['카테고리', '월 예산'] },
  rule: { name: '자동분류규칙', headers: ['키워드', '구분', '카테고리', '세부항목', '수정일시'] },
  member: { name: '구성원', headers: ['ID', '이메일', '이름', '추가일시'] },
  upload: { name: '업로드기록', headers: ['ID', '일시', '파일', '문서종류', '요약', '올린사람', '저장건수'] },
};
// 저축은 쓴 돈도 버는 돈도 아니지만 "얼마나 모았나"를 보려고 따로 센다.
// 이체(카드대금, 내 계좌 간 이동)는 통계에서 완전히 빠진다.
var TYPE_KO = { expense: '지출', income: '수입', saving: '저축', transfer: '이체' };
var KO_TYPE = { 지출: 'expense', 수입: 'income', 저축: 'saving', 이체: 'transfer' };
var FIXED = '고정';
var SHARED = '공동';
// 분석 모델. 기본은 가장 저렴한 Haiku이고, 설정에서 바꾸거나 검토 화면에서 Opus로 다시 분석할 수 있다.
var MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];
var DEFAULT_MODEL = 'claude-haiku-5-5';

// 참고용 엑셀 가계부의 분류(설정 탭)를 기준으로 한 기본 분류.
// 엑셀은 "월급(솔)"처럼 사람마다 소분류를 따로 두었지만, 여기선 거래마다 사용자가 있어서 보고서에서 자동으로 나눈다.
var CATEGORY_PRESET = 'excel-v1';
var FIXED_CATEGORY = '고정지출';
var DEFAULT_CATEGORIES = [
  ['income', '수입', '💼', '#16a34a', ['월급', '상여금', '부수입', '이자/배당', '환급', '기타']],
  ['saving', '저축', '🐷', '#0284c7', ['적금', '예금', '주택청약', '대출상환', '공제회', '주식', '파킹통장', '연금/IRP']],
  ['expense', '고정지출', '🏠', '#0ea5e9', ['주거비', '관리비', '공과금', '보험료', '통신비', '구독료']],
  ['expense', '식비', '🍚', '#f97316', ['식재료', '편의점/까페', '외식', '배달']],
  ['expense', '용돈', '👛', '#d946ef', ['용돈']],
  ['expense', '생활용품', '🧺', '#14b8a6', ['생필품', '가전/가구', '수리비']],
  ['expense', '의복/미용', '👕', '#ec4899', ['의류', '미용', '헤어']],
  ['expense', '건강', '💊', '#ef4444', ['병원/약국', '영양제', '운동비']],
  ['expense', '자기계발', '📚', '#eab308', ['강의', '책', '자격증', '학교연수', '구독', '기타']],
  ['expense', '경조사', '🎁', '#f43f5e', ['가족', '지인', '부모님', '회비', '기타']],
  ['expense', '문화생활', '🎬', '#22c55e', ['여행', 'OTT', '공연/책/기타']],
  ['expense', '세금', '🧾', '#64748b', ['부동산', '주식', '자동차', '기타']],
  ['expense', '교통', '🚗', '#6366f1', ['주유', '관리', '자동차보험', '교통비', '톨비/주차']],
  ['expense', '기부', '🤝', '#10b981', ['정기', '비정기']],
  ['expense', '기타지출', '📦', '#9ca3af', []],
  // 통계에서 빠지는 돈의 이동. 카드대금 출금이나 내 계좌 간 이체를 지출로 세면 이중 집계가 된다.
  ['transfer', '이체', '🔁', '#94a3b8', ['카드대금', '내 계좌 이체', '기타']],
];

// 이전 기본 분류 → 엑셀 기준 분류. [새 대분류, 새 소분류], '*'는 그 외 소분류.
var LEGACY_CATEGORY_MAP = {
  expense: {
    식비: { 장보기: ['식비', '식재료'], 외식: ['식비', '외식'], 배달: ['식비', '배달'], '카페/간식': ['식비', '편의점/까페'], 편의점: ['식비', '편의점/까페'], '*': ['식비', ''] },
    '주거/관리비': { 관리비: ['고정지출', '관리비'], 전기: ['고정지출', '공과금'], 수도: ['고정지출', '공과금'], '가스/난방': ['고정지출', '공과금'], 월세: ['고정지출', '주거비'], 대출이자: ['고정지출', '주거비'], '인터넷/TV': ['고정지출', '통신비'], '수선/유지': ['생활용품', '수리비'], '*': ['고정지출', '주거비'] },
    생활용품: { 생필품: ['생활용품', '생필품'], '가구/가전': ['생활용품', '가전/가구'], 주방용품: ['생활용품', '생필품'], '*': ['생활용품', ''] },
    '교통/차량': { 대중교통: ['교통', '교통비'], 택시: ['교통', '교통비'], '주유/충전': ['교통', '주유'], '주차/통행료': ['교통', '톨비/주차'], '정비/세차': ['교통', '관리'], 자동차보험: ['교통', '자동차보험'], '*': ['교통', ''] },
    '통신/구독': { 휴대폰: ['고정지출', '통신비'], 구독서비스: ['고정지출', '구독료'], 멤버십: ['고정지출', '구독료'], '*': ['고정지출', '통신비'] },
    '의료/건강': { '병원/약국': ['건강', '병원/약국'], 영양제: ['건강', '영양제'], 운동: ['건강', '운동비'], '*': ['건강', ''] },
    '의류/미용': { 의류: ['의복/미용', '의류'], '신발/잡화': ['의복/미용', '의류'], 미용실: ['의복/미용', '헤어'], 화장품: ['의복/미용', '미용'], '*': ['의복/미용', ''] },
    '교육/자기계발': { '학원/강의': ['자기계발', '강의'], 도서: ['자기계발', '책'], 자격증: ['자기계발', '자격증'], '*': ['자기계발', '기타'] },
    '문화/여가': { '여행/숙박': ['문화생활', '여행'], '*': ['문화생활', '공연/책/기타'] },
    '경조사/선물': { 경조사비: ['경조사', '지인'], 선물: ['경조사', '지인'], 부모님: ['경조사', '부모님'], 모임회비: ['경조사', '회비'], '*': ['경조사', '기타'] },
    용돈: { '*': ['용돈', '용돈'] },
    '보험/세금': { 보험료: ['고정지출', '보험료'], '*': ['세금', '기타'] },
    기부: { 정기후원: ['기부', '정기'], 비정기: ['기부', '비정기'], '*': ['기부', ''] },
    반려동물: { '*': ['생활용품', '생필품'] },
  },
  income: {
    급여: { 월급: ['수입', '월급'], 상여금: ['수입', '상여금'], '*': ['수입', '월급'] },
    부수입: { '*': ['수입', '부수입'] },
    금융수입: { '*': ['수입', '이자/배당'] },
    '환급/지원금': { '*': ['수입', '환급'] },
    기타수입: { '*': ['수입', '기타'] },
  },
  saving: {
    저축: { 적금: ['저축', '적금'], 예금: ['저축', '예금'], 주택청약: ['저축', '주택청약'], '비상금/파킹통장': ['저축', '파킹통장'], '*': ['저축', ''] },
    투자: { '주식/ETF': ['저축', '주식'], '연금/IRP': ['저축', '연금/IRP'], 공제회: ['저축', '공제회'], '*': ['저축', '주식'] },
    대출상환: { '*': ['저축', '대출상환'] },
  },
};

// ---------------------------------------------------------------- 진입점

// appsscript.json의 oauthScopes와 같아야 한다.
var REQUIRED_SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/userinfo.email'];

/**
 * 구글 권한 화면에서 항목을 하나씩 고를 수 있어서(부분 동의) 시트 권한을 빼고 허용하면 앱이 동작하지 않는다.
 * 빠진 권한이 있으면 다시 허용하는 주소를 돌려준다.
 */
function missingAuthUrl_() {
  try {
    var info = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL, REQUIRED_SCOPES);
    return info.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED ? info.getAuthorizationUrl() : null;
  } catch (e) {
    return null;
  }
}

function authPage_(url) {
  var html =
    '<div style="font-family:-apple-system,\'Apple SD Gothic Neo\',\'Malgun Gothic\',sans-serif;max-width:420px;margin:48px auto;padding:0 16px;line-height:1.6">' +
    '<h2>💰 우리집 가계부</h2>' +
    '<p>가계부를 쓰려면 <b>구글 시트 접근 권한</b>이 필요해요. 아래 버튼을 눌러 권한 화면에서 <b>모든 항목에 체크</b>하고 허용해 주세요.</p>' +
    '<p><a href="' + url + '" target="_blank" style="display:inline-block;padding:12px 18px;background:#4f46e5;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">권한 허용하기</a></p>' +
    '<p style="color:#6b6a66;font-size:14px">허용한 뒤 이 페이지를 새로고침하세요.<br>휴대폰에 구글 계정이 여러 개라면 가계부 구성원으로 등록된 계정을 골라 주세요.</p>' +
    '</div>';
  return HtmlService.createHtmlOutput(html).setTitle('우리집 가계부').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doGet() {
  var authUrl = missingAuthUrl_();
  if (authUrl) return authPage_(authUrl);
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('우리집 가계부')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setFaviconUrl('https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4b0.png');
}

/** 화면에서 호출하는 유일한 함수. 결과는 JSON 문자열로 돌려준다(Date 등 직렬화 문제 방지). */
function api(method, path, bodyJson) {
  try {
    var body = bodyJson ? JSON.parse(bodyJson) : {};
    return JSON.stringify({ ok: true, data: route_(method, path, body) });
  } catch (e) {
    var authUrl = e.status ? null : missingAuthUrl_();
    if (authUrl) {
      return JSON.stringify({ ok: false, status: 401, authUrl: authUrl, error: '구글 시트 접근 권한이 빠져 있어요. [권한 다시 허용하기]를 눌러 모든 항목에 체크해 주세요.' });
    }
    return JSON.stringify({ ok: false, status: e.status || 500, error: e.message || String(e) });
  }
}

function httpError_(status, message) {
  var e = new Error(message);
  e.status = status;
  return e;
}

// ---------------------------------------------------------------- 시트 접근

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(key) {
  var def = SHEETS[key];
  var sh = ss_().getSheetByName(def.name);
  if (!sh) {
    sh = ss_().insertSheet(def.name);
    sh.getRange(1, 1, 1, def.headers.length).setValues([def.headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    if (key === 'tx') {
      sh.getRange('B:B').setNumberFormat('yyyy-mm-dd');
      sh.getRange('D:D').setNumberFormat('#,##0');
    }
    if (key === 'budget') sh.getRange('B:B').setNumberFormat('#,##0');
  }
  return sh;
}

/** 시트 전체를 [{헤더: 값, _row: 시트 행 번호}] 로 읽는다. */
function read_(key) {
  var sh = sheet_(key);
  var headers = SHEETS[key].headers;
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, headers.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    if (values[i].every(function (v) { return v === '' || v === null; })) continue;
    var o = { _row: i + 2 };
    for (var j = 0; j < headers.length; j++) o[headers[j]] = values[i][j];
    out.push(o);
  }
  return out;
}

function toRow_(key, obj) {
  return SHEETS[key].headers.map(function (h) { return obj[h] === undefined || obj[h] === null ? '' : obj[h]; });
}

function append_(key, objs) {
  if (!objs.length) return;
  var sh = sheet_(key);
  var rows = objs.map(function (o) { return toRow_(key, o); });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function writeRow_(key, rowNum, obj) {
  sheet_(key).getRange(rowNum, 1, 1, SHEETS[key].headers.length).setValues([toRow_(key, obj)]);
}

/** 여러 행을 지울 때는 아래쪽부터 지워야 행 번호가 밀리지 않는다. */
function deleteRows_(key, rowNums) {
  var sh = sheet_(key);
  rowNums.slice().sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function tz_() {
  return ss_().getSpreadsheetTimeZone() || 'Asia/Seoul';
}

/** 시트가 날짜 문자열을 Date로 바꿔 저장하므로 읽을 때 다시 YYYY-MM-DD로 맞춘다. */
function ymd_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  return String(v || '').slice(0, 10);
}

function now_() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss');
}

function props_() {
  return PropertiesService.getScriptProperties();
}

function nextId_(rows) {
  var max = 0;
  rows.forEach(function (r) { max = Math.max(max, Number(r.ID) || 0); });
  return max + 1;
}

// ---------------------------------------------------------------- 구성원 / 인증

function currentEmail_() {
  var email = Session.getActiveUser().getEmail();
  if (!email) {
    throw httpError_(401, '구글 계정 이메일을 확인할 수 없어요. 웹 앱 배포 설정이 "실행: 웹 앱에 액세스하는 사용자"인지 확인해 주세요.');
  }
  return String(email).toLowerCase();
}

function members_() {
  return read_('member').map(function (m) {
    return { id: Number(m.ID), email: String(m['이메일']).toLowerCase(), name: String(m['이름']) };
  });
}

function requireMember_() {
  var email = currentEmail_();
  var me = members_().filter(function (m) { return m.email === email; })[0];
  if (!me) throw httpError_(403, email + ' 계정은 이 가계부의 구성원이 아니에요. 가계부를 만든 사람에게 구성원 추가를 요청해 주세요.');
  return me;
}

function memberNameById_(members, id) {
  if (id === null || id === undefined || id === '') return SHARED;
  var m = members.filter(function (x) { return x.id === Number(id); })[0];
  return m ? m.name : SHARED;
}

function memberIdByName_(members, name) {
  var m = members.filter(function (x) { return x.name === name; })[0];
  return m ? m.id : null;
}

// ---------------------------------------------------------------- 카테고리

function categories_() {
  return read_('cat')
    .map(function (c) {
      return {
        id: Number(c.ID),
        type: KO_TYPE[c['구분']] || 'expense',
        name: String(c['이름']),
        icon: String(c['아이콘'] || ''),
        color: String(c['색'] || '#9ca3af'),
        subcategories: String(c['세부항목'] || '').split(',').map(function (s) { return s.trim(); }).filter(String),
        sort: Number(c['순서']) || 0,
        _row: c._row,
      };
    })
    .sort(function (a, b) { return a.sort - b.sort || a.id - b.id; });
}

function stripRow_(o) {
  var c = {};
  for (var k in o) if (k !== '_row') c[k] = o[k];
  return c;
}

function findCategory_(cats, type, name) {
  return cats.filter(function (c) { return c.type === type && c.name === name; })[0] || null;
}

function presetRows_() {
  return DEFAULT_CATEGORIES.map(function (c, i) {
    return { ID: i + 1, 구분: TYPE_KO[c[0]], 이름: c[1], 아이콘: c[2], 색: c[3], 세부항목: c[4].join(', '), 순서: i + 1 };
  });
}

function seedCategories_() {
  if (read_('cat').length) return;
  append_('cat', presetRows_());
  props_().setProperty('CATEGORY_PRESET', CATEGORY_PRESET);
}

/** 시트의 표 영역(머리줄 아래)을 통째로 다시 쓴다. */
function rewrite_(key, objs) {
  var sh = sheet_(key);
  var n = SHEETS[key].headers.length;
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, n).clearContent();
  append_(key, objs);
}

/**
 * 이전 기본 분류를 쓰던 가계부를 엑셀 기준 분류로 옮긴다(한 번만).
 * 사용자가 직접 만든 카테고리는 그대로 둔다.
 */
function ensurePreset_() {
  var p = props_();
  if (p.getProperty('CATEGORY_PRESET') === CATEGORY_PRESET) return false;
  return withLock_(function () {
    if (p.getProperty('CATEGORY_PRESET') === CATEGORY_PRESET) return false;
    var mapOf = function (koType, name, sub) {
      var t = LEGACY_CATEGORY_MAP[KO_TYPE[koType]];
      var m = t && t[name];
      if (!m) return null;
      return m[sub] || m['*'];
    };
    var txs = read_('tx').map(function (r) {
      var to = mapOf(r['구분'], String(r['카테고리']), String(r['세부항목']));
      if (to) {
        r['카테고리'] = to[0];
        r['세부항목'] = to[1];
        if (to[0] === FIXED_CATEGORY) r['고정'] = FIXED;
      }
      return r;
    });
    rewrite_('tx', txs);
    rewrite_('rule', read_('rule').map(function (r) {
      var to = mapOf(r['구분'], String(r['카테고리']), String(r['세부항목']));
      if (to) {
        r['카테고리'] = to[0];
        r['세부항목'] = to[1];
      }
      return r;
    }));
    var budgets = {};
    read_('budget').forEach(function (b) {
      var to = mapOf('지출', String(b['카테고리']), '*');
      var name = to ? to[0] : String(b['카테고리']);
      budgets[name] = (budgets[name] || 0) + (Number(b['월 예산']) || 0);
    });
    rewrite_('budget', Object.keys(budgets).map(function (k) { return { 카테고리: k, '월 예산': budgets[k] }; }));
    // 카테고리: 엑셀 기준 분류 + 사용자가 만든 것
    var preset = presetRows_();
    var custom = read_('cat').filter(function (c) {
      var name = String(c['이름']);
      var type = KO_TYPE[c['구분']];
      var legacy = LEGACY_CATEGORY_MAP[type] && LEGACY_CATEGORY_MAP[type][name];
      var inPreset = preset.some(function (x) { return x['이름'] === name && x['구분'] === c['구분']; });
      return !legacy && !inPreset;
    });
    custom.forEach(function (c, i) {
      c.ID = preset.length + i + 1;
      c['순서'] = preset.length + i + 1;
    });
    rewrite_('cat', preset.concat(custom));
    var old = ss_().getSheetByName('월별요약');
    if (old) ss_().deleteSheet(old);
    p.setProperty('CATEGORY_PRESET', CATEGORY_PRESET);
    rebuildReports_();
    return true;
  });
}

// ---------------------------------------------------------------- 거래

/** 시트 행 → 화면용 거래 객체 */
function txFromRow_(r, cats, members) {
  var type = KO_TYPE[r['구분']] || 'expense';
  var cat = findCategory_(cats, type, String(r['카테고리']));
  return {
    id: Number(r.ID),
    date: ymd_(r['날짜']),
    type: type,
    amount: Number(r['금액']) || 0,
    category_id: cat ? cat.id : null,
    category_name: String(r['카테고리'] || ''),
    subcategory: String(r['세부항목'] || ''),
    merchant: String(r['가맹점'] || ''),
    description: String(r['내용'] || ''),
    payment_method: String(r['결제수단'] || ''),
    member_id: memberIdByName_(members, String(r['사용자'])),
    fixed: String(r['고정']) === FIXED,
    tags: splitTags_(r['태그']),
    memo: String(r['메모'] || ''),
    source: r['입력방식'] === '자동' ? 'upload' : 'manual',
    upload_id: Number(r['업로드ID']) || null,
    created_by_name: String(r['입력자'] || ''),
    _row: r._row,
  };
}

function allTx_() {
  var cats = categories_();
  var members = members_();
  return read_('tx').map(function (r) { return txFromRow_(r, cats, members); });
}

function validateTx_(t) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date || '')) throw httpError_(400, '날짜 형식이 올바르지 않습니다.');
  if (!TYPE_KO[t.type]) throw httpError_(400, '구분이 올바르지 않습니다.');
  if (!(Number(t.amount) > 0)) throw httpError_(400, '금액을 확인해 주세요.');
}

/** 화면용 거래 객체 → 시트 행 */
function txToRow_(t, cats, members, extra) {
  var cat = cats.filter(function (c) { return c.id === Number(t.category_id); })[0];
  return Object.assign(
    {
      날짜: t.date,
      구분: TYPE_KO[t.type],
      금액: Math.round(Math.abs(Number(t.amount))),
      카테고리: cat ? cat.name : '',
      세부항목: t.subcategory || '',
      가맹점: t.merchant || '',
      내용: t.description || '',
      결제수단: t.payment_method || '',
      사용자: memberNameById_(members, t.member_id),
      고정: t.fixed || (cat && cat.name === FIXED_CATEGORY) ? FIXED : '',
      태그: splitTags_(t.tags).join(', '),
      메모: t.memo || '',
    },
    extra,
  );
}

function splitTags_(v) {
  var list = Array.isArray(v) ? v : String(v || '').split(',');
  var out = [];
  list.forEach(function (t) {
    t = String(t).replace(/^#/, '').trim();
    if (t && out.indexOf(t) < 0) out.push(t);
  });
  return out;
}

/** 가맹점명에서 규칙 키워드를 만든다. 지점명/괄호/숫자를 떼서 "스타벅스 강남점" → "스타벅스". */
function merchantKey_(merchant) {
  return String(merchant)
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/(주식회사|㈜)/g, '')
    .replace(/\s*[가-힣A-Za-z0-9]*점$/, '')
    .replace(/[0-9\-_*#]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(' ');
}

function learnRule_(merchant, type, categoryName, subcategory) {
  var key = merchantKey_(merchant);
  if (!key || key.length < 2 || !categoryName) return;
  var rules = read_('rule');
  var row = { 키워드: key, 구분: TYPE_KO[type], 카테고리: categoryName, 세부항목: subcategory || '', 수정일시: now_() };
  var existing = rules.filter(function (r) { return String(r['키워드']) === key; })[0];
  if (existing) writeRow_('rule', existing._row, row);
  else append_('rule', [row]);
}

function rules_() {
  return read_('rule').map(function (r) {
    return { keyword: String(r['키워드']), type: KO_TYPE[r['구분']] || 'expense', category: String(r['카테고리']), subcategory: String(r['세부항목'] || ''), updated: String(r['수정일시']) };
  });
}

// ---------------------------------------------------------------- 라우터

function parseQuery_(qs) {
  var q = {};
  (qs || '').split('&').forEach(function (kv) {
    if (!kv) return;
    var i = kv.indexOf('=');
    var k = decodeURIComponent(i < 0 ? kv : kv.slice(0, i));
    q[k] = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
  });
  return q;
}

function route_(method, path, body) {
  var qi = path.indexOf('?');
  var p = qi < 0 ? path : path.slice(0, qi);
  var q = parseQuery_(qi < 0 ? '' : path.slice(qi + 1));
  var seg = p.split('/').filter(String);
  var M = method.toUpperCase();
  var key = M + ' /' + seg[0] + (seg[1] ? '/' + seg[1] : '');

  // 로그인 전에도 쓰는 두 경로
  if (key === 'GET /me') return me_();
  if (key === 'POST /setup') return setup_(body);

  var me = requireMember_();
  ensurePreset_();
  var id = seg[1];

  switch (M + ' /' + seg[0]) {
    case 'GET /categories':
      return categories_().map(stripRow_);
    case 'POST /categories':
      return withLock_(function () { return createCategory_(body); });
    case 'PUT /categories':
      return withLock_(function () { return updateCategory_(Number(id), body); });
    case 'DELETE /categories':
      return withLock_(function () { return deleteCategory_(Number(id)); });

    case 'GET /budgets':
      return budgets_();
    case 'PUT /budgets':
      return withLock_(function () { return saveBudgets_(body.items || []); });

    case 'GET /transactions':
      return listTx_(q);
    case 'POST /transactions':
      return withLock_(function () { return createTx_(body, me); });
    case 'PUT /transactions':
      return withLock_(function () { return updateTx_(Number(id), body); });
    case 'DELETE /transactions':
      return withLock_(function () { return deleteTx_(Number(id)); });

    case 'GET /analysis-context':
      return analysisContext_();
    case 'POST /uploads':
      if (id === 'prepare') return prepareUpload_(body);
      if (id === 'commit') return withLock_(function () { return commitUpload_(body, me); });
      break;
    case 'GET /uploads':
      return read_('upload').reverse().slice(0, 50).map(function (u) {
        return { id: Number(u.ID), created_at: String(u['일시']), filenames: String(u['파일']), doc_type: String(u['문서종류']), summary: String(u['요약']), created_by_name: String(u['올린사람']), tx_count: Number(u['저장건수']) || 0 };
      });

    case 'GET /annual':
      return annualStats_(Number(q.year) || Number(Utilities.formatDate(new Date(), tz_(), 'yyyy')));
    case 'GET /stats':
      return monthlyStats_(q.month, q.member_id === 'shared' ? 'shared' : q.member_id ? Number(q.member_id) : undefined);

    case 'GET /rules':
      return rules_();
    case 'DELETE /rules':
      return withLock_(function () {
        var kw = decodeURIComponent(id);
        deleteRows_('rule', read_('rule').filter(function (r) { return String(r['키워드']) === kw; }).map(function (r) { return r._row; }));
        return true;
      });

    case 'POST /members':
      return withLock_(function () { return addMember_(body); });
    case 'PUT /settings':
      return saveSettings_(body);
    case 'GET /reports':
      return { year: reportYear_(), years: txYears_() };
    case 'POST /reports':
      return withLock_(function () { return rebuildReports_(Number(body.year) || null); });
  }
  throw httpError_(404, '알 수 없는 요청: ' + M + ' ' + p);
}

// ---------------------------------------------------------------- 핸들러

function me_() {
  var email = currentEmail_();
  var members = members_();
  var p = props_();
  var base = { email: email, sheetUrl: ss_().getUrl() };
  if (!members.length) return Object.assign(base, { state: 'setup' });
  var me = members.filter(function (m) { return m.email === email; })[0];
  if (!me) return Object.assign(base, { state: 'not_member' });
  return Object.assign(base, {
    state: 'ok',
    user: { id: me.id, name: me.name, email: me.email },
    household: { name: p.getProperty('HOUSEHOLD_NAME') || '우리집 가계부' },
    members: members.map(function (m) { return { id: m.id, name: m.name, email: m.email }; }),
    hasApiKey: !!p.getProperty('ANTHROPIC_API_KEY'),
    apiKeyHint: keyHint_(p.getProperty('ANTHROPIC_API_KEY')),
    model: currentModel_(),
  });
}

/** 저장된 키를 앞 12자 + 뒤 4자만 보여 줘서 콘솔의 키와 맞는지 비교할 수 있게 한다. */
function keyHint_(key) {
  if (!key) return null;
  return key.length > 20 ? key.slice(0, 12) + '…' + key.slice(-4) + ' (' + key.length + '자)' : '(' + key.length + '자 — 너무 짧아요)';
}

function setup_(body) {
  return withLock_(function () {
    if (members_().length) throw httpError_(409, '이미 설정된 가계부예요.');
    var email = currentEmail_();
    if (!body.name) throw httpError_(400, '이름을 입력해 주세요.');
    seedCategories_();
    ['tx', 'budget', 'rule', 'upload'].forEach(sheet_);
    append_('member', [{ ID: 1, 이메일: email, 이름: body.name, 추가일시: now_() }]);
    if (body.householdName) props_().setProperty('HOUSEHOLD_NAME', body.householdName);
    if (body.apiKey) props_().setProperty('ANTHROPIC_API_KEY', cleanKey_(body.apiKey));
    // 시트를 처음 만들 때 생긴 빈 기본 탭은 정리한다.
    var ours = Object.keys(SHEETS).map(function (k) { return SHEETS[k].name; });
    ss_().getSheets().forEach(function (sh) {
      if (ours.indexOf(sh.getName()) < 0 && sh.getLastRow() <= 1) ss_().deleteSheet(sh);
    });
    rebuildReports_();
    return true;
  });
}

function addMember_(body) {
  var email = String(body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email) || !body.name) throw httpError_(400, '이름과 구글 계정 이메일을 입력해 주세요.');
  var members = members_();
  if (members.some(function (m) { return m.email === email; })) throw httpError_(409, '이미 구성원이에요.');
  append_('member', [{ ID: nextId_(read_('member')), 이메일: email, 이름: body.name, 추가일시: now_() }]);
  // 웹 앱이 "접속한 사용자 권한"으로 실행되므로 배우자도 이 시트의 편집 권한이 있어야 한다.
  var shared = true;
  try {
    ss_().addEditor(email);
  } catch (e) {
    shared = false;
  }
  return { shared: shared };
}

function currentModel_() {
  var m = props_().getProperty('CLAUDE_MODEL');
  return MODELS.indexOf(m) >= 0 ? m : DEFAULT_MODEL;
}

function cleanKey_(k) {
  return String(k || '').replace(/[\s"'`]/g, '');
}

function saveSettings_(body) {
  if (body.apiKey) props_().setProperty('ANTHROPIC_API_KEY', cleanKey_(body.apiKey));
  if (body.householdName) props_().setProperty('HOUSEHOLD_NAME', body.householdName);
  if (body.model) {
    if (MODELS.indexOf(body.model) < 0) throw httpError_(400, '지원하지 않는 모델이에요.');
    props_().setProperty('CLAUDE_MODEL', body.model);
  }
  return true;
}

function createCategory_(body) {
  if (!body.name || !TYPE_KO[body.type]) throw httpError_(400, '입력값을 확인해 주세요.');
  var cats = categories_();
  if (findCategory_(cats, body.type, body.name)) throw httpError_(409, '같은 이름의 카테고리가 있어요.');
  var rows = read_('cat');
  var id = nextId_(rows);
  append_('cat', [{ ID: id, 구분: TYPE_KO[body.type], 이름: body.name, 아이콘: body.icon || '🏷️', 색: body.color || '#9ca3af', 세부항목: (body.subcategories || []).join(', '), 순서: rows.length + 1 }]);
  return { id: id };
}

function updateCategory_(id, body) {
  var c = categories_().filter(function (x) { return x.id === id; })[0];
  if (!c) throw httpError_(404, '카테고리를 찾을 수 없어요.');
  var newName = body.name || c.name;
  if (newName !== c.name) {
    // 거래내역/규칙/예산은 카테고리 이름으로 저장되므로 이름을 바꾸면 함께 바꾼다.
    renameIn_('tx', '카테고리', c.name, newName, function (r) { return KO_TYPE[r['구분']] === c.type; });
    renameIn_('rule', '카테고리', c.name, newName, function (r) { return KO_TYPE[r['구분']] === c.type; });
    if (c.type === 'expense') renameIn_('budget', '카테고리', c.name, newName, function () { return true; });
  }
  writeRow_('cat', c._row, {
    ID: c.id,
    구분: TYPE_KO[c.type],
    이름: newName,
    아이콘: body.icon !== undefined ? body.icon : c.icon,
    색: body.color || c.color,
    세부항목: (body.subcategories || c.subcategories).join(', '),
    순서: c.sort,
  });
  rebuildReports_();
  return true;
}

function renameIn_(key, col, from, to, match) {
  var sh = sheet_(key);
  var colIdx = SHEETS[key].headers.indexOf(col) + 1;
  read_(key).forEach(function (r) {
    if (String(r[col]) === from && match(r)) sh.getRange(r._row, colIdx).setValue(to);
  });
}

function deleteCategory_(id) {
  var c = categories_().filter(function (x) { return x.id === id; })[0];
  if (!c) return true;
  // 기존 거래는 남기고 카테고리만 비운다(미분류).
  renameIn_('tx', '카테고리', c.name, '', function (r) { return KO_TYPE[r['구분']] === c.type; });
  deleteRows_('rule', read_('rule').filter(function (r) { return String(r['카테고리']) === c.name && KO_TYPE[r['구분']] === c.type; }).map(function (r) { return r._row; }));
  if (c.type === 'expense') deleteRows_('budget', read_('budget').filter(function (r) { return String(r['카테고리']) === c.name; }).map(function (r) { return r._row; }));
  deleteRows_('cat', [c._row]);
  rebuildReports_();
  return true;
}

function budgets_() {
  var cats = categories_();
  return read_('budget')
    .map(function (b) {
      var c = findCategory_(cats, 'expense', String(b['카테고리']));
      return c ? { category_id: c.id, amount: Number(b['월 예산']) || 0 } : null;
    })
    .filter(Boolean);
}

function saveBudgets_(items) {
  var cats = categories_();
  var rows = read_('budget');
  items.forEach(function (it) {
    var c = cats.filter(function (x) { return x.id === Number(it.category_id); })[0];
    if (!c) return;
    var existing = rows.filter(function (r) { return String(r['카테고리']) === c.name; })[0];
    var amount = Math.round(Number(it.amount) || 0);
    if (existing && amount > 0) writeRow_('budget', existing._row, { 카테고리: c.name, '월 예산': amount });
    else if (!existing && amount > 0) append_('budget', [{ 카테고리: c.name, '월 예산': amount }]);
  });
  // 0으로 지운 예산은 마지막에 한꺼번에 삭제(행 번호가 밀리지 않게)
  var remove = [];
  items.forEach(function (it) {
    var c = cats.filter(function (x) { return x.id === Number(it.category_id); })[0];
    if (!c || Number(it.amount) > 0) return;
    rows.forEach(function (r) { if (String(r['카테고리']) === c.name) remove.push(r._row); });
  });
  deleteRows_('budget', remove);
  return true;
}

function listTx_(q) {
  var rows = allTx_().filter(function (t) {
    if (q.month && t.date.slice(0, 7) !== q.month) return false;
    if (q.type && t.type !== q.type) return false;
    if (q.category_id && t.category_id !== Number(q.category_id)) return false;
    if (q.member_id === 'shared' && t.member_id !== null) return false;
    if (q.member_id && q.member_id !== 'shared' && t.member_id !== Number(q.member_id)) return false;
    if (q.tag && t.tags.indexOf(q.tag) < 0) return false;
    if (q.fixed === '1' && !t.fixed) return false;
    if (q.q) {
      var s = (t.merchant + ' ' + t.description + ' ' + t.memo + ' ' + t.tags.join(' ')).toLowerCase();
      if (s.indexOf(q.q.toLowerCase()) < 0) return false;
    }
    return true;
  });
  rows.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id; });
  return rows.slice(0, 2000).map(stripRow_);
}

function createTx_(t, me) {
  validateTx_(t);
  var cats = categories_();
  var members = members_();
  var id = nextId_(read_('tx'));
  var row = txToRow_(t, cats, members, { ID: id, 입력방식: '수기', 입력자: me.name, 입력일시: now_(), 수정일시: now_() });
  append_('tx', [row]);
  if (t.merchant && row['카테고리']) learnRule_(t.merchant, t.type, row['카테고리'], row['세부항목']);
  refreshReports_([t.date.slice(0, 7)]);
  return { id: id };
}

function updateTx_(id, t) {
  validateTx_(t);
  var before = read_('tx').filter(function (r) { return Number(r.ID) === id; })[0];
  if (!before) throw httpError_(404, '내역을 찾을 수 없습니다.');
  var row = txToRow_(t, categories_(), members_(), {
    ID: id,
    입력방식: before['입력방식'],
    업로드ID: before['업로드ID'],
    입력자: before['입력자'],
    입력일시: before['입력일시'],
    수정일시: now_(),
  });
  writeRow_('tx', before._row, row);
  // 사용자가 분류를 고쳤으면 다음부터 같은 가맹점은 그렇게 분류한다.
  if (t.merchant && row['카테고리'] && (String(before['카테고리']) !== row['카테고리'] || String(before['세부항목']) !== row['세부항목'])) {
    learnRule_(t.merchant, t.type, row['카테고리'], row['세부항목']);
  }
  refreshReports_([ymd_(before['날짜']).slice(0, 7), t.date.slice(0, 7)]);
  return true;
}

function deleteTx_(id) {
  var rows = read_('tx').filter(function (r) { return Number(r.ID) === id; });
  deleteRows_('tx', rows.map(function (r) { return r._row; }));
  refreshReports_(rows.map(function (r) { return ymd_(r['날짜']).slice(0, 7); }));
  return true;
}

function txYears_() {
  var years = {};
  allTx_().forEach(function (t) { years[t.date.slice(0, 4)] = true; });
  years[Utilities.formatDate(new Date(), tz_(), 'yyyy')] = true;
  return Object.keys(years).map(Number).sort();
}

// ---------------------------------------------------------------- AI 업로드

function analysisContext_() {
  var apiKey = props_().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) throw httpError_(400, 'Anthropic API 키가 설정되지 않았어요. 설정 화면에서 입력해 주세요.');
  var cats = categories_();
  var names = [];
  cats.forEach(function (c) { if (names.indexOf(c.name) < 0) names.push(c.name); });
  return {
    apiKey: apiKey,
    model: currentModel_(),
    system: systemPrompt_(cats, rules_()),
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['document_type', 'summary', 'transactions'],
      properties: {
        document_type: { type: 'string' },
        summary: { type: 'string' },
        transactions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['date', 'type', 'amount', 'merchant', 'description', 'category', 'subcategory', 'payment_method', 'fixed', 'source_file', 'confidence', 'note'],
            properties: {
              date: { type: 'string' },
              type: { type: 'string', enum: ['expense', 'income', 'saving', 'transfer'] },
              amount: { type: 'number' },
              merchant: { type: 'string' },
              description: { type: 'string' },
              category: { type: 'string', enum: names },
              subcategory: { type: 'string' },
              payment_method: { type: 'string' },
              fixed: { type: 'boolean' },
              source_file: { type: 'string' },
              confidence: { type: 'number' },
              note: { type: 'string' },
            },
          },
        },
      },
    },
  };
}

function systemPrompt_(cats, rules) {
  function list(type) {
    return cats
      .filter(function (c) { return c.type === type; })
      .map(function (c) { return '- ' + c.name + (c.subcategories.length ? ': ' + c.subcategories.join(', ') : ''); })
      .join('\n');
  }
  var ruleText = rules.length
    ? '## 이 가구가 직접 지정한 가맹점 규칙 (최우선 적용)\n' +
      rules.slice(0, 300).map(function (r) { return '- "' + r.keyword + '" → ' + r.category + (r.subcategory ? ' / ' + r.subcategory : ''); }).join('\n') + '\n'
    : '';
  var today = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  return [
    '당신은 한국 가정의 가계부 정리를 돕는 회계 도우미입니다. 사용자가 올린 은행/카드 거래내역서(PDF·엑셀·CSV), 영수증, 아파트 관리비 고지서, 급여명세서 등의 스크린샷이나 문서에서 거래를 빠짐없이 뽑아 분류합니다.',
    '',
    '## 분류 기준',
    'type은 넷 중 하나입니다.',
    '- expense(지출): 실제로 돈을 쓴 것. 대출 이자는 지출입니다.',
    '- income(수입): 급여, 이자, 환급 등 들어온 돈.',
    '- saving(저축): 미래를 위해 모으는 돈. 적금·예금·청약 납입, 증권/연금/IRP/공제회 계좌로 넣은 돈, 대출 원금 상환.',
    '- transfer(이체): 통계에서 빠지는 단순한 돈의 이동. 신용카드 대금 출금, 본인/배우자 명의 생활비 계좌 간 이체. 카드대금을 지출로 잡으면 카드 내역과 이중으로 집계되므로 반드시 transfer로 분류하세요.',
    '',
    'fixed는 매달 정해진 날 거의 같은 금액이 나가는 고정지출이면 true입니다(월세, 관리비, 통신비, 보험료, 구독료, 대출이자, 정기 학원비, 정기후원, 자동이체 적금 등). 장보기·외식처럼 그때그때 쓰는 돈은 false입니다.',
    '',
    'category는 아래 목록의 이름 중 하나를 정확히 그대로 쓰고, subcategory는 해당 카테고리의 세부항목 중 하나(없으면 빈 문자열)를 씁니다.',
    '',
    '지출 카테고리:\n' + list('expense'),
    '',
    '수입 카테고리:\n' + list('income'),
    '',
    '저축 카테고리:\n' + list('saving'),
    '',
    '이체 카테고리:\n' + list('transfer'),
    '',
    ruleText,
    '## 문서 유형별 처리',
    '- 은행/카드 거래내역: 한 줄이 한 거래입니다. 출금은 expense 또는 transfer, 입금은 income 또는 transfer입니다. 승인 취소(취소/환불) 건은 원거래와 상쇄되도록 income/환급/지원금/환불로 기록하세요. 잔액, 합계, 소계 줄은 거래가 아니므로 제외합니다.',
    '- 아파트 관리비 고지서: 고정지출 아래로, 전기·수도·가스·난방·급탕 같은 세대 사용료는 "공과금", 일반관리비·경비·청소·승강기 같은 공용 항목은 "관리비"로 묶어 기록하세요. 항목 합계는 고지서의 당월 부과액과 같아야 합니다. 날짜는 납부 마감일(없으면 고지 월의 말일)을 씁니다. 연체료·미납액 같은 이전 달 금액은 제외합니다.',
    '- 고정지출 대분류: 월세·대출이자(주거비), 관리비, 전기·가스·수도(공과금), 보험료, 휴대폰·인터넷(통신비), OTT·멤버십 등 정기결제(구독료)는 다른 대분류보다 "고정지출"을 우선합니다.',
    '- 용돈: 부부 각자 쓰는 개인 용돈. 소분류는 "용돈"입니다.',
    '- 영수증: 결제 1건을 하나의 거래로 기록합니다. 품목이 여러 카테고리에 걸쳐 크게 나뉘면(예: 마트에서 식료품과 가전) 나눠도 됩니다.',
    '- 급여명세서: 실수령액을 급여 수입 1건으로 기록합니다.',
    '- 여러 파일을 함께 올렸을 때 같은 결제가 두 곳에 나오면(예: 영수증 사진과 카드 이용내역) 한 번만 기록하고, 날짜·결제수단은 카드/은행 내역을 따릅니다.',
    '',
    '## 형식',
    '- date는 YYYY-MM-DD. 연도가 없으면 문서의 다른 날짜나 오늘(' + today + ')을 기준으로 가장 그럴듯한 연도를 고릅니다.',
    '- amount는 원 단위의 양의 정수입니다(부호는 type으로 표현).',
    '- merchant는 가맹점/상대방 이름을 문서에 적힌 그대로, description은 무엇에 쓴 돈인지 짧은 한국어 설명입니다.',
    '- payment_method는 카드사/은행/결제수단 이름(예: "신한카드", "국민은행 입출금", "현금")이고 모르면 빈 문자열입니다.',
    '- source_file은 그 거래가 나온 파일 이름입니다([파일: 이름] 표시를 그대로).',
    '- confidence는 분류에 대한 확신도 0~1입니다. 읽기 어렵거나 추측이 섞이면 낮게 주고 note에 이유를 적습니다.',
    '- document_type은 문서 종류(예: "카드 이용내역", "관리비 고지서"), summary는 한두 문장 요약(기간, 건수, 합계)입니다.',
    '- 문서에 거래가 없으면 transactions를 빈 배열로 두고 summary에 이유를 적습니다.',
  ].join('\n');
}

/** Claude가 돌려준 결과를 카테고리 ID로 바꾸고, 가맹점 규칙과 중복 여부를 반영한다. */
function prepareUpload_(body) {
  var ex = body.extraction || {};
  var cats = categories_();
  var rules = rules_();
  var existing = allTx_();
  var memberId = body.member_id ? Number(body.member_id) : null;

  var items = (ex.transactions || []).map(function (t) {
    var type = TYPE_KO[t.type] ? t.type : 'expense';
    var cat =
      findCategory_(cats, type, t.category) ||
      cats.filter(function (c) { return c.name === t.category; })[0] ||
      cats.filter(function (c) { return c.type === type && c.name.indexOf('기타') === 0; })[0] ||
      cats.filter(function (c) { return c.type === type; })[0] ||
      null;
    if (cat && cat.type !== type) type = cat.type;
    var sub = cat && cat.subcategories.indexOf(t.subcategory) >= 0 ? t.subcategory : '';
    // AI가 프롬프트의 규칙을 놓쳤더라도 여기서 한 번 더 강제한다.
    var rule = rules.filter(function (r) { return String(t.merchant || '').indexOf(r.keyword) >= 0; })[0];
    var ruleCat = rule ? findCategory_(cats, rule.type, rule.category) : null;
    if (ruleCat) {
      type = ruleCat.type;
      cat = ruleCat;
      sub = rule.subcategory;
    }
    var amount = Math.round(Math.abs(Number(t.amount) || 0));
    return {
      date: t.date,
      type: type,
      amount: amount,
      category_id: cat ? cat.id : null,
      subcategory: sub,
      merchant: t.merchant || '',
      description: t.description || '',
      payment_method: t.payment_method || '',
      member_id: memberId,
      fixed: !!t.fixed,
      tags: [],
      memo: '',
      confidence: Number(t.confidence) || 0,
      note: t.note || '',
      source_file: t.source_file || '',
      duplicate: null,
      rule_applied: !!ruleCat,
      ai_category_id: cat ? cat.id : null,
      ai_subcategory: sub,
      include: true,
    };
  });
  markDuplicates_(items, existing);
  return { document_type: ex.document_type || '', summary: ex.summary || '', items: items };
}

// ---------------------------------------------------------------- 중복 찾기
//
// 같은 결제가 영수증 사진과 카드 이용내역 등으로 두 번 들어오는 걸 막는다.
// - 카드 내역은 승인일/매입일 차이로 날짜가 1~3일 다를 수 있다
// - 가맹점 표기가 다르다("이마트 해운대점" vs "이마트(주)해운대")
// - 관리비처럼 항목별로 나눠 저장한 것이 카드 내역에서는 합계 한 줄로 나온다(또는 그 반대)
// - 영수증과 카드 내역을 한꺼번에 올리면 같은 업로드 안에서도 겹친다
// strong(확실): 기본으로 빼 둔다. weak(비슷함): 표시만 하고 포함해 둔다.

var DUP_DAYS = 3;
var DUP_GROUP_DAYS = 10;

function dayNum_(ymd) {
  return Math.round(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) / 86400000);
}

function normMerchant_(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]|주식회사|㈜|\(주\)/g, '')
    .replace(/[^0-9a-z가-힣]/g, '')
    .replace(/(점|지점|본점)$/, '');
}

/** 한쪽 이름이 다른 쪽에 들어 있거나, 앞 3글자가 같으면 같은 가맹점으로 본다. */
function similarMerchant_(a, b) {
  var x = normMerchant_(a);
  var y = normMerchant_(b);
  if (!x || !y) return false;
  if (x.indexOf(y) >= 0 || y.indexOf(x) >= 0) return true;
  return x.length >= 3 && y.length >= 3 && x.slice(0, 3) === y.slice(0, 3);
}

function describeTx_(t) {
  return t.date + ' ' + (t.merchant || t.description || '') + ' ' + t.amount.toLocaleString('ko-KR') + '원' + (t.created_by_name ? ' (' + t.created_by_name + ' 입력)' : '');
}

function markDuplicates_(items, existing) {
  var used = {};

  // 1) 기존 내역과 1:1 비교
  items.forEach(function (it) {
    var best = null;
    existing.forEach(function (t) {
      if (used[t.id] || t.type !== it.type || t.amount !== it.amount) return;
      var gap = Math.abs(dayNum_(t.date) - dayNum_(it.date));
      if (gap > DUP_DAYS) return;
      var same = similarMerchant_(t.merchant, it.merchant);
      var level = same || (gap === 0 && it.amount >= 10000) ? 'strong' : 'weak';
      var score = (level === 'strong' ? 0 : 10) + gap;
      if (!best || score < best.score) best = { t: t, level: level, score: score, gap: gap };
    });
    if (best) {
      used[best.t.id] = true;
      it.duplicate = {
        level: best.level,
        of_id: best.t.id,
        reason: (best.level === 'strong' ? '이미 있는 내역: ' : '비슷한 내역이 있어요: ') + describeTx_(best.t) + (best.gap ? ' · ' + best.gap + '일 차이' : ''),
      };
    }
  });

  // 2) 새 한 줄 = 기존에 항목별로 나눠 저장한 한 업로드의 합계 (예: 관리비 고지서 → 카드 내역의 관리비 한 줄)
  var groups = {};
  existing.forEach(function (t) {
    if (!t.upload_id || t.type !== 'expense' || used[t.id]) return;
    var g = (groups[t.upload_id] = groups[t.upload_id] || { ids: [], sum: 0, date: t.date, merchant: t.merchant });
    g.ids.push(t.id);
    g.sum += t.amount;
    if (t.date > g.date) g.date = t.date;
  });
  items.forEach(function (it) {
    if (it.duplicate || it.type !== 'expense') return;
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      if (it.duplicate || g.ids.length < 2 || g.sum !== it.amount) return;
      if (Math.abs(dayNum_(g.date) - dayNum_(it.date)) > DUP_GROUP_DAYS) return;
      g.ids.forEach(function (id) { used[id] = true; });
      it.duplicate = { level: 'strong', of_id: null, reason: '이미 항목별로 나눠 저장한 내역(' + g.merchant + ' 외 ' + (g.ids.length - 1) + '건)의 합계와 같아요.' };
    });
  });

  // 3) 새 항목 여러 개의 합계 = 기존 한 줄 (예: 카드 내역을 먼저 올리고 관리비 고지서를 나중에 올림)
  var fresh = items.filter(function (it) { return !it.duplicate && it.type === 'expense'; });
  if (fresh.length >= 2) {
    var total = fresh.reduce(function (a, it) { return a + it.amount; }, 0);
    var match = existing.filter(function (t) {
      return !used[t.id] && t.type === 'expense' && t.amount === total &&
        fresh.some(function (it) { return Math.abs(dayNum_(t.date) - dayNum_(it.date)) <= DUP_GROUP_DAYS; });
    })[0];
    if (match) {
      used[match.id] = true;
      fresh.forEach(function (it) {
        it.duplicate = { level: 'weak', of_id: null, reason: '이번 항목들의 합계가 이미 있는 내역과 같아요: ' + describeTx_(match) + '. 항목별로 보려면 기존 내역을 지우고 이걸 저장하세요.' };
      });
    }
  }

  // 4) 같이 올린 파일끼리 겹침 (AI가 한 번만 쓰라는 지시를 놓친 경우)
  items.forEach(function (it, i) {
    if (it.duplicate) return;
    for (var j = 0; j < i; j++) {
      var o = items[j];
      if (o.type !== it.type || o.amount !== it.amount || !it.source_file || o.source_file === it.source_file) continue;
      if (Math.abs(dayNum_(o.date) - dayNum_(it.date)) > DUP_DAYS) continue;
      it.duplicate = { level: 'strong', of_id: null, reason: '같이 올린 ' + o.source_file + '에 같은 결제가 있어요 (' + (o.merchant || o.date) + ').' };
      return;
    }
  });

  items.forEach(function (it) { it.include = !(it.duplicate && it.duplicate.level === 'strong'); });
}

function fillFromSkipped_(skipped) {
  if (!skipped.length) return 0;
  var rows = read_('tx');
  var col = SHEETS.tx.headers.indexOf('결제수단') + 1;
  var sh = sheet_('tx');
  var n = 0;
  skipped.forEach(function (i) {
    if (!i.payment_method) return;
    var r = rows.filter(function (x) { return Number(x.ID) === Number(i.duplicate.of_id); })[0];
    if (r && !r['결제수단']) {
      sh.getRange(r._row, col).setValue(i.payment_method);
      n++;
    }
  });
  return n;
}

function commitUpload_(body, me) {
  // 중복이라 건너뛴 항목에 결제수단 정보가 있으면 기존 내역의 빈 결제수단을 채운다(영수증 → 카드내역 순으로 올린 경우).
  var filled = fillFromSkipped_((body.items || []).filter(function (i) { return !i.include && i.duplicate && i.duplicate.of_id; }));
  var items = (body.items || []).filter(function (i) { return i.include; });
  items.forEach(function (i) {
    try {
      validateTx_(i);
    } catch (e) {
      throw httpError_(400, (i.merchant || i.date) + ': ' + e.message);
    }
  });
  var cats = categories_();
  var members = members_();
  var uploadId = nextId_(read_('upload'));
  var id = nextId_(read_('tx'));
  var stamp = now_();
  var rows = items.map(function (i) {
    return txToRow_(i, cats, members, { ID: id++, 입력방식: '자동', 업로드ID: uploadId, 입력자: me.name, 입력일시: stamp, 수정일시: stamp });
  });
  append_('tx', rows);
  items.forEach(function (i, k) {
    if (i.merchant && rows[k]['카테고리'] && (Number(i.category_id) !== Number(i.ai_category_id) || (i.subcategory || '') !== (i.ai_subcategory || ''))) {
      learnRule_(i.merchant, i.type, rows[k]['카테고리'], rows[k]['세부항목']);
    }
  });
  append_('upload', [{ ID: uploadId, 일시: stamp, 파일: (body.filenames || []).join(', '), 문서종류: body.document_type || '', 요약: body.summary || '', 올린사람: me.name, 저장건수: items.length }]);
  refreshReports_((body.items || []).filter(function (i) { return i.include || (filled && i.duplicate); }).map(function (i) { return String(i.date).slice(0, 7); }));
  return { saved: items.length, filled: filled };
}

// ---------------------------------------------------------------- 통계

function shiftMonth_(month, delta) {
  var y = Number(month.slice(0, 4));
  var m = Number(month.slice(5, 7)) - 1 + delta;
  y += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  return y + '-' + (m < 9 ? '0' : '') + (m + 1);
}

function daysInMonth_(month) {
  return new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
}

function filterMember_(list, member) {
  return list.filter(function (t) {
    if (member === undefined) return true;
    if (member === 'shared') return t.member_id === null;
    return t.member_id === member;
  });
}

function sumType_(list, type) {
  return list.filter(function (t) { return t.type === type; }).reduce(function (a, t) { return a + t.amount; }, 0);
}

function groupBy_(list, keyFn) {
  var g = {};
  list.forEach(function (t) {
    var k = keyFn(t);
    g[k] = g[k] || { amount: 0, count: 0 };
    g[k].amount += t.amount;
    g[k].count += 1;
  });
  return g;
}

/** 저축률 = 저축 ÷ 수입. 남은 돈 = 수입 − 지출 − 저축 */
function summary_(list) {
  var income = sumType_(list, 'income');
  var expense = sumType_(list, 'expense');
  var saving = sumType_(list, 'saving');
  return {
    income: income,
    expense: expense,
    saving: saving,
    net: income - expense - saving,
    savingsRate: income ? Math.round((saving / income) * 1000) / 10 : null,
  };
}

function monthlyStats_(month, member) {
  month = month || Utilities.formatDate(new Date(), tz_(), 'yyyy-MM');
  var cats = categories_();
  var members = members_();
  var all = allTx_();
  var mine = filterMember_(all, member);
  function inMonth(list, m) { return list.filter(function (t) { return t.date.slice(0, 7) === m; }); }

  var cur = inMonth(mine, month);
  var prevMonth = shiftMonth_(month, -1);
  var prev = inMonth(mine, prevMonth);
  var sum = summary_(cur);

  var budgets = {};
  if (member === undefined) budgets_().forEach(function (b) { budgets[b.category_id] = b.amount; });

  var curExp = cur.filter(function (t) { return t.type === 'expense'; });
  var prevCat = groupBy_(prev.filter(function (t) { return t.type === 'expense'; }), function (t) { return String(t.category_id); });
  var last3 = mine.filter(function (t) {
    var m = t.date.slice(0, 7);
    return t.type === 'expense' && m >= shiftMonth_(month, -3) && m <= prevMonth;
  });
  var avg3 = groupBy_(last3, function (t) { return String(t.category_id); });

  function categoryRows(list) {
    var g = groupBy_(list, function (t) { return String(t.category_id); });
    return Object.keys(g)
      .map(function (k) {
        var c = cats.filter(function (x) { return String(x.id) === k; })[0];
        return {
          id: c ? c.id : null,
          name: c ? c.name : '미분류',
          icon: c ? c.icon : '',
          color: c ? c.color : '#9ca3af',
          amount: g[k].amount,
          count: g[k].count,
          budget: c && budgets[c.id] ? budgets[c.id] : null,
          prevAmount: prevCat[k] ? prevCat[k].amount : 0,
        };
      })
      .sort(function (a, b) { return b.amount - a.amount; });
  }
  var byCategory = categoryRows(curExp);
  var bySaving = categoryRows(cur.filter(function (t) { return t.type === 'saving'; })).map(function (c) {
    return { id: c.id, name: c.name, icon: c.icon, amount: c.amount, count: c.count };
  });

  var subGroups = groupBy_(curExp, function (t) { return (t.category_name || '미분류') + '|' + t.subcategory; });
  var bySubcategory = Object.keys(subGroups)
    .map(function (k) { var p = k.split('|'); return { category: p[0], subcategory: p[1], amount: subGroups[k].amount }; })
    .sort(function (a, b) { return b.amount - a.amount; });

  // 사람별 합계는 보기 전환과 무관하게 항상 가구 전체 기준
  var everyone = inMonth(all, month);
  var byMember = [{ id: null, name: SHARED }].concat(members).map(function (m) {
    var list = everyone.filter(function (t) { return t.member_id === m.id; });
    return { name: m.name, expense: sumType_(list, 'expense'), income: sumType_(list, 'income'), saving: sumType_(list, 'saving') };
  }).filter(function (m) { return m.expense || m.income || m.saving; });

  var payGroups = groupBy_(curExp, function (t) { return t.payment_method || '미입력'; });
  var byPayment = Object.keys(payGroups)
    .map(function (k) { return { method: k, amount: payGroups[k].amount, count: payGroups[k].count }; })
    .sort(function (a, b) { return b.amount - a.amount; });

  var fixedExpense = curExp.filter(function (t) { return t.fixed; }).reduce(function (a, t) { return a + t.amount; }, 0);

  var tagGroups = {};
  curExp.forEach(function (t) {
    t.tags.forEach(function (tag) {
      tagGroups[tag] = tagGroups[tag] || { tag: tag, amount: 0, count: 0 };
      tagGroups[tag].amount += t.amount;
      tagGroups[tag].count += 1;
    });
  });
  var byTag = Object.keys(tagGroups).map(function (k) { return tagGroups[k]; }).sort(function (a, b) { return b.amount - a.amount; });

  // 달력: 날짜별 지출/수입, 무지출일(오늘까지 지난 날 중 지출이 없는 날)
  var todayStr = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  var calendar = [];
  var noSpendDays = 0;
  for (var d = 1; d <= daysInMonth_(month); d++) {
    var date = month + '-' + (d < 10 ? '0' : '') + d;
    var day = cur.filter(function (t) { return t.date === date; });
    var exp = sumType_(day, 'expense');
    var past = date <= todayStr;
    if (past && exp === 0) noSpendDays++;
    calendar.push({ date: date, expense: exp, income: sumType_(day, 'income'), saving: sumType_(day, 'saving'), noSpend: past && exp === 0, future: !past });
  }

  var trend = [];
  for (var i = 11; i >= 0; i--) {
    var m = shiftMonth_(month, -i);
    var ms = summary_(inMonth(mine, m));
    trend.push({ month: m, income: ms.income, expense: ms.expense, saving: ms.saving });
  }

  var merchGroups = groupBy_(curExp.filter(function (t) { return t.merchant; }), function (t) { return t.merchant; });
  var topMerchants = Object.keys(merchGroups)
    .map(function (k) { return { merchant: k, amount: merchGroups[k].amount, count: merchGroups[k].count }; })
    .sort(function (a, b) { return b.amount - a.amount; })
    .slice(0, 7);

  // 직전 3개월 평균 대비 크게 늘었거나 예산을 넘긴 카테고리
  var insights = [];
  byCategory.forEach(function (c) {
    var a = avg3[String(c.id)] ? avg3[String(c.id)].amount / 3 : 0;
    if (a > 0 && c.amount > a * 1.3 && c.amount - a > 50000) {
      insights.push({ level: 'warn', text: c.name + ' 지출이 최근 3개월 평균보다 ' + Math.round((c.amount / a - 1) * 100) + '% 많아요.' });
    }
    if (c.budget && c.amount > c.budget) insights.push({ level: 'warn', text: c.name + ' 예산을 ' + (c.amount - c.budget).toLocaleString('ko-KR') + '원 초과했어요.' });
  });
  if (sum.expense && sum.net < 0) insights.push({ level: 'warn', text: '이번 달은 들어온 돈보다 ' + (-sum.net).toLocaleString('ko-KR') + '원 더 썼어요.' });
  var regret = tagGroups['반성'];
  if (regret) insights.push({ level: 'info', text: '#반성 태그 ' + regret.count + '건, ' + regret.amount.toLocaleString('ko-KR') + '원이에요.' });
  if (noSpendDays >= 5) insights.push({ level: 'good', text: '무지출 데이 ' + noSpendDays + '일! 잘하고 있어요.' });

  return {
    month: month,
    income: sum.income,
    expense: sum.expense,
    saving: sum.saving,
    net: sum.net,
    savingsRate: sum.savingsRate,
    count: cur.length,
    fixedExpense: fixedExpense,
    prev: summary_(prev),
    byCategory: byCategory,
    bySaving: bySaving,
    bySubcategory: bySubcategory,
    byMember: byMember,
    byPayment: byPayment,
    byTag: byTag,
    calendar: calendar,
    noSpendDays: noSpendDays,
    trend: trend,
    topMerchants: topMerchants,
    insights: insights,
  };
}

/** 연간 리포트: 구분별 카테고리 × 12개월 표, 합계와 (기록이 있는 달 기준) 월평균 */
function annualStats_(year) {
  var cats = categories_();
  var all = allTx_().filter(function (t) { return t.date.slice(0, 4) === String(year); });
  var months = [];
  for (var m = 1; m <= 12; m++) months.push(year + '-' + (m < 10 ? '0' : '') + m);
  var activeMonths = months.filter(function (m) { return all.some(function (t) { return t.date.slice(0, 7) === m; }); }).length || 1;

  function table(type) {
    var list = all.filter(function (t) { return t.type === type; });
    var rows = {};
    list.forEach(function (t) {
      var c = cats.filter(function (x) { return x.id === t.category_id; })[0];
      var key = c ? c.name : '미분류';
      rows[key] = rows[key] || { name: key, icon: c ? c.icon : '', sort: c ? c.sort : 999, months: months.map(function () { return 0; }), total: 0 };
      rows[key].months[Number(t.date.slice(5, 7)) - 1] += t.amount;
      rows[key].total += t.amount;
    });
    var out = Object.keys(rows).map(function (k) {
      var r = rows[k];
      return { name: r.name, icon: r.icon, months: r.months, total: r.total, average: Math.round(r.total / activeMonths), sort: r.sort };
    });
    out.sort(function (a, b) { return a.sort - b.sort; });
    return out.map(function (r) { delete r.sort; return r; });
  }

  var totals = months.map(function (m) {
    var s = summary_(all.filter(function (t) { return t.date.slice(0, 7) === m; }));
    return { month: m, income: s.income, expense: s.expense, saving: s.saving, net: s.net };
  });
  var year_ = summary_(all);
  return {
    year: year,
    activeMonths: activeMonths,
    income: year_.income,
    expense: year_.expense,
    saving: year_.saving,
    net: year_.net,
    savingsRate: year_.savingsRate,
    totals: totals,
    incomeTable: table('income'),
    expenseTable: table('expense'),
    savingTable: table('saving'),
  };
}
