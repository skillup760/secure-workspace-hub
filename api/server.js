import express from 'express';
import { run, get, all } from './db.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import {
  hashPassword,
  verifyPassword,
  isLegacyHash,
  signAccessToken,
  verifyAccessToken,
  newRefreshToken,
  hashToken,
  newMfaTxId,
  newTotpSecret,
  totpUri,
  totpQrDataUrl,
  verifyTotp,
  AUTH_CONSTANTS,
} from './auth.js';
import { scanBuffer, getScannerInfo } from './scanner.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storageDir = path.join(__dirname, '..', 'data', 'files');
fs.mkdirSync(storageDir, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 200 } });

// ───────────────────────── helpers ─────────────────────────
function normalizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    roles: user.roles ? user.roles.split(',').filter(Boolean) : [],
    mfaEnabled: Boolean(user.mfa_enabled),
    status: user.status,
  };
}

function logAudit(userId, action, resourceType, resourceId, details, ipAddress) {
  run(
    'INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [userId || null, action, resourceType || null, resourceId || null, JSON.stringify(details || {}), ipAddress || null],
  );
}

function clientIp(req) {
  return req.headers['x-forwarded-for']?.toString().split(',')[0].trim()
    || req.ip || req.connection?.remoteAddress || null;
}

function nowIso() { return new Date().toISOString(); }
function isoIn(ms) { return new Date(Date.now() + ms).toISOString(); }

async function registerFailedAttempt(user) {
  const next = (user.failed_attempts || 0) + 1;
  if (next >= AUTH_CONSTANTS.MAX_FAILED) {
    run('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?',
      [next, isoIn(AUTH_CONSTANTS.LOCKOUT_MS), user.id]);
  } else {
    run('UPDATE users SET failed_attempts = ? WHERE id = ?', [next, user.id]);
  }
}

function resetFailedAttempts(userId) {
  run('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?',
    [nowIso(), userId]);
}

function isLockedOut(user) {
  if (!user.locked_until) return false;
  return new Date(user.locked_until).getTime() > Date.now();
}

async function issueTokenPair(user, req, parentRefreshId = null) {
  const accessToken = signAccessToken(user);
  const refresh = newRefreshToken();
  const id = crypto.randomBytes(16).toString('hex');
  run(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, parent_id, user_agent, ip_address, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      user.id,
      hashToken(refresh),
      parentRefreshId,
      (req.headers['user-agent'] || '').toString().slice(0, 255),
      clientIp(req),
      isoIn(AUTH_CONSTANTS.REFRESH_TTL_SEC * 1000),
    ],
  );
  return {
    accessToken,
    refreshToken: refresh,
    expiresIn: AUTH_CONSTANTS.ACCESS_TTL_SEC,
  };
}

function revokeRefresh(id) {
  run('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?', [nowIso(), id]);
}

function revokeAllUserRefresh(userId) {
  run('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
    [nowIso(), userId]);
}

// ───────────────────────── middleware ─────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ message: 'Unauthorized' });

  const claims = verifyAccessToken(token);
  if (!claims) return res.status(401).json({ message: 'Invalid or expired token' });

  const user = get('SELECT * FROM users WHERE id = ?', [Number(claims.sub)]);
  if (!user) return res.status(401).json({ message: 'User not found' });
  if (user.status !== 'active') return res.status(403).json({ message: 'Account not active' });

  req.user = user;
  req.claims = claims;
  req.ipAddress = clientIp(req);
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    const roles = (req.user.roles || '').split(',').filter(Boolean);
    if (!roles.includes(role)) return res.status(403).json({ message: `${role} access required` });
    next();
  };
}

