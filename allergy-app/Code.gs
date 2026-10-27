/**
 * 알레르기 급식 안전 알리미 - 서버(Apps Script)
 *
 * 구글 시트에 붙어 있는 Apps Script 프로젝트에 이 파일과 Index.html 을 넣고
 * 웹앱으로 배포합니다. 데이터는 이 시트의 탭 4개(students, meals, plans, files)에 저장됩니다.
 *
 * PIN 은 [프로젝트 설정 > 스크립트 속성] 의 ADMIN_PIN(영양교사), STAFF_PIN(교직원) 입니다.
 * 처음 한 번 setup() 을 실행하면 시트와 임시 PIN 이 만들어지고 실행 로그에 PIN 이 표시됩니다.
 */

const SHEETS = {
  students: ['id', 'grade', 'classNo', 'number', 'name', 'allergens', 'severity', 'epipen',
             'memo', 'guardian', 'contact', 'status', 'createdAt', 'updatedAt'],
  meals: ['date', 'menus', 'updatedAt'],
  plans: ['date', 'menu', 'studentId', 'substitute', 'updatedAt'],
  files: ['month', 'name', 'url', 'fileId', 'uploadedAt'],
};
const NUMBER_FIELDS = ['grade', 'classNo', 'number'];
const JSON_FIELDS = ['allergens', 'menus'];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('알레르기 급식 안전 알리미')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** 처음 한 번 실행: 시트 탭과 임시 PIN 을 만든다. */
function setup() {
  Object.keys(SHEETS).forEach(sheet_);
  const props = PropertiesService.getScriptProperties();
  const randomPin = () => String(Math.floor(100000 + Math.random() * 900000));
  if (!props.getProperty('ADMIN_PIN')) props.setProperty('ADMIN_PIN', randomPin());
  if (!props.getProperty('STAFF_PIN')) props.setProperty('STAFF_PIN', randomPin());
  Logger.log('영양교사 PIN(ADMIN_PIN): ' + props.getProperty('ADMIN_PIN'));
  Logger.log('교직원 PIN(STAFF_PIN): ' + props.getProperty('STAFF_PIN'));
}

/* ---------- 화면에서 부르는 함수 ---------- */

function login(pin) {
  return role_(pin);
}

/** 보호자 등록: 누구나 제출 가능, 영양교사 승인 전까지 'pending'. */
function submitStudent(data) {
  const s = cleanStudent_(data);
  const now = stamp_();
  s.id = Utilities.getUuid();
  s.status = 'pending';
  s.createdAt = now;
  s.updatedAt = now;
  withLock_(() => append_('students', s));
  return s.id;
}

function getAdminData(pin) {
  needAdmin_(pin);
  return { students: rows_('students'), meals: rows_('meals'), plans: rows_('plans'), files: rows_('files') };
}

/** 교직원 공유 화면: 승인된 학생(보호자 연락처 제외) + 기간 내 식단·대체식. */
function getStaffData(pin, from, to) {
  role_(pin);
  const inRange = r => r.date >= from && r.date <= to;
  const students = rows_('students')
    .filter(s => s.status === 'approved')
    .map(s => ({ id: s.id, grade: s.grade, classNo: s.classNo, number: s.number, name: s.name,
                 allergens: s.allergens, severity: s.severity, epipen: s.epipen, memo: s.memo }));
  return { students: students, meals: rows_('meals').filter(inRange), plans: rows_('plans').filter(inRange),
           files: rows_('files') };
}

function saveStudent(pin, data) {
  needAdmin_(pin);
  const s = cleanStudent_(data);
  return withLock_(() => {
    const all = rows_('students');
    const i = all.findIndex(r => r.id === data.id);
    const now = stamp_();
    if (i >= 0) {
      all[i] = Object.assign(all[i], s, { updatedAt: now });
    } else {
      all.push(Object.assign(s, { id: Utilities.getUuid(), status: 'approved', createdAt: now, updatedAt: now }));
    }
    writeAll_('students', all);
    return true;
  });
}

