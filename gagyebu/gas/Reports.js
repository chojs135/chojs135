/**
 * 구글 시트 보고서 탭 — 참고용 엑셀 가계부와 같은 구성
 *
 *  통합시트   : 연간 총 수입/저축/지출, 월별 요약, 수입·저축·지출 월별 상세표(대분류·소분류·합계·1~12월·평균), 차트
 *  1월~12월   : 이달의 정리, 결제 수단별, 태그별, 예산 관리, 대분류별 주간 지출 | 무지출 Day 달력 | 고정지출 내역, 전체 내역
 *
 * 원본은 '거래내역' 탭이고 이 탭들은 거래가 바뀔 때마다 다시 그려진다(직접 고친 내용은 지워진다).
 * 수입·용돈은 엑셀의 "월급(솔)/월급(진)"처럼 사람별로 나눠 보여 준다.
 */

var REPORT_ANNUAL = '통합시트';
var PER_MEMBER_CATEGORIES = ['수입', '용돈'];
var NUM_FORMAT = '#,##0;-#,##0;-';
var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
var STYLE = {
  title: { size: 16, bold: true },
  section: { size: 12, bold: true, color: '#3730a3' },
  header: { bold: true, bg: '#eef2ff' },
  total: { bold: true, bg: '#f5f5f4' },
  green: { bg: '#dcfce7' },
  muted: { color: '#6b6a66' },
};

function monthTabName_(m) {
  return m + '월';
}

function reportYear_() {
  return Number(props_().getProperty('REPORT_YEAR')) || Number(Utilities.formatDate(new Date(), tz_(), 'yyyy'));
}

// ---------------------------------------------------------------- 격자(값 + 서식)를 메모리에 그린 뒤 한 번에 쓴다

