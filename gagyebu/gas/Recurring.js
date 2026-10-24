/**
 * 정기결제 (엑셀의 "결제일 관리" 탭)
 *
 * - 금액이 매달 같은 것(자동기록 Y): 결제일이 지나면 그 달 내역에 자동으로 기록한다.
 *   앱을 열 때(하루 한 번) 밀린 달까지 채운다. 자동으로 넣은 내역을 지워도 다시 넣지 않도록 '마지막 기록' 달을 남긴다.
 * - 금액이 매달 다른 것(자동기록 N, 관리비·가스비 등): 기록하지 않고 "이번 달 예정"으로 보여 주다가
 *   고지서/카드 내역이 올라오면 '나감'으로 표시한다.
 * 카드 내역을 나중에 올려도 자동 기록한 결제는 중복 찾기에 걸려 두 번 세지 않는다.
 */

// 시작 달을 과거로 잡으면 그 달부터 채운다(최대 10년).
var RECURRING_MAX_CATCHUP = 120;

function ymOf_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM');
  var m = String(v || '').match(/(\d{4})[-./년\s]*(\d{1,2})/);
  return m ? m[1] + '-' + (m[2].length < 2 ? '0' : '') + m[2] : '';
}

function nextYm_(ym) {
  return shiftMonth_(ym, 1);
}

function dueDate_(ym, day) {
  var d = Math.min(Math.max(1, day), daysInMonth_(ym));
  return ym + '-' + (d < 10 ? '0' : '') + d;
}

function recurringItems_() {
  var cats = categories_();
  var members = members_();
  return read_('recurring').map(function (r) {
    var type = KO_TYPE[r['구분']] || 'expense';
    var cat = findCategory_(cats, type, String(r['대분류']));
    return {
      id: Number(r.ID),
      name: String(r['내용'] || ''),
      type: type,
      amount: Number(String(r['금액']).replace(/[^0-9]/g, '')) || 0,
      day: parseInt(String(r['결제일']), 10) || 1,
      category_id: cat ? cat.id : null,
      category_name: String(r['대분류'] || ''),
      subcategory: String(r['소분류'] || ''),
      payment_method: String(r['결제수단'] || ''),
      member_id: memberIdByName_(members, String(r['사용자'])),
      auto: String(r['자동기록']).toUpperCase() !== 'N',
      start: ymOf_(r['시작월']),
      end: ymOf_(r['종료월']),
      last: ymOf_(r['마지막 기록']),
      memo: String(r['비고'] || ''),
      _row: r._row,
    };
  });
}

function recurringRow_(it, cats, members, last) {
  var cat = cats.filter(function (c) { return c.id === Number(it.category_id); })[0];
  return {
    ID: it.id,
    내용: it.name,
    구분: TYPE_KO[it.type],
    금액: Math.round(Number(it.amount) || 0),
    결제일: Number(it.day),
    대분류: cat ? cat.name : '',
    소분류: it.subcategory || '',
    결제수단: it.payment_method || '',
    사용자: memberNameById_(members, it.member_id),
    자동기록: it.auto ? 'Y' : 'N',
    시작월: it.start || '',
    종료월: it.end || '',
    '마지막 기록': last || '',
    비고: it.memo || '',
  };
}

function validateRecurring_(b) {
  if (!b.name) throw httpError_(400, '내용(이름)을 입력해 주세요.');
  if (!TYPE_KO[b.type]) throw httpError_(400, '구분이 올바르지 않습니다.');
  if (!(Number(b.day) >= 1 && Number(b.day) <= 31)) throw httpError_(400, '결제일은 1~31일 중에서 골라 주세요.');
  if (b.auto && !(Number(b.amount) > 0)) throw httpError_(400, '자동으로 기록하려면 금액이 필요해요.');
  if (b.end && ymOf_(b.end) && ymOf_(b.start) && ymOf_(b.end) < ymOf_(b.start)) throw httpError_(400, '끝나는 달이 시작하는 달보다 빨라요.');
}

function createRecurring_(b) {
  validateRecurring_(b);
  var it = Object.assign({}, b, { id: nextId_(read_('recurring')), start: ymOf_(b.start) || Utilities.formatDate(new Date(), tz_(), 'yyyy-MM'), end: ymOf_(b.end) });
  append_('recurring', [recurringRow_(it, categories_(), members_(), '')]);
  postRecurring_(true);
  return { id: it.id };
}

function updateRecurring_(id, b) {
  validateRecurring_(b);
  var cur = recurringItems_().filter(function (x) { return x.id === id; })[0];
  if (!cur) throw httpError_(404, '정기결제를 찾을 수 없어요.');
  var it = Object.assign({}, b, { id: id, start: ymOf_(b.start) || cur.start, end: ymOf_(b.end) });
  // 시작 달을 바꾸면 새 시작 달부터 다시 확인한다(이미 기록된 달은 건너뜀).
  var last = it.start !== cur.start ? '' : cur.last;
  writeRow_('recurring', cur._row, recurringRow_(it, categories_(), members_(), last));
  postRecurring_(true);
  return true;
}

function deleteRecurring_(id) {
  deleteRows_('recurring', read_('recurring').filter(function (r) { return Number(r.ID) === id; }).map(function (r) { return r._row; }));
  return true;
}

