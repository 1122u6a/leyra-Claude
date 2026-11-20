import {DatabaseSync} from 'node:sqlite';
import {randomBytes, randomUUID, createHash, scrypt, timingSafeEqual, createCipheriv, createDecipheriv} from 'node:crypto';
import {promisify} from 'node:util';

const derive = promisify(scrypt);
export const timestamp = () => new Date().toISOString();
export const token = () => randomBytes(32).toString('base64url');
export const digest = value => createHash('sha256').update(value).digest('hex');
export const isToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export const id = randomUUID;
export const maxDevices = 5;
export const version = '1.0.0';

export function openStore(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
      nickname TEXT, verified_at TEXT, disclaimer_at TEXT, lifetime_at TEXT,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS trials (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      ends_at INTEGER
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      access TEXT UNIQUE NOT NULL, refresh TEXT UNIQUE NOT NULL,
      access_exp INTEGER NOT NULL, refresh_exp INTEGER NOT NULL,
      created_at TEXT NOT NULL, used_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS mail_tokens (
      hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL CHECK (purpose IN ('verify','reset')), expires INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, client TEXT NOT NULL, platform TEXT NOT NULL, home_region TEXT NOT NULL,
      mode TEXT NOT NULL, created_at TEXT NOT NULL, seen_at TEXT, token_version INTEGER NOT NULL DEFAULT 1,
      CHECK (token_version > 0)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS lines (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, config TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS grants (
      id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL,
      reference TEXT NOT NULL, at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS rate_limit (
      key TEXT PRIMARY KEY, hits INTEGER NOT NULL, until INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS mail_tokens_user ON mail_tokens(user_id, purpose);
  `);
  return db;
}

export function transact(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  const hash = await derive(password, salt, 64, {N:32768,r:8,p:1,maxmem:64*1024*1024});
  return salt + ':' + hash.toString('hex');
}
const fallbackHash = '00000000000000000000000000000000:' + '00'.repeat(64);
export async function matchesPassword(password, saved) {
  const base = saved ?? fallbackHash;
  const calculated = await passwordHash(password, base.split(':')[0]);
  return timingSafeEqual(Buffer.from(calculated), Buffer.from(base)) && !!saved;
}

export function seal(key, associated, value) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(associated));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

export function unseal(key, associated, value) {
  const data = Buffer.from(value, 'base64url');
  const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0,12));
  cipher.setAAD(Buffer.from(associated));
  cipher.setAuthTag(data.subarray(12,28));
  return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8'));
}

export function deviceView(row) {
  return {
    id:row.id, name:row.name, client:row.client, platform:row.platform, homeRegion:row.home_region,
    createdAt:row.created_at, connectedAt:null, lastSeenAt:row.seen_at, scriptVersion:version, mode:row.mode
  };
}
