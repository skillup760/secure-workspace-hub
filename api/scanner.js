// api/scanner.js
// Pluggable virus scanner with three adapters:
//   - noop     : no-op, returns clean (default; safe for dev / Pi without AV).
//   - clamav   : streams the buffer to clamd over TCP (INSTREAM protocol).
//   - defender : invokes MpCmdRun.exe -Scan (Windows Defender / MS Defender for Servers).
//
// Selection: env SWH_SCANNER = noop | clamav | defender   (default: noop)
// Cross-platform: pure Node stdlib, no native deps. Adapters fail closed (block
// upload) on infection; fail-open on transport errors only with a logged warning
// so a single misconfigured AV box doesn't take down uploads.

import net from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';

const SCANNER = (process.env.SWH_SCANNER || 'noop').toLowerCase();
const CLAMAV_HOST = process.env.CLAMAV_HOST || '127.0.0.1';
const CLAMAV_PORT = Number(process.env.CLAMAV_PORT || 3310);
const CLAMAV_TIMEOUT_MS = Number(process.env.CLAMAV_TIMEOUT_MS || 30_000);
const DEFENDER_PATH = process.env.DEFENDER_PATH
  || 'C:\\Program Files\\Windows Defender\\MpCmdRun.exe';
const DEFENDER_TIMEOUT_MS = Number(process.env.DEFENDER_TIMEOUT_MS || 60_000);

// Result shape: { clean: boolean, threat: string|null, scanner: string, skipped?: boolean, error?: string }
export async function scanBuffer(buffer, filename = 'upload.bin') {
  switch (SCANNER) {
    case 'clamav':   return scanClamAV(buffer, filename);
    case 'defender': return scanDefender(buffer, filename);
    case 'noop':
    default:         return { clean: true, threat: null, scanner: 'noop', skipped: true };
  }
}

export function getScannerInfo() {
  return {
    scanner: SCANNER,
    clamav: SCANNER === 'clamav' ? { host: CLAMAV_HOST, port: CLAMAV_PORT } : undefined,
    defender: SCANNER === 'defender' ? { path: DEFENDER_PATH } : undefined,
  };
}

// ───────────────────────── ClamAV INSTREAM ─────────────────────────
// Protocol: zINSTREAM\0  →  [BE-uint32 length][chunk]...  →  [BE-uint32 0]  →  reply ending with "\0"
function scanClamAV(buffer, filename) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let response = '';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(CLAMAV_TIMEOUT_MS);
    socket.on('timeout', () => finish({
      clean: true, threat: null, scanner: 'clamav', skipped: true,
      error: 'clamav timeout — upload allowed (fail-open). Check clamd connectivity.',
    }));
    socket.on('error', (err) => finish({
      clean: true, threat: null, scanner: 'clamav', skipped: true,
      error: `clamav transport error: ${err.message} — upload allowed (fail-open).`,
    }));
    socket.on('data', (chunk) => { response += chunk.toString('utf8'); });
    socket.on('close', () => {
      if (settled) return;
      const reply = response.replace(/\0$/, '').trim();
      // Examples: "stream: OK", "stream: Eicar-Test-Signature FOUND", "stream: <error> ERROR"
      if (/\bFOUND\b/.test(reply)) {
        const m = reply.match(/stream:\s*(.+?)\s+FOUND/);
        finish({ clean: false, threat: m ? m[1] : 'unknown', scanner: 'clamav' });
      } else if (/\bERROR\b/.test(reply)) {
        finish({
          clean: true, threat: null, scanner: 'clamav', skipped: true,
          error: `clamav: ${reply} — upload allowed (fail-open).`,
        });
      } else {
        finish({ clean: true, threat: null, scanner: 'clamav' });
      }
    });

    socket.connect(CLAMAV_PORT, CLAMAV_HOST, () => {
      socket.write('zINSTREAM\0');
      // Chunk in 64 KiB blocks (clamd default StreamMaxLength is 25 MiB; we trust caller's multer cap).
      const CHUNK = 65_536;
      for (let i = 0; i < buffer.length; i += CHUNK) {
        const slice = buffer.subarray(i, Math.min(i + CHUNK, buffer.length));
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32BE(slice.length, 0);
        socket.write(lenBuf);
        socket.write(slice);
      }
      const term = Buffer.alloc(4); // 0-length sentinel
      socket.write(term);
    });
  });
}

// ───────────────────────── Windows Defender ─────────────────────────
// We materialize the buffer to a temp file, then call:
//   MpCmdRun.exe -Scan -ScanType 3 -File <path> -DisableRemediation
// Exit codes (per MS docs): 0 = no threats, 2 = threats found.
async function scanDefender(buffer, filename) {
  if (process.platform !== 'win32') {
    return {
      clean: true, threat: null, scanner: 'defender', skipped: true,
      error: 'defender scanner selected on non-Windows host — upload allowed (fail-open).',
    };
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swh-scan-'));
  const safeName = path.basename(filename).replace(/[^\w.\-]/g, '_') || 'upload.bin';
  const tmpFile = path.join(tmpDir, `${crypto.randomBytes(6).toString('hex')}_${safeName}`);
  try {
    fs.writeFileSync(tmpFile, buffer);
    const result = await runDefenderScan(tmpFile);
    return result;
  } catch (err) {
    return {
      clean: true, threat: null, scanner: 'defender', skipped: true,
      error: `defender invocation failed: ${err.message} — upload allowed (fail-open).`,
    };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    try { fs.rmdirSync(tmpDir); } catch { /* ignore */ }
  }
}

function runDefenderScan(filePath) {
  return new Promise((resolve) => {
    const args = ['-Scan', '-ScanType', '3', '-File', filePath, '-DisableRemediation'];
    const proc = spawn(DEFENDER_PATH, args, { windowsHide: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => {
      proc.kill();
      resolve({
        clean: true, threat: null, scanner: 'defender', skipped: true,
        error: 'defender timeout — upload allowed (fail-open).',
      });
    }, DEFENDER_TIMEOUT_MS);
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        clean: true, threat: null, scanner: 'defender', skipped: true,
        error: `defender spawn error: ${err.message} — upload allowed (fail-open).`,
      });
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ clean: true, threat: null, scanner: 'defender' });
      if (code === 2) {
        // Parse "Threat  : <name>" or "Threat information"; fall back to a generic label.
        const m = stdout.match(/Threat\s*:\s*([^\r\n]+)/i)
          || stdout.match(/Threat information.*?Name\s*:\s*([^\r\n]+)/is);
        return resolve({ clean: false, threat: m ? m[1].trim() : 'Defender-Detection', scanner: 'defender' });
      }
      // Unknown exit codes → fail-open with stderr breadcrumb.
      resolve({
        clean: true, threat: null, scanner: 'defender', skipped: true,
        error: `defender exit ${code}: ${(stderr || stdout).slice(0, 200)} — upload allowed (fail-open).`,
      });
    });
  });
}