/** 결제일이 지난 자동기록 항목을 내역에 넣는다. force가 아니면 하루에 한 번만 확인한다. */
function postRecurring_(force) {
  var today = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  var p = props_();
  if (!force && p.getProperty('RECURRING_CHECKED') === today) return 0;
  var thisMonth = today.slice(0, 7);
  var items = recurringItems_().filter(function (it) { return it.auto && it.amount > 0; });
  var rows = [];
  var touched = [];
  if (items.length) {
    var cats = categories_();
    var members = members_();
    var id = nextId_(read_('tx'));
    var stamp = now_();
    var col = SHEETS.recurring.headers.indexOf('마지막 기록') + 1;
    var sh = sheet_('recurring');
    var existing = allTx_();
    // 그 달에 이미 같은 결제가 있으면(직접 입력했거나 카드 내역으로 올린 경우) 자동으로 또 넣지 않는다.
    var alreadyThere = function (it, ym) {
      return existing.some(function (t) {
        if (t.date.slice(0, 7) !== ym || t.type !== it.type) return false;
        if (t.recurring_id === it.id) return true;
        if (t.amount !== it.amount) return false;
        return similarMerchant_(t.merchant, it.name) || (!!it.subcategory && t.category_id === it.category_id && t.subcategory === it.subcategory);
      });
    };
    items.forEach(function (it) {
      var ym = it.last ? nextYm_(it.last) : it.start || thisMonth;
      var last = it.last;
      for (var n = 0; n < RECURRING_MAX_CATCHUP && ym <= thisMonth; n++, ym = nextYm_(ym)) {
        if (it.end && ym > it.end) break;
        var due = dueDate_(ym, it.day);
        if (due > today) break;
        last = ym;
        if (alreadyThere(it, ym)) continue;
        var row = txToRow_(
          { date: due, type: it.type, amount: it.amount, category_id: it.category_id, subcategory: it.subcategory, merchant: it.name, description: '정기결제', payment_method: it.payment_method, member_id: it.member_id, fixed: it.type !== 'income', tags: [], memo: it.memo },
          cats,
          members,
          { ID: id++, 입력방식: '정기', 정기ID: it.id, 입력자: '자동', 입력일시: stamp, 수정일시: stamp },
        );
        rows.push(row);
        touched.push(ym);
      }
      if (last !== it.last) sh.getRange(it._row, col).setValue(last);
    });
    append_('tx', rows);
  }
  p.setProperty('RECURRING_CHECKED', today);
  if (touched.length) refreshReports_(touched);
  return rows.length;
}

/** 이번 달 정기결제 현황: 나감 / 오늘 이후 예정 / 날짜는 지났는데 아직 없음 */
function recurringStatus_(month) {
  month = month || Utilities.formatDate(new Date(), tz_(), 'yyyy-MM');
  var today = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  var txs = allTx_().filter(function (t) { return t.date.slice(0, 7) === month; });
  var used = {};
  var items = recurringItems_()
    .filter(function (it) { return (!it.start || it.start <= month) && (!it.end || it.end >= month); })
    .map(function (it) {
      var due = dueDate_(month, it.day);
      var match = txs.filter(function (t) {
        if (used[t.id]) return false;
        if (t.recurring_id === it.id) return true;
        if (t.type !== it.type) return false;
        if (similarMerchant_(t.merchant, it.name)) return true;
        return !!it.subcategory && t.category_name === it.category_name && t.subcategory === it.subcategory;
      })[0];
      if (match) used[match.id] = true;
      return Object.assign(stripRow_(it), {
        due: due,
        status: match ? 'paid' : due < today ? 'missing' : 'upcoming',
        paid_amount: match ? match.amount : 0,
        paid_date: match ? match.date : null,
      });
    })
    .sort(function (a, b) { return a.day - b.day; });
  var expenseLike = items.filter(function (i) { return i.type !== 'income'; });
  return {
    month: month,
    items: items,
    total: expenseLike.reduce(function (a, i) { return a + (i.status === 'paid' ? i.paid_amount : i.amount); }, 0),
    paid: expenseLike.filter(function (i) { return i.status === 'paid'; }).reduce(function (a, i) { return a + i.paid_amount; }, 0),
    remaining: expenseLike.filter(function (i) { return i.status !== 'paid'; }).reduce(function (a, i) { return a + i.amount; }, 0),
  };
}

/** 지난 6개월 동안 2달 이상 반복된 고정지출·저축을 등록 후보로 추천한다. */
function recurringSuggestions_() {
  var since = shiftMonth_(Utilities.formatDate(new Date(), tz_(), 'yyyy-MM'), -6);
  var registered = recurringItems_();
  var groups = {};
  allTx_().forEach(function (t) {
    if (t.recurring_id || t.date.slice(0, 7) < since) return;
    if (!(t.type === 'saving' || (t.type === 'expense' && (t.fixed || t.category_name === FIXED_CATEGORY)))) return;
    var key = merchantKey_(t.merchant) || t.merchant;
    if (!key) return;
    (groups[key] = groups[key] || []).push(t);
  });
  return Object.keys(groups)
    .map(function (k) {
      var list = groups[k].sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      var months = {};
      var days = {};
      list.forEach(function (t) {
        months[t.date.slice(0, 7)] = true;
        var d = Number(t.date.slice(8, 10));
        days[d] = (days[d] || 0) + 1;
      });
      if (Object.keys(months).length < 2) return null;
      var latest = list[list.length - 1];
      if (registered.some(function (r) { return similarMerchant_(r.name, latest.merchant); })) return null;
      var day = Number(Object.keys(days).sort(function (a, b) { return days[b] - days[a]; })[0]);
      var amounts = list.map(function (t) { return t.amount; });
      var varies = Math.max.apply(null, amounts) > Math.min.apply(null, amounts) * 1.05;
      return {
        name: latest.merchant,
        type: latest.type,
        amount: latest.amount,
        day: day,
        category_id: latest.category_id,
        subcategory: latest.subcategory,
        payment_method: latest.payment_method,
        member_id: latest.member_id,
        auto: !varies,
        months: Object.keys(months).length,
      };
    })
    .filter(Boolean)
    .sort(function (a, b) { return a.day - b.day; });
}