// ───────────────────────── auth endpoints ─────────────────────────
app.post('/api/v1/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ message: 'Missing credentials' });

  const user = get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user) {
    // Constant-ish time: still verify against a dummy hash to reduce user-enumeration timing.
    await verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$YWFhYWFhYWFhYWFhYWFhYQ$cm5kZmFrZXJuZGZha2VybmRmYWtlcm5kZmFrZXI', password);
    logAudit(null, 'LOGIN_FAILED', 'user', null, { email }, clientIp(req));
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  if (user.status === 'locked' || isLockedOut(user)) {
    logAudit(user.id, 'LOGIN_BLOCKED_LOCKED', 'user', user.id, {}, clientIp(req));
    return res.status(423).json({ message: 'Account locked. Try again later.' });
  }
  if (user.status !== 'active') {
    return res.status(403).json({ message: 'Account not active' });
  }

  const ok = await verifyPassword(user.password_hash, password);
  if (!ok) {
    await registerFailedAttempt(user);
    logAudit(user.id, 'LOGIN_FAILED', 'user', user.id, { email }, clientIp(req));
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  // Upgrade legacy sha256 → Argon2id transparently
  if (isLegacyHash(user.password_hash)) {
    const upgraded = await hashPassword(password);
    run('UPDATE users SET password_hash = ? WHERE id = ?', [upgraded, user.id]);
    logAudit(user.id, 'PASSWORD_HASH_UPGRADED', 'user', user.id, {}, clientIp(req));
  }

  // If MFA enabled → issue short-lived MFA challenge, no tokens yet.
  if (user.mfa_enabled) {
    const txId = newMfaTxId();
    run('INSERT INTO mfa_txs (id, user_id, expires_at) VALUES (?, ?, ?)',
      [txId, user.id, isoIn(AUTH_CONSTANTS.MFA_TX_TTL_SEC * 1000)]);
    logAudit(user.id, 'MFA_CHALLENGE_ISSUED', 'user', user.id, {}, clientIp(req));
    return res.json({ mfaRequired: true, txId });
  }

  resetFailedAttempts(user.id);
  const tokens = await issueTokenPair(user, req);
  logAudit(user.id, 'LOGIN', 'user', user.id, {}, clientIp(req));
  return res.json({ mfaRequired: false, user: normalizeUser(user), ...tokens });
});

app.post('/api/v1/auth/login/mfa', async (req, res) => {
  const { txId, code } = req.body || {};
  if (!txId || !code) return res.status(400).json({ message: 'Missing MFA payload' });

  const tx = get('SELECT * FROM mfa_txs WHERE id = ?', [txId]);
  if (!tx) return res.status(401).json({ message: 'Invalid MFA session' });
  if (new Date(tx.expires_at).getTime() < Date.now()) {
    run('DELETE FROM mfa_txs WHERE id = ?', [txId]);
    return res.status(401).json({ message: 'MFA session expired' });
  }

  const user = get('SELECT * FROM users WHERE id = ?', [tx.user_id]);
  if (!user) return res.status(401).json({ message: 'User not found' });

  if (!verifyTotp(user.mfa_secret, code)) {
    await registerFailedAttempt(user);
    logAudit(user.id, 'MFA_FAILED', 'user', user.id, {}, clientIp(req));
    return res.status(401).json({ message: 'Invalid code' });
  }

  run('DELETE FROM mfa_txs WHERE id = ?', [txId]);
  resetFailedAttempts(user.id);
  const tokens = await issueTokenPair(user, req);
  logAudit(user.id, 'MFA_VERIFIED', 'user', user.id, {}, clientIp(req));
  return res.json({ user: normalizeUser(user), ...tokens });
});

app.post('/api/v1/auth/refresh', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ message: 'Missing refresh token' });

  const row = get('SELECT * FROM refresh_tokens WHERE token_hash = ?', [hashToken(refreshToken)]);
  if (!row) return res.status(401).json({ message: 'Invalid refresh token' });

  if (row.revoked_at) {
    // Reuse detected → revoke entire family for this user.
    revokeAllUserRefresh(row.user_id);
    logAudit(row.user_id, 'REFRESH_REUSE_DETECTED', 'user', row.user_id, {}, clientIp(req));
    return res.status(401).json({ message: 'Refresh token reuse detected; please sign in again.' });
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return res.status(401).json({ message: 'Refresh token expired' });
  }

  const user = get('SELECT * FROM users WHERE id = ?', [row.user_id]);
  if (!user || user.status !== 'active') return res.status(401).json({ message: 'User unavailable' });

  // Rotate
  revokeRefresh(row.id);
  const tokens = await issueTokenPair(user, req, row.id);
  logAudit(user.id, 'REFRESH_ROTATED', 'user', user.id, {}, clientIp(req));
  return res.json({ user: normalizeUser(user), ...tokens });
});

app.post('/api/v1/auth/logout', authMiddleware, (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) {
    const row = get('SELECT id FROM refresh_tokens WHERE token_hash = ?', [hashToken(refreshToken)]);
    if (row) revokeRefresh(row.id);
  }
  logAudit(req.user.id, 'LOGOUT', 'user', req.user.id, {}, req.ipAddress);
  res.json({ ok: true });
});

