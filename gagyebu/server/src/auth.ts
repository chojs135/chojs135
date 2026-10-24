import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { db, seedCategories } from "./db.js";

const SECRET = process.env.JWT_SECRET ?? "dev-only-secret-change-me";
if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET 환경변수를 설정해 주세요.");
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
    secure: process.env.NODE_ENV === "production",
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

export async function login(req: Request, res: Response) {
  const { email, password } = req.body ?? {};
  const u = db.prepare(`SELECT id, password_hash FROM users WHERE email = ?`).get(String(email ?? "").trim().toLowerCase()) as
    | { id: number; password_hash: string }
    | undefined;
  if (!u || !(await bcrypt.compare(String(password ?? ""), u.password_hash))) {
    return res.status(401).json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." });
  }
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
