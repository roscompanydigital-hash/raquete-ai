// Armazenamento: Postgres quando DATABASE_URL está definida (produção),
// senão um arquivo JSON local em data/db.json (para testar no computador).
import pg from "pg";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SESSION_DAYS = 30;
const newToken = () => crypto.randomBytes(32).toString("hex");
const sessionExpiry = () => new Date(Date.now() + SESSION_DAYS * 864e5);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS analyses (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stroke TEXT NOT NULL,
  level TEXT,
  hand TEXT,
  thumb TEXT,
  result JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS analyses_user_idx ON analyses (user_id, created_at DESC);
`;

const toAnalysis = (r) => ({
  id: r.id, date: new Date(r.created_at).getTime(), stroke: r.stroke,
  level: r.level, hand: r.hand, thumb: r.thumb, result: r.result,
});
const publicUser = (u) => u && { id: u.id, email: u.email, name: u.name };

function postgresStore(url) {
  // SSL segue o "?sslmode=require" da própria URL (necessário em bancos externos como o Neon).
  const pool = new pg.Pool({ connectionString: url });
  const q = (text, params) => pool.query(text, params);

  return {
    kind: "postgres",
    async init() { await q(SCHEMA); },
    async createUser({ email, name, passwordHash }) {
      const { rows } = await q(
        "INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING RETURNING *",
        [email, name, passwordHash],
      );
      return rows[0] || null;
    },
    async getUserByEmail(email) {
      return (await q("SELECT * FROM users WHERE email = $1", [email])).rows[0] || null;
    },
    async createSession(userId) {
      const token = newToken();
      await q("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)", [token, userId, sessionExpiry()]);
      return token;
    },
    async getSessionUser(token) {
      const { rows } = await q(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > now()",
        [token],
      );
      return publicUser(rows[0]);
    },
    async deleteSession(token) { await q("DELETE FROM sessions WHERE token = $1", [token]); },
    async addAnalysis(userId, a) {
      const { rows } = await q(
        "INSERT INTO analyses (user_id, stroke, level, hand, thumb, result) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
        [userId, a.stroke, a.level, a.hand, a.thumb, a.result],
      );
      return toAnalysis(rows[0]);
    },
    async listAnalyses(userId) {
      const { rows } = await q("SELECT * FROM analyses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200", [userId]);
      return rows.map(toAnalysis);
    },
    async deleteAnalysis(userId, id) {
      const { rowCount } = await q("DELETE FROM analyses WHERE user_id = $1 AND id = $2", [userId, id]);
      return rowCount > 0;
    },
    async countAnalysesSince(userId, since) {
      const { rows } = await q("SELECT count(*)::int AS n FROM analyses WHERE user_id = $1 AND created_at >= $2", [userId, since]);
      return rows[0].n;
    },
  };
}

function fileStore(file) {
  let data = { users: [], sessions: [], analyses: [], nextId: 1 };
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
  };
  const id = () => data.nextId++;

  return {
    kind: "arquivo local",
    async init() { if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, "utf8")); },
    async createUser({ email, name, passwordHash }) {
      if (data.users.some((u) => u.email === email)) return null;
      const user = { id: id(), email, name, password_hash: passwordHash, created_at: new Date().toISOString() };
      data.users.push(user);
      save();
      return user;
    },
    async getUserByEmail(email) { return data.users.find((u) => u.email === email) || null; },
    async createSession(userId) {
      const token = newToken();
      data.sessions.push({ token, user_id: userId, expires_at: sessionExpiry().toISOString() });
      save();
      return token;
    },
    async getSessionUser(token) {
      const s = data.sessions.find((x) => x.token === token && new Date(x.expires_at) > new Date());
      return publicUser(s && data.users.find((u) => u.id === s.user_id));
    },
    async deleteSession(token) { data.sessions = data.sessions.filter((s) => s.token !== token); save(); },
    async addAnalysis(userId, a) {
      const row = { id: id(), user_id: userId, created_at: new Date().toISOString(), ...a };
      data.analyses.push(row);
      save();
      return toAnalysis(row);
    },
    async listAnalyses(userId) {
      return data.analyses.filter((a) => a.user_id === userId).reverse().slice(0, 200).map(toAnalysis);
    },
    async deleteAnalysis(userId, aid) {
      const before = data.analyses.length;
      data.analyses = data.analyses.filter((a) => !(a.user_id === userId && a.id === aid));
      save();
      return data.analyses.length < before;
    },
    async countAnalysesSince(userId, since) {
      return data.analyses.filter((a) => a.user_id === userId && new Date(a.created_at) >= since).length;
    },
  };
}

export function createStore() {
  return process.env.DATABASE_URL
    ? postgresStore(process.env.DATABASE_URL)
    : fileStore(path.join(process.cwd(), "data", "db.json"));
}