function setStudentStatus(pin, id, status) {
  needAdmin_(pin);
  if (['approved', 'rejected', 'pending'].indexOf(status) < 0) throw new Error('잘못된 상태입니다.');
  return withLock_(() => {
    const all = rows_('students');
    const s = all.find(r => r.id === id);
    if (!s) throw new Error('학생을 찾을 수 없습니다.');
    s.status = status;
    s.updatedAt = stamp_();
    writeAll_('students', all);
    return true;
  });
}

function deleteStudent(pin, id) {
  needAdmin_(pin);
  return withLock_(() => {
    writeAll_('students', rows_('students').filter(r => r.id !== id));
    writeAll_('plans', rows_('plans').filter(r => r.studentId !== id));
    return true;
  });
}

function saveMeal(pin, date, menus) {
  return saveMeals(pin, [{ date: date, menus: menus }]);
}

/** 여러 날짜 식단을 한 번에 저장 (PDF 식단표 가져오기). 메뉴가 비어 있으면 그 날 식단을 지운다. */
function saveMeals(pin, list) {
  needAdmin_(pin);
  const clean = (list || []).map(d => {
    checkDate_(d.date);
    return {
      date: d.date,
      menus: (d.menus || [])
        .map(m => ({ name: String(m.name || '').trim().slice(0, 40), allergens: cleanAllergens_(m.allergens) }))
        .filter(m => m.name),
    };
  });
  const dates = clean.map(d => d.date);
  const now = stamp_();
  return withLock_(() => {
    const all = rows_('meals').filter(r => dates.indexOf(r.date) < 0);
    clean.forEach(d => { if (d.menus.length) all.push({ date: d.date, menus: d.menus, updatedAt: now }); });
    all.sort((a, b) => a.date < b.date ? -1 : 1);
    writeAll_('meals', all);
    return clean.length;
  });
}

/** 식단표 원본 PDF 를 드라이브에 저장하고 선생님 화면에서 열 수 있게 링크를 남긴다. 같은 달은 덮어쓴다. */
function uploadMenuPdf(pin, month, name, base64) {
  needAdmin_(pin);
  if (!/^\d{4}-\d{2}$/.test(String(month))) throw new Error('월 형식이 올바르지 않습니다.');
  const bytes = Utilities.base64Decode(base64);
  if (bytes.length > 10 * 1024 * 1024) throw new Error('PDF 파일은 10MB 이하만 올릴 수 있습니다.');
  const safeName = String(name || '식단표.pdf').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
  const file = menuFolder_().createFile(Utilities.newBlob(bytes, 'application/pdf', safeName));
  // 식단표는 공개 정보라 링크로 열람 가능하게 둔다 (학교 계정 정책상 안 되면 학교 안에서만)
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
  catch (e) { try { file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW); } catch (e2) {} }
  return withLock_(() => {
    const all = rows_('files');
    all.filter(r => r.month === month).forEach(r => {
      try { DriveApp.getFileById(r.fileId).setTrashed(true); } catch (e) {}
    });
    const rest = all.filter(r => r.month !== month);
    rest.push({ month: month, name: safeName, url: file.getUrl(), fileId: file.getId(), uploadedAt: stamp_() });
    rest.sort((a, b) => a.month < b.month ? -1 : 1);
    writeAll_('files', rest);
    return file.getUrl();
  });
}

function menuFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('MENU_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) {}
  }
  const folder = DriveApp.createFolder('알레르기 급식 알리미 - 식단표');
  props.setProperty('MENU_FOLDER_ID', folder.getId());
  return folder;
}

/** 해당 날짜의 대체식 계획을 통째로 바꾼다. */
function savePlans(pin, date, plans) {
  needAdmin_(pin);
  checkDate_(date);
  const now = stamp_();
  const clean = (plans || [])
    .filter(p => p.menu && p.studentId && String(p.substitute || '').trim())
    .map(p => ({ date: date, menu: String(p.menu), studentId: String(p.studentId),
                 substitute: String(p.substitute).trim().slice(0, 60), updatedAt: now }));
  return withLock_(() => {
    writeAll_('plans', rows_('plans').filter(r => r.date !== date).concat(clean));
    return true;
  });
}

/* ---------- 권한 ---------- */