function colA1_(c) {
  var s = '';
  while (c > 0) {
    var r = (c - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    c = Math.floor((c - 1) / 26);
  }
  return s;
}

function a1_(r, c, nr, nc) {
  return colA1_(c) + r + ':' + colA1_(c + (nc || 1) - 1) + (r + (nr || 1) - 1);
}

function Grid_() {
  this.cells = [];
  this.styles = {}; // 스타일 이름 → A1 범위 목록
  this.maxCol = 1;
}
Grid_.prototype.put = function (r, c, rows) {
  var self = this;
  rows.forEach(function (line, i) {
    var target = (self.cells[r - 1 + i] = self.cells[r - 1 + i] || []);
    line.forEach(function (v, j) { target[c - 1 + j] = v; });
    self.maxCol = Math.max(self.maxCol, c - 1 + line.length);
  });
  return r + rows.length;
};
Grid_.prototype.style = function (name, r, c, nr, nc) {
  (this.styles[name] = this.styles[name] || []).push(a1_(r, c, nr, nc));
};
/** 제목 + 머리줄 + 본문(+ 합계 줄) 표. 다음에 쓸 행 번호를 돌려준다. */
Grid_.prototype.table = function (r, c, title, header, rows, opts) {
  opts = opts || {};
  if (title) {
    this.put(r, c, [[title]]);
    this.style('section', r, c);
    r++;
  }
  this.put(r, c, [header]);
  this.style('header', r, c, 1, header.length);
  r++;
  if (!rows.length) {
    this.put(r, c, [['기록 없음']]);
    this.style('muted', r, c);
    return r + 2;
  }
  var self = this;
  rows.forEach(function (line, i) {
    self.put(r + i, c, [line]);
    if (opts.totalRows && opts.totalRows.indexOf(i) >= 0) self.style('total', r + i, c, 1, header.length);
  });
  return r + rows.length + 1;
};
Grid_.prototype.write = function (sh) {
  var width = this.maxCol;
  var values = [];
  for (var i = 0; i < this.cells.length; i++) {
    var line = this.cells[i] || [];
    var row = [];
    for (var j = 0; j < width; j++) row.push(line[j] === undefined || line[j] === null ? '' : line[j]);
    values.push(row);
  }
  sh.clear();
  if (!values.length) return;
  var all = sh.getRange(1, 1, values.length, width);
  all.setNumberFormat(NUM_FORMAT);
  all.setValues(values);
  var styles = this.styles;
  Object.keys(styles).forEach(function (name) {
    var s = STYLE[name];
    var list = sh.getRangeList(styles[name]);
    if (s.bold) list.setFontWeight('bold');
    if (s.size) list.setFontSize(s.size);
    if (s.bg) list.setBackground(s.bg);
    if (s.color) list.setFontColor(s.color);
  });
};

// ---------------------------------------------------------------- 집계 도우미

function catOrder_(cats, type) {
  return cats.filter(function (c) { return c.type === type; });
}

/** 보고서에서 쓰는 소분류 이름. 수입·용돈은 사람 이름을 붙인다: 월급(지수) */
function subLabel_(t, members) {
  var sub = t.subcategory || '(미지정)';
  if (PER_MEMBER_CATEGORIES.indexOf(t.category_name) >= 0 && t.member_id) {
    var m = members.filter(function (x) { return x.id === t.member_id; })[0];
    if (m) return sub + '(' + m.name + ')';
  }
  return sub;
}

/**
 * 대분류 × 소분류 행을 만든다. bucketOf(t)는 칸 번호(월 0~11, 주 0~5)를 돌려준다.
 * 카테고리 설정에 있는 소분류는 금액이 없어도 보여 준다(엑셀처럼 항목이 고정된 표).
 */
function categoryRows_(list, cats, members, type, buckets, bucketOf) {
  var rows = [];
  var totalRows = [];
  var grand = zeros_(buckets);
  catOrder_(cats, type).concat([{ name: '', subcategories: [] }]).forEach(function (c) {
    var mine = list.filter(function (t) { return t.type === type && (c.name ? t.category_name === c.name : !cats.some(function (x) { return x.type === type && x.name === t.category_name; })); });
    if (!c.name && !mine.length) return;
    var labels = [];
    c.subcategories.forEach(function (s) {
      if (PER_MEMBER_CATEGORIES.indexOf(c.name) < 0) labels.push(s);
    });
    mine.forEach(function (t) {
      var l = subLabel_(t, members);
      if (labels.indexOf(l) < 0) labels.push(l);
    });
    if (!labels.length) labels.push('(미지정)');
    var catTotal = zeros_(buckets);
    labels.forEach(function (label, i) {
      var cells = zeros_(buckets);
      mine.forEach(function (t) {
        if (subLabel_(t, members) !== label) return;
        var b = bucketOf(t);
        if (b >= 0 && b < buckets) cells[b] += t.amount;
      });
      cells.forEach(function (v, k) { catTotal[k] += v; grand[k] += v; });
      rows.push({ cat: i === 0 ? c.name || '미분류' : '', sub: label, cells: cells });
    });
    totalRows.push(rows.length);
    rows.push({ cat: (c.name || '미분류') + ' 합계', sub: '', cells: catTotal, total: true });
  });
  return { rows: rows, grand: grand };
}

function zeros_(n) {
  var a = [];
  for (var i = 0; i < n; i++) a.push(0);
  return a;
}

function sum_(a) {
  return a.reduce(function (x, y) { return x + y; }, 0);
}

function dateLabel_(ymd) {
  var d = new Date(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
  return ymd.slice(5, 7) + '.' + ymd.slice(8, 10) + '(' + WEEKDAYS[d.getDay()] + ')';
}

function contentLabel_(t) {
  if (t.merchant && t.description && t.description !== t.merchant) return t.merchant + ' · ' + t.description;
  return t.merchant || t.description || '';
}

function memberName_(members, id) {
  var m = members.filter(function (x) { return x.id === id; })[0];
  return m ? m.name : SHARED;
}

// ---------------------------------------------------------------- 월 탭

function buildMonthTab_(year, month, all, cats, members) {
  var ym = year + '-' + (month < 10 ? '0' : '') + month;
  var list = all.filter(function (t) { return t.date.slice(0, 7) === ym; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id; });
  var g = new Grid_();
  var days = daysInMonth_(ym);
  var s = summary_(list);
  var exp = list.filter(function (t) { return t.type === 'expense'; });
  var fixedSum = exp.filter(function (t) { return t.fixed; }).reduce(function (a, t) { return a + t.amount; }, 0);

  // 왼쪽: 정리 표들 (B열부터)
  g.put(2, 2, [[year + '년 ' + month + '월 가계부']]);
  g.style('title', 2, 2);
  g.put(3, 2, [['기간: ' + ym + '-01 ~ ' + ym + '-' + days + ' · 원본은 거래내역 탭 (이 탭은 자동으로 다시 그려져요)']]);
  g.style('muted', 3, 2);

  var r = g.table(5, 2, '이달의 정리', ['항목', '금액'], [
    ['총 수입', s.income],
    ['총 지출', s.expense],
    ['  └ 고정지출', fixedSum],
    ['  └ 비고정지출', s.expense - fixedSum],
    ['총 저축', s.saving],
    ['저축률', s.savingsRate === null ? '-' : s.savingsRate + '%'],
    ['남은 돈 (수입-지출-저축)', s.net],
  ]);

  var pay = groupBy_(exp, function (t) { return t.payment_method || '미입력'; });
  r = g.table(r, 2, '결제 수단별', ['지출 방법', '금액', '건수'], Object.keys(pay).sort(function (a, b) { return pay[b].amount - pay[a].amount; }).map(function (k) { return [k, pay[k].amount, pay[k].count]; }));

  var tags = {};
  exp.forEach(function (t) { t.tags.forEach(function (tag) { tags[tag] = tags[tag] || { amount: 0, count: 0 }; tags[tag].amount += t.amount; tags[tag].count++; }); });
  r = g.table(r, 2, '태그별 금액', ['태그', '금액', '건수'], Object.keys(tags).map(function (k) { return ['#' + k, tags[k].amount, tags[k].count]; }));

  var budgets = {};
  budgets_().forEach(function (b) { budgets[b.category_id] = b.amount; });
  var budgetRows = catOrder_(cats, 'expense').filter(function (c) { return budgets[c.id]; }).map(function (c) {
    var used = exp.filter(function (t) { return t.category_name === c.name; }).reduce(function (a, t) { return a + t.amount; }, 0);
    return [c.name, budgets[c.id], used, Math.round((used / budgets[c.id]) * 100) + '%', budgets[c.id] - used];
  });
  r = g.table(r, 2, '예산(목표) 관리', ['대분류', '예산', '사용', '사용률', '남은 예산'], budgetRows);

  // 주간: 월요일 시작 1~6주
  var firstDow = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  var weekOf = function (t) { return Math.floor((Number(t.date.slice(8, 10)) - 1 + firstDow) / 7); };
  var weekly = categoryRows_(exp, cats, members, 'expense', 6, weekOf);
  var weekRows = weekly.rows.map(function (x) { return [x.cat, x.sub, sum_(x.cells)].concat(x.cells); });
  var totals = [];
  weekly.rows.forEach(function (x, i) { if (x.total) totals.push(i); });
  weekRows.push(['총 지출', '', sum_(weekly.grand)].concat(weekly.grand));
  totals.push(weekRows.length - 1);
  g.table(r, 2, '대분류별 지출 (주간별)', ['대분류', '소분류', '합계', '1주', '2주', '3주', '4주', '5주', '6주'], weekRows, { totalRows: totals });

  // 가운데: 무지출 Day 달력 (L열부터, 월요일 시작)
  var C = 12;
  var today = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  var noSpend = 0;
  var cal = [['월', '화', '수', '목', '금', '토', '일']];
  var greens = [];
  var day = 1 - firstDow;
  for (var w = 0; w < 6 && day <= days; w++) {
    var dates = [];
    var amounts = [];
    for (var k = 0; k < 7; k++, day++) {
      if (day < 1 || day > days) {
        dates.push('');
        amounts.push('');
        continue;
      }
      var ymd = ym + '-' + (day < 10 ? '0' : '') + day;
      var spent = exp.filter(function (t) { return t.date === ymd; }).reduce(function (a, t) { return a + t.amount; }, 0);
      dates.push(day);
      if (ymd <= today && spent === 0) {
        noSpend++;
        amounts.push('🌱');
        greens.push([w, k]);
      } else {
        amounts.push(spent || '');
      }
    }
    cal.push(dates, amounts);
  }
  g.put(5, C, [['이달의 무지출 Day 🌱 ' + noSpend + '일']]);
  g.style('section', 5, C);
  g.put(6, C, cal);
  g.style('header', 6, C, 1, 7);
  greens.forEach(function (p) { g.style('green', 7 + p[0] * 2, C + p[1], 2, 1); });
  g.style('muted', 7, C, cal.length - 1, 7);

  // 오른쪽: 고정지출 내역 · 전체 내역 (T열부터)
  var R = 20;
  var fixedRows = exp.filter(function (t) { return t.fixed; }).map(function (t, i) {
    return [i + 1, dateLabel_(t.date), contentLabel_(t), t.amount, t.category_name || '미분류', t.subcategory, t.payment_method, t.tags.join(', '), memberName_(members, t.member_id)];
  });
  var rr = g.table(5, R, '이달의 고정지출 내역', ['No', '날짜', '내용', '금액', '대분류', '소분류', '지출 방법', '태그', '사용자'], fixedRows);
  var allRows = list.map(function (t, i) {
    return [i + 1, dateLabel_(t.date), TYPE_KO[t.type], contentLabel_(t), t.amount, t.category_name || '미분류', t.subcategory, t.payment_method, t.tags.join(', '), memberName_(members, t.member_id), t.memo];
  });
  g.table(rr + 1, R, '이달의 수입 · 저축 · 지출 내역', ['No', '날짜', '구분', '내용', '금액', '대분류', '소분류', '지출 방법', '태그', '사용자', '메모'], allRows);

  var sh = reportSheet_(monthTabName_(month));
  g.write(sh);
  setWidths_(sh, { 1: 16, 2: 150, 3: 110, 4: 90, 5: 90, 6: 90, 7: 70, 8: 70, 9: 70, 10: 70, 11: 24, 19: 24, 20: 36, 21: 80, 23: 220 });
  [12, 13, 14, 15, 16, 17, 18].forEach(function (c) { sh.setColumnWidth(c, 64); });
}

// ---------------------------------------------------------------- 통합시트

function buildAnnualTab_(year, all, cats, members) {
  var list = all.filter(function (t) { return t.date.slice(0, 4) === String(year); });
  var g = new Grid_();
  var monthOf = function (t) { return Number(t.date.slice(5, 7)) - 1; };
  var activeMonths = {};
  list.forEach(function (t) { activeMonths[monthOf(t)] = true; });
  var nActive = Object.keys(activeMonths).length || 1;
  var months = [];
  for (var m = 1; m <= 12; m++) months.push(m + '월');

  g.put(2, 2, [[year + ' Annual Report — 우리집 가계부']]);
  g.style('title', 2, 2);
  g.put(3, 2, [[year + '/1/1 ~ ' + year + '/12/31 · 평균은 기록이 있는 ' + nActive + '개월 기준 · 원본은 거래내역 탭']]);
  g.style('muted', 3, 2);

  var s = summary_(list);
  g.put(5, 2, [['총 수입', '총 저축', '총 지출', '저축률', '남은 돈'], [s.income, s.saving, s.expense, s.savingsRate === null ? '-' : s.savingsRate + '%', s.net]]);
  g.style('header', 5, 2, 1, 5);
  g.style('title', 6, 2, 1, 5);

  var monthly = { income: zeros_(12), saving: zeros_(12), expense: zeros_(12) };
  list.forEach(function (t) { if (monthly[t.type]) monthly[t.type][monthOf(t)] += t.amount; });
  var net = monthly.income.map(function (v, i) { return v - monthly.expense[i] - monthly.saving[i]; });
  var rate = monthly.income.map(function (v, i) { return v ? Math.round((monthly.saving[i] / v) * 1000) / 10 + '%' : '-'; });
  var line = function (label, a) { return [label].concat(a, [sum_(a), Math.round(sum_(a) / nActive)]); };
  var r = g.table(8, 2, '월별 요약', ['구분'].concat(months, ['합계', '평균']), [
    line('수입', monthly.income),
    line('저축', monthly.saving),
    line('지출', monthly.expense),
    line('남은 돈', net),
    ['저축률'].concat(rate, [s.savingsRate === null ? '-' : s.savingsRate + '%', '']),
  ]);

  var detail = function (title, type, totalLabel) {
    var res = categoryRows_(list, cats, members, type, 12, monthOf);
    var rows = res.rows.map(function (x) { return [x.cat, x.sub, sum_(x.cells)].concat(x.cells, [Math.round(sum_(x.cells) / nActive)]); });
    var totals = [];
    res.rows.forEach(function (x, i) { if (x.total) totals.push(i); });
    // 대분류가 하나뿐인 수입·저축 표는 대분류 합계 줄과 총계 줄이 같으므로 총계만 남긴다.
    if (res.rows.filter(function (x) { return x.total; }).length === 1) {
      rows = rows.filter(function (x, i) { return !res.rows[i].total; });
      totals = [];
    }
    rows.push([totalLabel, ''].concat([sum_(res.grand)], res.grand, [Math.round(sum_(res.grand) / nActive)]));
    totals.push(rows.length - 1);
    r = g.table(r, 2, title, ['대분류', '소분류', '합계'].concat(months, ['평균']), rows, { totalRows: totals });
  };
  detail('수입 월별 상세표', 'income', '총 수입');
  detail('저축 월별 상세표', 'saving', '총 저축');
  detail('지출 월별 상세표', 'expense', '총 지출');

  var sh = reportSheet_(REPORT_ANNUAL);
  g.write(sh);
  setWidths_(sh, { 1: 16, 2: 130, 3: 120, 4: 100 });
  for (var c = 5; c <= 18; c++) sh.setColumnWidth(c, 84);
  // 월별 요약(9~12행: 수입·저축·지출)을 막대 차트로. 표 위치가 고정이라 한 번만 넣으면 된다.
  if (!sh.getCharts().length) {
    sh.insertChart(
      sh.newChart()
        .asColumnChart()
        .addRange(sh.getRange(9, 2, 4, 13))
        .setNumHeaders(1)
        .setTransposeRowsAndColumns(true)
        .setPosition(2, 20, 0, 0)
        .setOption('title', '월별 수입 · 저축 · 지출')
        .setOption('colors', ['#2a78d6', '#1baf7a', '#eb6834'])
        .setOption('legend', { position: 'top' })
        .build(),
    );
  }
}

// ---------------------------------------------------------------- 탭 관리

function reportSheet_(name) {
  return ss_().getSheetByName(name) || ss_().insertSheet(name);
}

function setWidths_(sh, widths) {
  Object.keys(widths).forEach(function (c) { sh.setColumnWidth(Number(c), widths[c]); });
}

// ---------------------------------------------------------------- 설정 탭 (엑셀의 설정 탭처럼 보기 좋게 정리한 것)

var SETTINGS_TAB = '설정';

function buildSettingsTab_(all, cats, members) {
  var g = new Grid_();
  g.put(2, 2, [['설정']]);
  g.style('title', 2, 2);
  g.put(3, 2, [['분류·예산·구성원은 앱의 설정 화면에서 바꾸면 여기에 반영돼요. (원본: 카테고리·예산·구성원 탭)']]);
  g.style('muted', 3, 2);

  var maxSubs = Math.max.apply(null, [1].concat(cats.map(function (c) { return c.subcategories.length; })));
  var head = ['구분', '대분류'];
  for (var i = 1; i <= maxSubs; i++) head.push('소분류 ' + i);
  var r = g.table(5, 2, '대분류 / 소분류', head, cats.map(function (c) { return [TYPE_KO[c.type], c.icon + ' ' + c.name].concat(c.subcategories); }));

  // 지출 방법: 내역에 쓰인 결제수단과 사용 횟수(엑셀의 '지출방법' 목록)
  var pay = {};
  all.forEach(function (t) {
    if (!t.payment_method) return;
    var p = (pay[t.payment_method] = pay[t.payment_method] || { count: 0, last: '', amount: 0 });
    p.count++;
    if (t.type === 'expense') p.amount += t.amount;
    if (t.date > p.last) p.last = t.date;
  });
  r = g.table(r, 2, '지출 방법', ['지출 방법', '사용 건수', '누적 지출', '최근 사용일'], Object.keys(pay).sort(function (a, b) { return pay[b].count - pay[a].count; }).map(function (k) { return [k, pay[k].count, pay[k].amount, pay[k].last]; }));

  r = g.table(r, 2, '구성원', ['이름', '구글 계정'], members.map(function (m) { return [m.name, m.email]; }));

  var budgets = budgets_();
  g.table(r, 2, '월 예산', ['대분류', '예산'], budgets.map(function (b) {
    var c = cats.filter(function (x) { return x.id === b.category_id; })[0];
    return [c ? c.name : '', b.amount];
  }));

  var sh = reportSheet_(SETTINGS_TAB);
  g.write(sh);
  setWidths_(sh, { 1: 16, 2: 70, 3: 130 });
}

/**
 * 탭 순서(엑셀 가계부와 비슷하게):
 * 통합시트, 1월~12월, 결제일 관리, (관리 탭), 연도별 거래내역(최근 연도 먼저), 설정, 원본 데이터 탭
 */
function orderTabs_() {
  var ss = ss_();
  var order = [REPORT_ANNUAL];
  for (var m = 1; m <= 12; m++) order.push(monthTabName_(m));
  order.push(SHEETS.recurring.name);
  (typeof LEDGER_ORDER !== 'undefined' ? LEDGER_ORDER : []).forEach(function (k) { order.push(SHEETS[k].name); });
  txSheets_()
    .map(function (sh) { return sh.getName(); })
    .sort()
    .reverse()
    .forEach(function (n) { order.push(n); });
  order.push(SETTINGS_TAB);
  ['budget', 'cat', 'member', 'rule', 'upload'].forEach(function (k) { order.push(SHEETS[k].name); });
  order.forEach(function (name, i) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(i + 1);
  });
  var first = ss.getSheetByName(REPORT_ANNUAL);
  if (first) ss.setActiveSheet(first);
}

/** 전체 다시 그리기 (보고서 연도 변경, 분류 변경 후 등) */
function rebuildReports_(year) {
  if (year) props_().setProperty('REPORT_YEAR', String(year));
  year = reportYear_();
  var all = allTx_();
  var cats = categories_();
  var members = members_();
  for (var m = 1; m <= 12; m++) buildMonthTab_(year, m, all, cats, members);
  buildAnnualTab_(year, all, cats, members);
  buildSettingsTab_(all, cats, members);
  orderTabs_();
  return { year: year };
}

/** 거래가 바뀐 달만 다시 그린다. months: ['2026-10', ...] */
function refreshReports_(months) {
  var year = reportYear_();
  var touched = (months || []).filter(function (m) { return Number(m.slice(0, 4)) === year; });
  if (!touched.length) return;
  if (!ss_().getSheetByName(REPORT_ANNUAL)) {
    rebuildReports_();
    return;
  }
  var all = allTx_();
  var cats = categories_();
  var members = members_();
  var done = {};
  touched.forEach(function (m) {
    if (done[m]) return;
    done[m] = true;
    buildMonthTab_(year, Number(m.slice(5, 7)), all, cats, members);
  });
  buildAnnualTab_(year, all, cats, members);
}
