import express, { type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { db, getCategories, type Category } from "./db.js";
import { login, logout, register, requireAuth } from "./auth.js";
import { extractTransactions, type ExtractedTx } from "./ai.js";
import { scheduleSync, sheetsStatus, syncToSheet } from "./sheets.js";
import { monthlyStats } from "./stats.js";

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 10 } });

type TxType = "expense" | "income" | "transfer";
type TxInput = {
  date: string;
  type: TxType;
  amount: number;
  category_id: number | null;
  subcategory?: string;
  merchant?: string;
  description?: string;
  payment_method?: string;
  member_id?: number | null;
  memo?: string;
};

const wrap =
  (fn: (req: Request, res: Response) => unknown) =>
  async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e instanceof Error ? e.message : "서버 오류" });
    }
  };

function validTx(t: TxInput): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date ?? "")) return "날짜 형식이 올바르지 않습니다.";
  if (!["expense", "income", "transfer"].includes(t.type)) return "구분이 올바르지 않습니다.";
  if (!Number.isFinite(Number(t.amount)) || Number(t.amount) <= 0) return "금액을 확인해 주세요.";
  return null;
}

/** 가맹점명에서 규칙 키워드를 만든다. 지점명/괄호/숫자를 떼서 "스타벅스 강남점" → "스타벅스". */
function merchantKey(merchant: string) {
  return merchant
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .replace(/(주식회사|㈜|\(주\))/g, "")
    .replace(/\s*[가-힣A-Za-z0-9]*점$/, "")
    .replace(/[0-9\-_*#]+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(" ");
}

function learnRule(householdId: number, merchant: string, type: TxType, categoryId: number | null, subcategory: string) {
  const key = merchantKey(merchant);
  if (!key || key.length < 2 || !categoryId) return;
  db.prepare(
    `INSERT INTO merchant_rules (household_id, keyword, type, category_id, subcategory, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (household_id, keyword) DO UPDATE SET type=excluded.type, category_id=excluded.category_id,
       subcategory=excluded.subcategory, updated_at=excluded.updated_at`,
  ).run(householdId, key, type, categoryId, subcategory);
}

type Rule = { keyword: string; type: TxType; category_id: number; subcategory: string };
function getRules(householdId: number): Rule[] {
  return db
    .prepare(`SELECT keyword, type, category_id, subcategory FROM merchant_rules WHERE household_id = ? ORDER BY updated_at DESC LIMIT 300`)
    .all(householdId) as Rule[];
}

// ---------- 인증 ----------
app.post("/api/auth/register", wrap(register));
app.post("/api/auth/login", wrap(login));
app.post("/api/auth/logout", logout);

app.use("/api", requireAuth);

app.get("/api/me", (req, res) => {
  const h = db.prepare(`SELECT id, name, invite_code FROM households WHERE id = ?`).get(req.user.householdId);
  const members = db.prepare(`SELECT id, name FROM users WHERE household_id = ? ORDER BY id`).all(req.user.householdId);
  res.json({ user: req.user, household: h, members });
});

// ---------- 카테고리 / 예산 ----------
app.get("/api/categories", (req, res) => res.json(getCategories(req.user.householdId)));

app.post(
  "/api/categories",
  wrap((req, res) => {
    const { type, name, icon = "", color = "#8884d8", subcategories = [] } = req.body;
    if (!name || !["expense", "income", "transfer"].includes(type)) return res.status(400).json({ error: "입력값을 확인해 주세요." });
    const sort = (db.prepare(`SELECT COALESCE(MAX(sort),0)+1 AS s FROM categories WHERE household_id = ?`).get(req.user.householdId) as { s: number }).s;
    const r = db
      .prepare(`INSERT INTO categories (household_id, type, name, icon, color, subcategories, sort) VALUES (?,?,?,?,?,?,?)`)
      .run(req.user.householdId, type, name, icon, color, JSON.stringify(subcategories), sort);
    res.json({ id: Number(r.lastInsertRowid) });
  }),
);

app.put(
  "/api/categories/:id",
  wrap((req, res) => {
    const { name, icon, color, subcategories } = req.body;
    db.prepare(
      `UPDATE categories SET name = COALESCE(?, name), icon = COALESCE(?, icon), color = COALESCE(?, color),
         subcategories = COALESCE(?, subcategories) WHERE id = ? AND household_id = ?`,
    ).run(name ?? null, icon ?? null, color ?? null, subcategories ? JSON.stringify(subcategories) : null, req.params.id, req.user.householdId);
    res.json({ ok: true });
  }),
);

app.delete(
  "/api/categories/:id",
  wrap((req, res) => {
    db.prepare(`DELETE FROM categories WHERE id = ? AND household_id = ?`).run(req.params.id, req.user.householdId);
    res.json({ ok: true });
  }),
);

app.get("/api/budgets", (req, res) => {
  res.json(db.prepare(`SELECT category_id, amount FROM budgets WHERE household_id = ?`).all(req.user.householdId));
});

app.put(
  "/api/budgets",
  wrap((req, res) => {
    const items = (req.body?.items ?? []) as { category_id: number; amount: number }[];
    const hid = req.user.householdId;
    db.transaction(() => {
      for (const b of items) {
        if (!b.amount || b.amount <= 0) {
          db.prepare(`DELETE FROM budgets WHERE household_id = ? AND category_id = ?`).run(hid, b.category_id);
        } else {
          db.prepare(
            `INSERT INTO budgets (household_id, category_id, amount) VALUES (?,?,?)
             ON CONFLICT (household_id, category_id) DO UPDATE SET amount = excluded.amount`,
          ).run(hid, b.category_id, Math.round(b.amount));
        }
      }
    })();
    res.json({ ok: true });
  }),
);

// ---------- 거래내역 ----------
app.get(
  "/api/transactions",
  wrap((req, res) => {
    const { month, type, category_id, member_id, q } = req.query as Record<string, string | undefined>;
    const where = ["t.household_id = ?"];
    const params: (string | number)[] = [req.user.householdId];
    if (month) (where.push("substr(t.date,1,7) = ?"), params.push(month));
    if (type) (where.push("t.type = ?"), params.push(type));
    if (category_id) (where.push("t.category_id = ?"), params.push(Number(category_id)));
    if (member_id === "shared") where.push("t.member_id IS NULL");
    else if (member_id) (where.push("t.member_id = ?"), params.push(Number(member_id)));
    if (q) {
      where.push("(t.merchant LIKE ? OR t.description LIKE ? OR t.memo LIKE ?)");
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const rows = db
      .prepare(
        `SELECT t.*, u.name AS created_by_name FROM transactions t LEFT JOIN users u ON u.id = t.created_by
         WHERE ${where.join(" AND ")} ORDER BY t.date DESC, t.id DESC LIMIT 2000`,
      )
      .all(...params);
    res.json(rows);
  }),
);

function insertTx(householdId: number, userId: number, t: TxInput, source = "manual", uploadId: number | null = null) {
  return db
    .prepare(
      `INSERT INTO transactions (household_id, date, type, amount, category_id, subcategory, merchant, description,
         payment_method, member_id, memo, source, upload_id, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      householdId, t.date, t.type, Math.round(Number(t.amount)), t.category_id ?? null, t.subcategory ?? "",
      t.merchant ?? "", t.description ?? "", t.payment_method ?? "", t.member_id ?? null, t.memo ?? "",
      source, uploadId, userId,
    );
}

app.post(
  "/api/transactions",
  wrap((req, res) => {
    const t = req.body as TxInput;
    const err = validTx(t);
    if (err) return res.status(400).json({ error: err });
    const r = insertTx(req.user.householdId, req.user.id, t);
    if (t.merchant) learnRule(req.user.householdId, t.merchant, t.type, t.category_id, t.subcategory ?? "");
    scheduleSync(req.user.householdId);
    res.json({ id: Number(r.lastInsertRowid) });
  }),
);

app.put(
  "/api/transactions/:id",
  wrap((req, res) => {
    const t = req.body as TxInput;
    const err = validTx(t);
    if (err) return res.status(400).json({ error: err });
    const before = db
      .prepare(`SELECT category_id, subcategory FROM transactions WHERE id = ? AND household_id = ?`)
      .get(req.params.id, req.user.householdId) as { category_id: number | null; subcategory: string } | undefined;
    if (!before) return res.status(404).json({ error: "내역을 찾을 수 없습니다." });
    db.prepare(
      `UPDATE transactions SET date=?, type=?, amount=?, category_id=?, subcategory=?, merchant=?, description=?,
         payment_method=?, member_id=?, memo=?, updated_at=datetime('now') WHERE id = ? AND household_id = ?`,
    ).run(
      t.date, t.type, Math.round(Number(t.amount)), t.category_id ?? null, t.subcategory ?? "", t.merchant ?? "",
      t.description ?? "", t.payment_method ?? "", t.member_id ?? null, t.memo ?? "", req.params.id, req.user.householdId,
    );
    // 사용자가 분류를 고쳤으면 다음부터 같은 가맹점은 그렇게 분류한다.
    if (t.merchant && (before.category_id !== t.category_id || before.subcategory !== (t.subcategory ?? ""))) {
      learnRule(req.user.householdId, t.merchant, t.type, t.category_id, t.subcategory ?? "");
    }
    scheduleSync(req.user.householdId);
    res.json({ ok: true });
  }),
);

app.delete(
  "/api/transactions/:id",
  wrap((req, res) => {
    db.prepare(`DELETE FROM transactions WHERE id = ? AND household_id = ?`).run(req.params.id, req.user.householdId);
    scheduleSync(req.user.householdId);
    res.json({ ok: true });
  }),
);

app.get(
  "/api/transactions/export.csv",
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT t.date, t.type, t.amount, c.name AS category, t.subcategory, t.merchant, t.description, t.payment_method,
                u.name AS member, t.memo
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN users u ON u.id = t.member_id
         WHERE t.household_id = ? ORDER BY t.date`,
      )
      .all(req.user.householdId) as Record<string, unknown>[];
    const label: Record<string, string> = { expense: "지출", income: "수입", transfer: "이체" };
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      "날짜,구분,금액,카테고리,세부항목,가맹점,내용,결제수단,사용자,메모",
      ...rows.map((r) =>
        [r.date, label[r.type as string], r.amount, r.category, r.subcategory, r.merchant, r.description, r.payment_method, r.member ?? "공동", r.memo]
          .map(esc)
          .join(","),
      ),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="gagyebu.csv"`);
    res.send("﻿" + lines.join("\n"));
  }),
);

// ---------- AI 업로드 ----------
type DraftItem = TxInput & {
  confidence: number;
  note: string;
  duplicate: boolean;
  rule_applied: boolean;
  ai_category_id: number | null;
  ai_subcategory: string;
  include: boolean;
};

function resolveCategory(categories: Category[], t: ExtractedTx) {
  return (
    categories.find((c) => c.type === t.type && c.name === t.category) ??
    categories.find((c) => c.name === t.category) ??
    categories.find((c) => c.type === t.type && c.name.startsWith("기타")) ??
    categories.find((c) => c.type === t.type) ??
    null
  );
}

app.post(
  "/api/uploads",
  upload.array("files", 10),
  wrap(async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) return res.status(400).json({ error: "파일을 선택해 주세요." });
    const hid = req.user.householdId;
    const categories = getCategories(hid);
    const rules = getRules(hid);
    const catName = new Map(categories.map((c) => [c.id, c.name]));
    // multer는 파일명을 latin1로 해석하므로 한글 파일명을 복원한다.
    for (const f of files) f.originalname = Buffer.from(f.originalname, "latin1").toString("utf8");

    const extraction = await extractTransactions(
      files,
      categories,
      rules.map((r) => ({ keyword: r.keyword, category: catName.get(r.category_id) ?? "", subcategory: r.subcategory })),
    );

    const memberId = req.body.member_id ? Number(req.body.member_id) : null;
    const dupStmt = db.prepare(
      `SELECT 1 FROM transactions WHERE household_id = ? AND date = ? AND amount = ? AND type = ? LIMIT 1`,
    );

    const items: DraftItem[] = extraction.transactions.map((t) => {
      const cat = resolveCategory(categories, t);
      let categoryId = cat?.id ?? null;
      let subcategory = cat?.subcategories.includes(t.subcategory) ? t.subcategory : "";
      let type: TxType = t.type;
      // AI가 프롬프트의 규칙을 놓쳤더라도 서버에서 한 번 더 강제한다.
      const rule = rules.find((r) => t.merchant.includes(r.keyword));
      if (rule) {
        categoryId = rule.category_id;
        subcategory = rule.subcategory;
        type = rule.type;
      }
      return {
        date: t.date,
        type,
        amount: t.amount,
        category_id: categoryId,
        subcategory,
        merchant: t.merchant,
        description: t.description,
        payment_method: t.payment_method,
        member_id: memberId,
        memo: "",
        confidence: t.confidence,
        note: t.note,
        duplicate: !!dupStmt.get(hid, t.date, t.amount, type),
        rule_applied: !!rule,
        ai_category_id: categoryId,
        ai_subcategory: subcategory,
        include: true,
      };
    });
    for (const it of items) if (it.duplicate) it.include = false;

    const r = db
      .prepare(`INSERT INTO uploads (household_id, filenames, doc_type, summary, draft, created_by) VALUES (?,?,?,?,?,?)`)
      .run(hid, JSON.stringify(files.map((f) => f.originalname)), extraction.document_type, extraction.summary, JSON.stringify(items), req.user.id);

    res.json({ id: Number(r.lastInsertRowid), document_type: extraction.document_type, summary: extraction.summary, items });
  }),
);

app.post(
  "/api/uploads/:id/commit",
  wrap((req, res) => {
    const hid = req.user.householdId;
    const up = db.prepare(`SELECT id, status FROM uploads WHERE id = ? AND household_id = ?`).get(req.params.id, hid) as
      | { id: number; status: string }
      | undefined;
    if (!up) return res.status(404).json({ error: "업로드를 찾을 수 없습니다." });
    if (up.status === "committed") return res.status(409).json({ error: "이미 저장된 업로드입니다." });

    const items = ((req.body?.items ?? []) as DraftItem[]).filter((i) => i.include);
    for (const i of items) {
      const err = validTx(i);
      if (err) return res.status(400).json({ error: `${i.merchant || i.date}: ${err}` });
    }
    db.transaction(() => {
      for (const i of items) {
        insertTx(hid, req.user.id, i, "upload", up.id);
        if (i.merchant && (i.category_id !== i.ai_category_id || (i.subcategory ?? "") !== i.ai_subcategory)) {
          learnRule(hid, i.merchant, i.type, i.category_id, i.subcategory ?? "");
        }
      }
      db.prepare(`UPDATE uploads SET status = 'committed', draft = NULL WHERE id = ?`).run(up.id);
    })();
    scheduleSync(hid);
    res.json({ saved: items.length });
  }),
);

app.get("/api/uploads", (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT up.id, up.filenames, up.doc_type, up.summary, up.status, up.created_at, u.name AS created_by_name,
                (SELECT COUNT(*) FROM transactions t WHERE t.upload_id = up.id) AS tx_count
         FROM uploads up LEFT JOIN users u ON u.id = up.created_by
         WHERE up.household_id = ? ORDER BY up.id DESC LIMIT 50`,
      )
      .all(req.user.householdId),
  );
});