function role_(pin) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('pinFails') || 0);
  if (fails >= 20) throw new Error('PIN 오류가 너무 많습니다. 10분 뒤에 다시 시도하세요.');
  const props = PropertiesService.getScriptProperties();
  const p = String(pin || '');
  if (p && p === props.getProperty('ADMIN_PIN')) return 'admin';
  if (p && p === props.getProperty('STAFF_PIN')) return 'staff';
  cache.put('pinFails', String(fails + 1), 600);
  throw new Error('PIN이 올바르지 않습니다.');
}

function needAdmin_(pin) {
  if (role_(pin) !== 'admin') throw new Error('영양교사 PIN이 필요합니다.');
}

/* ---------- 입력 정리 ---------- */

function cleanAllergens_(list) {
  const out = [];
  (list || []).forEach(n => {
    n = Number(n);
    if (n >= 1 && n <= 19 && out.indexOf(n) < 0) out.push(n);
  });
  return out.sort((a, b) => a - b);
}

function cleanStudent_(d) {
  d = d || {};
  const s = {
    grade: Number(d.grade), classNo: Number(d.classNo), number: Number(d.number),
    name: String(d.name || '').trim().slice(0, 20),
    allergens: cleanAllergens_(d.allergens),
    severity: ['mild', 'caution', 'severe'].indexOf(d.severity) >= 0 ? d.severity : 'caution',
    epipen: d.epipen === true || d.epipen === 'true' ? 'true' : 'false',
    memo: String(d.memo || '').trim().slice(0, 200),
    guardian: String(d.guardian || '').trim().slice(0, 20),
    contact: String(d.contact || '').trim().slice(0, 20),
  };
  if (!(s.grade >= 1 && s.grade <= 6)) throw new Error('학년을 확인해 주세요.');
  if (!(s.classNo >= 1 && s.classNo <= 30)) throw new Error('반을 확인해 주세요.');
  if (!(s.number >= 1 && s.number <= 60)) throw new Error('번호를 확인해 주세요.');
  if (!s.name) throw new Error('학생 이름을 입력해 주세요.');
  if (!s.allergens.length) throw new Error('알레르기 종류를 한 가지 이상 선택해 주세요.');
  return s;
}

function checkDate_(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('날짜 형식이 올바르지 않습니다.');
}

/* ---------- 시트 읽기/쓰기 ---------- */

function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function rows_(name) {
  const sh = sheet_(name);
  const headers = SHEETS[name];
  const last = sh.getLastRow();
  if (last < 2) return [];
  const tz = Session.getScriptTimeZone();
  return sh.getRange(2, 1, last - 1, headers.length).getValues()
    .filter(r => r.some(v => v !== ''))
    .map(r => {
      const o = {};
      headers.forEach((h, i) => {
        let v = r[i];
        if (v instanceof Date) v = Utilities.formatDate(v, tz, h === 'date' ? 'yyyy-MM-dd' : h === 'month' ? 'yyyy-MM' : 'yyyy-MM-dd HH:mm:ss');
        if (NUMBER_FIELDS.indexOf(h) >= 0) v = Number(v);
        else if (JSON_FIELDS.indexOf(h) >= 0) v = v ? JSON.parse(v) : [];
        else v = String(v);
        o[h] = v;
      });
      if (name === 'students') o.epipen = o.epipen === 'true';
      return o;
    });
}

function toRow_(name, o) {
  return SHEETS[name].map(h => {
    let v = o[h];
    if (JSON_FIELDS.indexOf(h) >= 0) return JSON.stringify(v || []);
    if (v === undefined || v === null) return '';
    v = String(v);
    return /^[=+\-@]/.test(v) ? "'" + v : v; // 수식으로 해석되지 않게
  });
}

function append_(name, o) {
  const sh = sheet_(name);
  const n = SHEETS[name].length;
  sh.getRange(sh.getLastRow() + 1, 1, 1, n).setNumberFormat('@').setValues([toRow_(name, o)]);
}

function writeAll_(name, list) {
  const sh = sheet_(name);
  const n = SHEETS[name].length;
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, n).clearContent();
  if (list.length) {
    sh.getRange(2, 1, list.length, n).setNumberFormat('@').setValues(list.map(o => toRow_(name, o)));
  }
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function stamp_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}
