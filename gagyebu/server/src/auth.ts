import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { db, seedCategories } from "./db.js";

const SECRET = process.env.JWT_SECRET ?? "dev-only-secret-change-me";
// `npm start`(실사용)는 --prod로 실행되며, 이때는 기본 비밀값으로 띄우지 않는다.
if (!process.env.JWT_SECRET && process.argv.includes("--prod")) {
  throw new Error(".env 파일에 JWT_SECRET 값을 설정해 주세요.");
}
const COOKIE = "gagyebu_token";

export type AuthUser = { id: number; householdId: number; name: string; email: string };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user: AuthUser;
    }
  }
}

function newInviteCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

function setSession(res: Response, userId: number) {
  const token = jwt.sign({ uid: userId }, SECRET, { expiresIn: "60d" });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: res.req.secure,
    maxAge: 60 * 24 * 3600 * 1000,
  });
}

export async function register(req: Request, res: Response) {
  const { name, email, password, householdName, inviteCode } = req.body ?? {};
  if (!name || !email || !password || String(password).length < 6) {
    return res.status(400).json({ error: "이름, 이메일, 6자 이상 비밀번호를 입력해 주세요." });
  }
  if (db.prepare(`SELECT 1 FROM users WHERE email = ?`).get(email)) {
    return res.status(409).json({ error: "이미 가입된 이메일입니다." });
  }

  let householdId: number;
  if (inviteCode) {
    const h = db.prepare(`SELECT id FROM households WHERE invite_code = ?`).get(String(inviteCode).trim().toUpperCase()) as
      | { id: number }
      | undefined;
    if (!h) return res.status(404).json({ error: "초대코드를 찾을 수 없습니다." });
    householdId = h.id;
  } else {
    // 집 PC가 인터넷에 열려 있어도 아무나 새 가계부를 만들어 API 요금을 쓰지 못하게,
    // 새 가계부는 처음 한 번만 만들 수 있다. 이후 가입은 초대코드로만 가능.
    const exists = db.prepare(`SELECT 1 FROM households LIMIT 1`).get();
    if (exists && process.env.ALLOW_NEW_HOUSEHOLD !== "true") {
      return res.status(403).json({ error: "이 서버에는 이미 가계부가 있어요. 배우자에게 받은 초대코드로 참여해 주세요." });
    }
    const r = db
      .prepare(`INSERT INTO households (name, invite_code) VALUES (?, ?)`)
      .run(householdName || `${name}네 가계부`, newInviteCode());
    householdId = Number(r.lastInsertRowid);
    seedCategories(householdId);
  }

  const hash = await bcrypt.hash(String(password), 10);
  const u = db
    .prepare(`INSERT INTO users (household_id, email, name, password_hash) VALUES (?, ?, ?, ?)`)
    .run(householdId, String(email).trim().toLowerCase(), name, hash);
  setSession(res, Number(u.lastInsertRowid));
  res.json({ ok: true });
}

// 비밀번호 무작위 대입 방지: (IP, 이메일)별 15분에 10번까지 실패 허용.
// 프록시 뒤에서는 모두 같은 IP로 보일 수 있어 이메일까지 묶어야 다른 사람이 함께 잠기지 않는다.
const failures = new Map<string, { count: number; until: number }>();
function tooManyFailures(key: string) {
  const f = failures.get(key);
  return !!f && f.count >= 10 && f.until > Date.now();
}
function recordFailure(key: string) {
  const f = failures.get(key);
  const fresh = !f || f.until < Date.now();
  failures.set(key, { count: fresh ? 1 : f.count + 1, until: Date.now() + 15 * 60 * 1000 });
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.body ?? {};
  const key = `${req.ip}|${String(email ?? "").trim().toLowerCase()}`;
  if (tooManyFailures(key)) return res.status(429).json({ error: "로그인 시도가 너무 많아요. 15분 뒤에 다시 시도해 주세요." });
  const u = db.prepare(`SELECT id, password_hash FROM users WHERE email = ?`).get(String(email ?? "").trim().toLowerCase()) as
    | { id: number; password_hash: string }
    | undefined;
  if (!u || !(await bcrypt.compare(String(password ?? ""), u.password_hash))) {
    recordFailure(key);
    return res.status(401).json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." });
  }
  failures.delete(key);
  setSession(res, u.id);
  res.json({ ok: true });
}

export function logout(_req: Request, res: Response) {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: "로그인이 필요합니다." });
  try {
    const { uid } = jwt.verify(token, SECRET) as { uid: number };
    const u = db.prepare(`SELECT id, household_id AS householdId, name, email FROM users WHERE id = ?`).get(uid) as
      | AuthUser
      | undefined;
    if (!u) return res.status(401).json({ error: "로그인이 필요합니다." });
    req.user = u;
    next();
  } catch {
    res.status(401).json({ error: "로그인이 필요합니다." });
  }
}