// ---------- 통계 ----------
app.get(
  "/api/stats",
  wrap((req, res) => {
    const month = String(req.query.month ?? new Date().toISOString().slice(0, 7));
    res.json(monthlyStats(req.user.householdId, month));
  }),
);

// ---------- 규칙 ----------
app.get("/api/rules", (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT r.id, r.keyword, r.type, r.category_id, r.subcategory, c.name AS category FROM merchant_rules r
         JOIN categories c ON c.id = r.category_id WHERE r.household_id = ? ORDER BY r.keyword`,
      )
      .all(req.user.householdId),
  );
});
app.delete("/api/rules/:id", (req, res) => {
  db.prepare(`DELETE FROM merchant_rules WHERE id = ? AND household_id = ?`).run(req.params.id, req.user.householdId);
  res.json({ ok: true });
});

// ---------- 구글 시트 ----------
app.get("/api/sheets", (req, res) => res.json(sheetsStatus(req.user.householdId)));
app.put(
  "/api/sheets",
  wrap((req, res) => {
    // 전체 URL을 붙여 넣어도 ID만 뽑아 저장한다.
    const input = String(req.body?.sheetId ?? "").trim();
    const id = input.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1] ?? input;
    db.prepare(`UPDATE households SET sheet_id = ? WHERE id = ?`).run(id || null, req.user.householdId);
    res.json(sheetsStatus(req.user.householdId));
  }),
);
app.post(
  "/api/sheets/sync",
  wrap(async (req, res) => res.json(await syncToSheet(req.user.householdId))),
);

// ---------- 프론트엔드 (빌드 결과물) ----------
const clientDist = path.resolve(process.cwd(), "../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`가계부 서버: http://localhost:${port}`));
