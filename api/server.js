import express from 'express';
import { run, get, all } from './db.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';

const app = express();
app.use(express.json());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storageDir = path.join(__dirname, '..', 'data', 'files');
fs.mkdirSync(storageDir, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 200 } });

// Multipart upload endpoint (browser-friendly)
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
  logAudit(req.user.id, 'FILE_UPLOAD_MULTIPART', 'file', file.id, { path: filePath, size: buffer.length }, req.ipAddress);
  res.status(201).json({ name: file.name, path: file.path, size: file.size, mime: file.mime_type, sha256: file.sha256 });
});

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function normalizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    roles: user.roles ? user.roles.split(',') : [],
    mfaEnabled: Boolean(user.mfa_enabled),
    status: user.status,
  };
}

function logAudit(userId, action, resourceType, resourceId, details, ipAddress) {
  run(
    'INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [userId || null, action, resourceType || null, resourceId || null, JSON.stringify(details || {}), ipAddress || null]
  );
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'Unauthorized' });

  const session = get('SELECT * FROM sessions WHERE token = ? AND expires_at > CURRENT_TIMESTAMP', [token]);
  if (!session) return res.status(401).json({ message: 'Invalid or expired token' });

  const user = get('SELECT * FROM users WHERE id = ?', [session.user_id]);
  if (!user) return res.status(401).json({ message: 'User not found' });

  req.user = user;
  req.session = session;
  req.ipAddress = req.ip || req.connection?.remoteAddress || null;
  next();
}

app.post('/api/v1/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Missing credentials' });

  const user = get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || user.password_hash !== hashPassword(password)) {
    logAudit(null, 'LOGIN_FAILED', 'user', null, { email }, req.ip || null);
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  if (user.status === 'locked') return res.status(403).json({ message: 'Account locked' });

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  run('INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)',
    [generateToken(), user.id, token, expiresAt]);

  logAudit(user.id, 'LOGIN', 'user', user.id, {}, req.ip || null);
  res.json({ ok: true, user: normalizeUser(user), token });
});

app.post('/api/v1/auth/login/mfa', (req, res) => {
  const { txId, code } = req.body;
  if (!txId || !code) return res.status(400).json({ message: 'Missing MFA payload' });

  const session = get('SELECT * FROM sessions WHERE id = ? AND token LIKE "temp_%" AND expires_at > CURRENT_TIMESTAMP', [txId]);
  if (!session) return res.status(401).json({ message: 'Invalid MFA session' });

  const user = get('SELECT * FROM users WHERE id = ?', [session.user_id]);
  if (!user) return res.status(401).json({ message: 'User not found' });

  run('DELETE FROM sessions WHERE id = ?', [txId]);
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  run('INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)',
    [generateToken(), user.id, token, expiresAt]);

  logAudit(user.id, 'MFA_VERIFIED', 'user', user.id, {}, req.ip || null);
  res.json({ ok: true, token });
});

app.post('/api/v1/auth/logout', authMiddleware, (req, res) => {
  run('DELETE FROM sessions WHERE token = ?', [req.session.token]);
  logAudit(req.user.id, 'LOGOUT', 'user', req.user.id, {}, req.ipAddress);
  res.json({ ok: true });
});

app.get('/api/v1/me', authMiddleware, (req, res) => {
  res.json(normalizeUser(req.user));
});

