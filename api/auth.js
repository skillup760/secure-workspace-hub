// api/auth.js
// Auth primitives: Argon2id passwords, RFC 6238 TOTP MFA, JWT access + rotating refresh tokens.
// Cross-platform: @node-rs/argon2 ships prebuilts for win/linux/mac/arm64; TOTP is inline (no deps).
import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import QRCode from 'qrcode';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-change-me';
const JWT_ISSUER = 'secure-workspace-hub';
const ACCESS_TTL_SEC = 15 * 60;          // 15 minutes
const REFRESH_TTL_SEC = 7 * 24 * 60 * 60; // 7 days
const MFA_TX_TTL_SEC = 5 * 60;            // 5 minutes
const MAX_FAILED = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

// Argon2id tuning — OWASP minimums; comfortable on Pi5 and Win Server alike.
const ARGON_OPTS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19 * 1024, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

// TOTP defaults: SHA-1, 6 digits, 30s step, ±1 step window (RFC 6238 compatible with Google Authenticator / Authy / 1Password).
const TOTP_DIGITS = 6;
const TOTP_STEP = 30;
const TOTP_WINDOW = 1;

export async function hashPassword(plain) {
  return argonHash(plain, ARGON_OPTS);
}

export async function verifyPassword(hash, plain) {
  if (!hash) return false;
  // Legacy sha256 hashes (pre-hardening) — accept once, caller should upgrade.
  if (/^[a-f0-9]{64}$/i.test(hash)) {
    return crypto.createHash('sha256').update(plain).digest('hex') === hash;
  }
  try {
    return await argonVerify(hash, plain);
  } catch {
    return false;
  }
}

export function isLegacyHash(hash) {
  return !!hash && /^[a-f0-9]{64}$/i.test(hash);
}

export function signAccessToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      roles: (user.roles || '').split(',').filter(Boolean),
      typ: 'access',
    },
    JWT_SECRET,
    { issuer: JWT_ISSUER, expiresIn: ACCESS_TTL_SEC },
  );
}

export function verifyAccessToken(token) {
  try {
    const claims = jwt.verify(token, JWT_SECRET, { issuer: JWT_ISSUER });
    if (claims.typ !== 'access') return null;
    return claims;
  } catch {
    return null;
  }
}

export function newRefreshToken() {
  // Opaque random token; we store only its hash.
  return crypto.randomBytes(48).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function newMfaTxId() {
  return 'mfa_' + crypto.randomBytes(16).toString('hex');
}

// ──────────── TOTP (RFC 6238 / 4226) ────────────
// Base32 (RFC 4648) — no padding, uppercase.
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const clean = str.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function hotp(secretBuf, counter) {
  const buf = Buffer.alloc(8);
  // 64-bit big-endian counter
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin = ((hmac[offset] & 0x7f) << 24) |
              ((hmac[offset + 1] & 0xff) << 16) |
              ((hmac[offset + 2] & 0xff) << 8) |
              (hmac[offset + 3] & 0xff);
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export function newTotpSecret() {
  // 20 random bytes → 160 bits → 32 base32 chars (RFC 4226 recommendation).
  return base32Encode(crypto.randomBytes(20));
}

export function totpUri(secret, accountName, issuer = 'SecureWorkspaceHub') {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export async function totpQrDataUrl(uri) {
  return QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 1 });
}

export function verifyTotp(secret, code) {
  if (!secret || !code) return false;
  const normalized = String(code).replace(/\s+/g, '').trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  let secretBuf;
  try { secretBuf = base32Decode(secret); } catch { return false; }
  const counter = Math.floor(Date.now() / 1000 / TOTP_STEP);
  for (let w = -TOTP_WINDOW; w <= TOTP_WINDOW; w++) {
    const expected = hotp(secretBuf, counter + w);
    // Constant-time compare
    if (expected.length === normalized.length &&
        crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(normalized))) {
      return true;
    }
  }
  return false;
}

export const AUTH_CONSTANTS = {
  ACCESS_TTL_SEC,
  REFRESH_TTL_SEC,
  MFA_TX_TTL_SEC,
  MAX_FAILED,
  LOCKOUT_MS,
  JWT_SECRET_PRESENT: !!process.env.JWT_SECRET,
};