app.get('/api/v1/me', authMiddleware, (req, res) => {
  res.json(normalizeUser(req.user));
});

// ───────────────────────── MFA enroll / disable ─────────────────────────
app.post('/api/v1/auth/mfa/enroll', authMiddleware, async (req, res) => {
  const secret = newTotpSecret();
  run('UPDATE users SET mfa_pending_secret = ? WHERE id = ?', [secret, req.user.id]);
  const uri = totpUri(secret, req.user.email);
  const qr = await totpQrDataUrl(uri);
  logAudit(req.user.id, 'MFA_ENROLL_START', 'user', req.user.id, {}, req.ipAddress);
  res.json({ secret, otpauthUri: uri, qrDataUrl: qr });
});

app.post('/api/v1/auth/mfa/confirm', authMiddleware, (req, res) => {
  const { code } = req.body || {};
  const user = get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!user.mfa_pending_secret) return res.status(400).json({ message: 'No pending MFA enrollment' });
  if (!verifyTotp(user.mfa_pending_secret, code)) {
    return res.status(401).json({ message: 'Invalid code' });
  }
  run('UPDATE users SET mfa_secret = ?, mfa_pending_secret = NULL, mfa_enabled = 1 WHERE id = ?',
    [user.mfa_pending_secret, user.id]);
  logAudit(user.id, 'MFA_ENABLED', 'user', user.id, {}, req.ipAddress);
  res.json({ mfaEnabled: true });
});

app.post('/api/v1/auth/mfa/disable', authMiddleware, async (req, res) => {
  const { password, code } = req.body || {};
  if (!password) return res.status(400).json({ message: 'Password required' });
  const ok = await verifyPassword(req.user.password_hash, password);
  if (!ok) return res.status(401).json({ message: 'Invalid password' });
  if (req.user.mfa_enabled && !verifyTotp(req.user.mfa_secret, code)) {
    return res.status(401).json({ message: 'Invalid MFA code' });
  }
  run('UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, mfa_pending_secret = NULL WHERE id = ?',
    [req.user.id]);
  revokeAllUserRefresh(req.user.id);
  logAudit(req.user.id, 'MFA_DISABLED', 'user', req.user.id, {}, req.ipAddress);
  res.json({ mfaEnabled: false });
});

// Change password — rotates all refresh tokens
app.post('/api/v1/auth/password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ message: 'Missing fields' });
  if (newPassword.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' });
  const ok = await verifyPassword(req.user.password_hash, currentPassword);
  if (!ok) return res.status(401).json({ message: 'Current password incorrect' });
  const hashed = await hashPassword(newPassword);
  run('UPDATE users SET password_hash = ? WHERE id = ?', [hashed, req.user.id]);
  revokeAllUserRefresh(req.user.id);
  logAudit(req.user.id, 'PASSWORD_CHANGED', 'user', req.user.id, {}, req.ipAddress);
  res.json({ ok: true });
});

// ───────────────────────── workspaces / files (unchanged) ─────────────────────────
app.get('/api/v1/workspaces', authMiddleware, (req, res) => {
  const rows = all(
    `SELECT DISTINCT w.* FROM workspaces w
     LEFT JOIN workspace_users wu ON w.id = wu.workspace_id
     WHERE w.owner_id = ? OR wu.user_id = ?
     ORDER BY w.created_at DESC`,
    [req.user.id, req.user.id],
  );
  res.json(rows.map(r => ({ id: r.id, name: r.name, isShared: Boolean(r.is_shared), quotaBytes: r.quota_bytes, usedBytes: r.used_bytes })));
});

app.post('/api/v1/workspaces', authMiddleware, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ message: 'Missing name' });
  run('INSERT INTO workspaces (name, owner_id) VALUES (?, ?)', [name, req.user.id]);
  const workspace = get('SELECT * FROM workspaces WHERE owner_id = ? ORDER BY id DESC LIMIT 1', [req.user.id]);
  logAudit(req.user.id, 'WORKSPACE_CREATE', 'workspace', workspace.id, { name }, req.ipAddress);
  res.status(201).json({ id: workspace.id, name: workspace.name, isShared: Boolean(workspace.is_shared), quotaBytes: workspace.quota_bytes, usedBytes: workspace.used_bytes });
});

