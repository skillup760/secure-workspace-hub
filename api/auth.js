// api/auth.js
// Auth primitives: Argon2id passwords, TOTP MFA, JWT access + refresh tokens.
// Cross-platform: @node-rs/argon2 ships prebuilts for win/linux/mac/arm64.
import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';
import { authenticator } from 'otplib';
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

authenticator.options = { window: 1, step: 30, digits: 6 };

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

// TOTP
export function newTotpSecret() {
  return authenticator.generateSecret();
}

export function totpUri(secret, accountName, issuer = 'SecureWorkspaceHub') {
  return authenticator.keyuri(accountName, issuer, secret);
}

export async function totpQrDataUrl(uri) {
  return QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 1 });
}

export function verifyTotp(secret, code) {
  if (!secret || !code) return false;
  try {
    return authenticator.check(String(code).trim(), secret);
  } catch {
    return false;
  }
}

export const AUTH_CONSTANTS = {
  ACCESS_TTL_SEC,
  REFRESH_TTL_SEC,
  MFA_TX_TTL_SEC,
  MAX_FAILED,
  LOCKOUT_MS,
  JWT_SECRET_PRESENT: !!process.env.JWT_SECRET,
};