app.get('/api/v1/workspaces', authMiddleware, (req, res) => {
  const rows = all(
    `SELECT DISTINCT w.* FROM workspaces w
     LEFT JOIN workspace_users wu ON w.id = wu.workspace_id
     WHERE w.owner_id = ? OR wu.user_id = ?
     ORDER BY w.created_at DESC`,
    [req.user.id, req.user.id]
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
  const path = req.query.path || '/';
  const workspace = get('SELECT * FROM workspaces WHERE id = ?', [id]);
  if (!workspace) return res.status(404).json({ message: 'Workspace not found' });

  const hasAccess = workspace.owner_id === req.user.id ||
    Boolean(get('SELECT 1 FROM workspace_users WHERE workspace_id = ? AND user_id = ?', [id, req.user.id]));
  if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

  const files = all('SELECT * FROM files WHERE workspace_id = ? AND path LIKE ? ORDER BY name ASC', [id, path === '/' ? '/%' : `${path}/%`]);
  res.json(files.map(f => ({ name: f.name, path: f.path, isDir: Boolean(f.is_dir), size: f.size, mime: f.mime_type, updatedAt: f.updated_at, sha256: f.sha256 })));
});

app.post('/api/v1/workspaces/:id/folders', authMiddleware, (req, res) => {
  const { id } = req.params;
  const { path } = req.body;
  const workspace = get('SELECT * FROM workspaces WHERE id = ?', [id]);
  if (!workspace) return res.status(404).json({ message: 'Workspace not found' });
  if (workspace.owner_id !== req.user.id) return res.status(403).json({ message: 'Access denied' });
  if (!path) return res.status(400).json({ message: 'Missing path' });

  const name = path.split('/').filter(Boolean).pop();
  run('INSERT INTO files (workspace_id, path, name, is_dir, created_by) VALUES (?, ?, ?, 1, ?)', [id, path, name, req.user.id]);
  const file = get('SELECT * FROM files WHERE workspace_id = ? AND path = ?', [id, path]);
  logAudit(req.user.id, 'FILE_CREATE', 'file', file.id, { path }, req.ipAddress);
  res.status(201).json({ name: file.name, path: file.path, isDir: true, size: file.size, updatedAt: file.updated_at });
});

app.patch('/api/v1/workspaces/:id/files/:name', authMiddleware, (req, res) => {
  const { id } = req.params;
  const { to } = req.body;
  if (!to) return res.status(400).json({ message: 'Missing target name' });

  const workspace = get('SELECT * FROM workspaces WHERE id = ?', [id]);
  if (!workspace) return res.status(404).json({ message: 'Workspace not found' });
  if (workspace.owner_id !== req.user.id) return res.status(403).json({ message: 'Access denied' });

  const fromPath = decodeURIComponent(req.params.name);
  const file = get('SELECT * FROM files WHERE workspace_id = ? AND path = ?', [id, fromPath]);
  if (!file) return res.status(404).json({ message: 'File not found' });

  const toPath = fromPath.substring(0, fromPath.lastIndexOf('/') + 1) + to;
  run('UPDATE files SET path = ?, name = ? WHERE id = ?', [toPath, to, file.id]);
  const updated = get('SELECT * FROM files WHERE id = ?', [file.id]);
  logAudit(req.user.id, 'FILE_RENAME', 'file', file.id, { from: fromPath, to: toPath }, req.ipAddress);
  res.json({ name: updated.name, path: updated.path, isDir: Boolean(updated.is_dir), size: updated.size, updatedAt: updated.updated_at });
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

// Files: Upload (JSON-based: base64 payload)
app.post('/api/v1/workspaces/:id/files', authMiddleware, (req, res) => {
  const { id } = req.params;
  const { path: filePath, name, contentBase64, mime } = req.body;
  if (!filePath || !name || !contentBase64) return res.status(400).json({ message: 'Missing file payload (path,name,contentBase64)' });

  const workspace = get('SELECT * FROM workspaces WHERE id = ?', [id]);
  if (!workspace) return res.status(404).json({ message: 'Workspace not found' });
  if (workspace.owner_id !== req.user.id) return res.status(403).json({ message: 'Access denied' });

  const buffer = Buffer.from(contentBase64, 'base64');
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const storagePath = path.join(storageDir, sha256);
  if (!fs.existsSync(storagePath)) fs.writeFileSync(storagePath, buffer);

  run('INSERT OR REPLACE INTO files (workspace_id, path, name, is_dir, size, mime_type, sha256, created_by) VALUES (?, ?, ?, 0, ?, ?, ?, ?)',
    [id, filePath, name, buffer.length, mime || 'application/octet-stream', sha256, req.user.id]);

  const file = get('SELECT * FROM files WHERE workspace_id = ? AND path = ?', [id, filePath]);
  logAudit(req.user.id, 'FILE_UPLOAD', 'file', file.id, { path: filePath, size: buffer.length }, req.ipAddress);
  res.status(201).json({ name: file.name, path: file.path, isDir: Boolean(file.is_dir), size: file.size, mime: file.mime_type, sha256: file.sha256 });
});

// Files: Download (returns raw file)
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
  const stream = fs.createReadStream(storagePath);
  stream.pipe(res);
  logAudit(req.user.id, 'FILE_DOWNLOAD', 'file', file.id, { path: file.path }, req.ipAddress);
});

app.get('/api/v1/admin/users', authMiddleware, (req, res) => {
  if (!req.user.roles.includes('admin')) return res.status(403).json({ message: 'Admin access required' });

  const rows = all('SELECT id, email, username, roles, mfa_enabled, status FROM users ORDER BY created_at DESC');
  res.json(rows.map(r => ({ id: r.id, email: r.email, username: r.username, roles: r.roles.split(','), mfaEnabled: Boolean(r.mfa_enabled), status: r.status })));
});

app.post('/api/v1/admin/users', authMiddleware, (req, res) => {
  if (!req.user.roles.includes('admin')) return res.status(403).json({ message: 'Admin access required' });

  const { email, username, password, role } = req.body;
  if (!email || !username || !password) return res.status(400).json({ message: 'Missing required fields' });

  try {
    run('INSERT INTO users (email, username, password_hash, roles, status) VALUES (?, ?, ?, ?, "active")', [email, username, hashPassword(password), role || 'user']);
    const user = get('SELECT * FROM users WHERE email = ?', [email]);
    logAudit(req.user.id, 'USER_CREATE', 'user', user.id, { email, username, role }, req.ipAddress);
    res.status(201).json(normalizeUser(user));
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

app.patch('/api/v1/admin/users/:id', authMiddleware, (req, res) => {
  if (!req.user.roles.includes('admin')) return res.status(403).json({ message: 'Admin access required' });

  const userId = parseInt(req.params.id, 10);
  const { status, role } = req.body;
  const user = get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) return res.status(404).json({ message: 'User not found' });

  if (status) {
    run('UPDATE users SET status = ? WHERE id = ?', [status, userId]);
    logAudit(req.user.id, 'USER_UPDATE', 'user', userId, { status }, req.ipAddress);
  }
  if (role) {
    run('UPDATE users SET roles = ? WHERE id = ?', [role, userId]);
    logAudit(req.user.id, 'USER_ROLE_UPDATE', 'user', userId, { role }, req.ipAddress);
  }

  const updatedUser = get('SELECT * FROM users WHERE id = ?', [userId]);
  res.json(normalizeUser(updatedUser));
});

app.get('/api/v1/admin/audit', authMiddleware, (req, res) => {
  if (!req.user.roles.includes('auditor')) return res.status(403).json({ message: 'Auditor access required' });

  const { from, to } = req.query;
  let query = 'SELECT * FROM audit_logs WHERE 1=1';
  const params = [];

  if (from) {
    query += ' AND created_at >= ?';
    params.push(from);
  }
  if (to) {
    query += ' AND created_at <= ?';
    params.push(to);
  }

  query += ' ORDER BY created_at DESC LIMIT 1000';
  const rows = all(query, params);
  res.json(rows.map(r => ({ ts: r.created_at, actor: r.user_id ? `user_${r.user_id}` : 'system', action: r.action, target: r.resource_type ? `${r.resource_type}_${r.resource_id}` : 'N/A', ip: r.ip_address })));
});

app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(4000, () => console.log('✓ API server listening on http://localhost:4000'));