app.get('/api/v1/workspaces/:id/tree', authMiddleware, (req, res) => {
  const { id } = req.params;
  const qPath = req.query.path || '/';
  const workspace = get('SELECT * FROM workspaces WHERE id = ?', [id]);
  if (!workspace) return res.status(404).json({ message: 'Workspace not found' });
  const hasAccess = workspace.owner_id === req.user.id ||
    Boolean(get('SELECT 1 FROM workspace_users WHERE workspace_id = ? AND user_id = ?', [id, req.user.id]));
  if (!hasAccess) return res.status(403).json({ message: 'Access denied' });
  const files = all('SELECT * FROM files WHERE workspace_id = ? AND path LIKE ? ORDER BY name ASC', [id, qPath === '/' ? '/%' : `${qPath}/%`]);
  res.json(files.map(f => ({ name: f.name, path: f.path, isDir: Boolean(f.is_dir), size: f.size, mime: f.mime_type, updatedAt: f.updated_at, sha256: f.sha256 })));
});

app.post('/api/v1/workspaces/:id/folders', authMiddleware, (req, res) => {
  const { id } = req.params;
  const { path: p } = req.body;
  const workspace = get('SELECT * FROM workspaces WHERE id = ?', [id]);
  if (!workspace) return res.status(404).json({ message: 'Workspace not found' });
  if (workspace.owner_id !== req.user.id) return res.status(403).json({ message: 'Access denied' });
  if (!p) return res.status(400).json({ message: 'Missing path' });
  const name = p.split('/').filter(Boolean).pop();
  run('INSERT INTO files (workspace_id, path, name, is_dir, created_by) VALUES (?, ?, ?, 1, ?)', [id, p, name, req.user.id]);
  const file = get('SELECT * FROM files WHERE workspace_id = ? AND path = ?', [id, p]);
  logAudit(req.user.id, 'FILE_CREATE', 'file', file.id, { path: p }, req.ipAddress);
  res.status(201).json({ name: file.name, path: file.path, isDir: true, size: file.size, updatedAt: file.updated_at });
});

app.post('/api/v1/workspaces/:id/upload', authMiddleware, upload.single('file'), (req, res) => {
  const { id } = req.params;
  const folder = req.body.path || '/';
  if (!req.file) return res.status(400).json({ message: 'Missing file' });
  const workspace = get('SELECT * FROM workspaces WHERE id = ?', [id]);
  if (!workspace) return res.status(404).json({ message: 'Workspace not found' });
  if (workspace.owner_id !== req.user.id) return res.status(403).json({ message: 'Access denied' });
  const buffer = req.file.buffer;
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const storagePath = path.join(storageDir, sha256);
  if (!fs.existsSync(storagePath)) fs.writeFileSync(storagePath, buffer);
  const filePath = (folder === '/' ? '/' : folder.replace(/\/$/, '')) + '/' + req.file.originalname;
  run('INSERT OR REPLACE INTO files (workspace_id, path, name, is_dir, size, mime_type, sha256, created_by) VALUES (?, ?, ?, 0, ?, ?, ?, ?)',
    [id, filePath, req.file.originalname, buffer.length, req.file.mimetype || 'application/octet-stream', sha256, req.user.id]);
  const file = get('SELECT * FROM files WHERE workspace_id = ? AND path = ?', [id, filePath]);
  logAudit(req.user.id, 'FILE_UPLOAD', 'file', file.id, { path: filePath, size: buffer.length }, req.ipAddress);
  res.status(201).json({ name: file.name, path: file.path, size: file.size, mime: file.mime_type, sha256: file.sha256 });
});

app.get('/api/v1/workspaces/:id/files/download', authMiddleware, (req, res) => {
  const { id } = req.params;
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ message: 'Missing path query' });
  const workspace = get('SELECT * FROM workspaces WHERE id = ?', [id]);
  if (!workspace) return res.status(404).json({ message: 'Workspace not found' });
  const hasAccess = workspace.owner_id === req.user.id ||
    Boolean(get('SELECT 1 FROM workspace_users WHERE workspace_id = ? AND user_id = ?', [id, req.user.id]));
  if (!hasAccess) return res.status(403).json({ message: 'Access denied' });
  const file = get('SELECT * FROM files WHERE workspace_id = ? AND path = ?', [id, filePath]);
  if (!file) return res.status(404).json({ message: 'File not found' });
  const storagePath = path.join(storageDir, file.sha256 || '');
  if (!file.sha256 || !fs.existsSync(storagePath)) return res.status(404).json({ message: 'File content missing' });
  const stat = fs.statSync(storagePath);
  res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
  fs.createReadStream(storagePath).pipe(res);
  logAudit(req.user.id, 'FILE_DOWNLOAD', 'file', file.id, { path: file.path }, req.ipAddress);
});

