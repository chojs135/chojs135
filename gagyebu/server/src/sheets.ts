import fs from "node:fs";
import { google, sheets_v4 } from "googleapis";
import { db } from "./db.js";

// 구글 스프레드시트는 "보기/백업용 사본"이다. 원본 데이터는 SQLite에 있고,
// 변경이 생길 때마다 시트 전체를 다시 쓴다(가구 단위 데이터량이 작아서 이 방식이 가장 단순하고 안전하다).

function loadCredentials(): Record<string, string> | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;
  const text = raw.trim().startsWith("{") ? raw : fs.readFileSync(raw, "utf8");
  return JSON.parse(text);
}

let sheetsClient: sheets_v4.Sheets | null | undefined;
function getSheets(): sheets_v4.Sheets | null {
  if (sheetsClient !== undefined) return sheetsClient;
  const creds = loadCredentials();
  if (!creds) return (sheetsClient = null);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return (sheetsClient = google.sheets({ version: "v4", auth }));
}

export function sheetsStatus(householdId: number) {
  const creds = loadCredentials();
  const h = db.prepare(`SELECT sheet_id FROM households WHERE id = ?`).get(householdId) as { sheet_id: string | null };
  return {
    configured: !!creds,
    serviceAccountEmail: creds?.client_email ?? null,
    sheetId: h.sheet_id ?? process.env.GOOGLE_SHEET_ID ?? null,
    lastSync: lastSync.get(householdId) ?? null,
  };
}

const lastSync = new Map<number, { at: string; ok: boolean; message: string }>();
const pending = new Map<number, NodeJS.Timeout>();

/** 변경 직후 여러 번 호출돼도 몇 초 뒤 한 번만 동기화한다. */
export function scheduleSync(householdId: number) {
  if (!getSheets()) return;
  clearTimeout(pending.get(householdId));
  pending.set(
    householdId,
    setTimeout(() => {
      pending.delete(householdId);
      syncToSheet(householdId).catch(() => {});
    }, 3000),
  );
}

const TAB_TX = "거래내역";
const TAB_MONTHLY = "월별요약";
const TYPE_LABEL: Record<string, string> = { expense: "지출", income: "수입", transfer: "이체" };

async function ensureTabs(sheets: sheets_v4.Sheets, spreadsheetId: string) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  const existing = new Set(meta.data.sheets?.map((s) => s.properties?.title));
  const missing = [TAB_TX, TAB_MONTHLY].filter((t) => !existing.has(t));
  if (missing.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
    });
  }
}

export async function syncToSheet(householdId: number) {
  const sheets = getSheets();
  const { sheetId } = sheetsStatus(householdId);
  if (!sheets || !sheetId) throw new Error("구글 시트 연동이 설정되지 않았습니다.");

  try {
    await ensureTabs(sheets, sheetId);

    const txs = db
      .prepare(
        `SELECT t.id, t.date, t.type, t.amount, c.name AS category, t.subcategory, t.merchant, t.description,
                t.payment_method, u.name AS member, t.memo, t.source, t.updated_at
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         LEFT JOIN users u ON u.id = t.member_id
         WHERE t.household_id = ? ORDER BY t.date DESC, t.id DESC`,
      )
      .all(householdId) as Record<string, string | number | null>[];

    const txRows = [
      ["ID", "날짜", "구분", "금액", "카테고리", "세부항목", "가맹점", "내용", "결제수단", "사용자", "메모", "입력방식", "수정일시"],
      ...txs.map((t) => [
        t.id, t.date, TYPE_LABEL[t.type as string], t.amount, t.category ?? "", t.subcategory, t.merchant,
        t.description, t.payment_method, t.member ?? "공동", t.memo, t.source === "upload" ? "자동" : "수기", t.updated_at,
      ]),
    ];

    const monthly = db
      .prepare(
        `SELECT substr(date,1,7) AS month,
                SUM(CASE WHEN type='income' THEN amount ELSE 0 END) AS income,
                SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) AS expense
         FROM transactions WHERE household_id = ? GROUP BY month ORDER BY month DESC`,
      )
      .all(householdId) as { month: string; income: number; expense: number }[];
    const monthlyRows = [
      ["월", "수입", "지출", "남은 돈", "저축률(%)"],
      ...monthly.map((m) => [
        m.month, m.income, m.expense, m.income - m.expense,
        m.income ? Math.round(((m.income - m.expense) / m.income) * 1000) / 10 : "",
      ]),
    ];

    await sheets.spreadsheets.values.batchClear({ spreadsheetId: sheetId, requestBody: { ranges: [TAB_TX, TAB_MONTHLY] } });
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: [
          { range: `${TAB_TX}!A1`, values: txRows },
          { range: `${TAB_MONTHLY}!A1`, values: monthlyRows },
        ],
      },
    });
    const result = { at: new Date().toISOString(), ok: true, message: `${txs.length}건 동기화 완료` };
    lastSync.set(householdId, result);
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    lastSync.set(householdId, { at: new Date().toISOString(), ok: false, message });
    throw e;
  }
}