app.delete('/api/v1/workspaces/:id/files/:name', authMiddleware, (req, res) => {
  const { id } = req.params;
  const workspace = get('SELECT * FROM workspaces WHERE id = ?', [id]);
  if (!workspace) return res.status(404).json({ message: 'Workspace not found' });
  if (workspace.owner_id !== req.user.id) return res.status(403).json({ message: 'Access denied' });
  const filePath = decodeURIComponent(req.params.name);
  const file = get('SELECT * FROM files WHERE workspace_id = ? AND path = ?', [id, filePath]);
  if (!file) return res.status(404).json({ message: 'File not found' });
  run('DELETE FROM files WHERE id = ?', [file.id]);
  logAudit(req.user.id, 'FILE_DELETE', 'file', file.id, { path: filePath }, req.ipAddress);
  res.status(204).end();
});

// ───────────────────────── admin ─────────────────────────
app.get('/api/v1/admin/users', authMiddleware, requireRole('admin'), (req, res) => {
  const rows = all('SELECT id, email, username, roles, mfa_enabled, status FROM users ORDER BY created_at DESC');
  res.json(rows.map(r => ({ id: r.id, email: r.email, username: r.username, roles: r.roles.split(','), mfaEnabled: Boolean(r.mfa_enabled), status: r.status })));
});

app.post('/api/v1/admin/users', authMiddleware, requireRole('admin'), async (req, res) => {
  const { email, username, password, role } = req.body || {};
  if (!email || !username || !password) return res.status(400).json({ message: 'Missing required fields' });
  if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' });
  try {
    const hashed = await hashPassword(password);
    run('INSERT INTO users (email, username, password_hash, roles, status) VALUES (?, ?, ?, ?, "active")',
      [email, username, hashed, role || 'user']);
    const user = get('SELECT * FROM users WHERE email = ?', [email]);
    logAudit(req.user.id, 'USER_CREATE', 'user', user.id, { email, username, role }, req.ipAddress);
    res.status(201).json(normalizeUser(user));
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

app.patch('/api/v1/admin/users/:id', authMiddleware, requireRole('admin'), (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const { status, role } = req.body;
  const user = get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) return res.status(404).json({ message: 'User not found' });
  if (status) {
    run('UPDATE users SET status = ? WHERE id = ?', [status, userId]);
    if (status === 'locked' || status === 'disabled') revokeAllUserRefresh(userId);
    logAudit(req.user.id, 'USER_UPDATE', 'user', userId, { status }, req.ipAddress);
  }
  if (role) {
    run('UPDATE users SET roles = ? WHERE id = ?', [role, userId]);
    logAudit(req.user.id, 'USER_ROLE_UPDATE', 'user', userId, { role }, req.ipAddress);
  }
  res.json(normalizeUser(get('SELECT * FROM users WHERE id = ?', [userId])));
});

app.post('/api/v1/admin/users/:id/unlock', authMiddleware, requireRole('admin'), (req, res) => {
  const userId = parseInt(req.params.id, 10);
  run('UPDATE users SET failed_attempts = 0, locked_until = NULL, status = "active" WHERE id = ?', [userId]);
  logAudit(req.user.id, 'USER_UNLOCKED', 'user', userId, {}, req.ipAddress);
  res.json({ ok: true });
});

app.get('/api/v1/admin/audit', authMiddleware, (req, res) => {
  const roles = (req.user.roles || '').split(',');
  if (!roles.includes('auditor') && !roles.includes('admin')) {
    return res.status(403).json({ message: 'Auditor access required' });
  }
  const { from, to } = req.query;
  let query = 'SELECT * FROM audit_logs WHERE 1=1';
  const params = [];
  if (from) { query += ' AND created_at >= ?'; params.push(from); }
  if (to) { query += ' AND created_at <= ?'; params.push(to); }
  query += ' ORDER BY created_at DESC LIMIT 1000';
  const rows = all(query, params);
  res.json(rows.map(r => ({ ts: r.created_at, actor: r.user_id ? `user_${r.user_id}` : 'system', action: r.action, target: r.resource_type ? `${r.resource_type}_${r.resource_id}` : 'N/A', ip: r.ip_address })));
});

app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', timestamp: nowIso(), jwtConfigured: AUTH_CONSTANTS.JWT_SECRET_PRESENT });
});

app.listen(4000, () => console.log('✓ API server listening on http://localhost:4000'));
