# Secure Workspace Hub — OS-Independent Deployment

The platform is designed to run **identically** on:

| Host                     | Mode A: Bare Node | Mode B: Docker Compose |
| ------------------------ | ----------------- | ---------------------- |
| Windows Server 2019/2022 | ✅                | ✅ (Docker Desktop / WSL2) |
| Windows 10/11            | ✅                | ✅                     |
| Ubuntu / Debian / RHEL   | ✅                | ✅                     |
| macOS (Intel / Apple Si) | ✅                | ✅                     |
| Raspberry Pi 5 (arm64)   | ✅                | ✅                     |

There is **one codebase, one config surface, two install paths**. Pick the one that fits your environment.

---

## Architecture choices that make it OS-independent

| Concern              | Choice                                                   | Why                                     |
| -------------------- | -------------------------------------------------------- | --------------------------------------- |
| Runtime              | Node.js 20 LTS                                           | Identical APIs on Win/Linux/macOS/arm64 |
| DB (default)         | SQLite via `better-sqlite3` (prebuilt binaries)          | No external service, works everywhere   |
| DB (scale-out, opt.) | PostgreSQL via Docker profile                            | Same SQL layer, swap by env var         |
| Filesystem           | `node:fs` + `node:path` — never hard-coded `/` or `\\`   | Path-safe on every OS                   |
| Service manager      | None required. Optional adapters: NSSM (Win), systemd (Linux), launchd (mac) | Pick per host |
| Reverse proxy / TLS  | Caddy in Docker profile, or IIS / Nginx natively         | Optional, not coupled to app            |
| Antivirus            | Pluggable `VirusScanner` interface (`noop` / `clamav` / `defender`) | Daemon only in Docker `--profile av`     |
| VPN                  | WireGuard managed only under Docker `--profile vpn` (Linux kernel host or WSL2). Bare-Node mode treats it as read-only status. | Avoids platform-specific kernel deps |
| Secrets              | `.env` file (gitignored). No OS keyring required.        | Portable                                |
| Process signals      | `tini` in container; `process.on('SIGINT'/'SIGTERM')` in bare Node | Clean shutdown everywhere       |

---

## Mode A — Bare Node (any OS)

Requirements: Node.js **20 LTS** and Git.

```bash
git clone <repo> swh && cd swh
node scripts/setup.mjs        # creates ./data, generates .env + JWT_SECRET
npm install
npm start
```

The server listens on `http://localhost:8080`. Data lives in `./data` (SQLite DB + content-addressed blobs).

### Run as a service

| OS              | Command                                              |
| --------------- | ---------------------------------------------------- |
| Windows Server  | `npm i -g node-windows` then `node scripts/win-service.mjs install` *(template, see `deploy/windows/`)* |
| Linux (systemd) | `sudo cp deploy/linux/swh.service /etc/systemd/system/ && sudo systemctl enable --now swh` |
| macOS (launchd) | `cp deploy/macos/com.swh.plist ~/Library/LaunchAgents/ && launchctl load ...` |

---

## Mode B — Docker Compose (any OS with Docker)

Requirements: Docker 24+ (Docker Desktop on Windows/macOS, Docker Engine on Linux).

```bash
cp .env.example .env          # edit JWT_SECRET
docker compose up -d                          # app only
docker compose --profile av up -d             # + ClamAV
docker compose --profile proxy up -d          # + Caddy HTTPS
docker compose --profile vpn up -d            # + WireGuard (Linux/WSL2 host)
```

Compose profiles let you enable only what your host supports. On Windows Server **with WSL2 backend** all four profiles work. On Windows containers (process isolation) only `app` + `proxy` are supported — use `--profile av` via the WSL2 backend or run ClamAV separately.

---

## Windows Server specifics

1. **Install path A (recommended for simplicity):** Docker Desktop with WSL2 → `docker compose up -d`. Identical to Linux.
2. **Install path B (no Docker):**
   - Install Node.js 20 LTS MSI.
   - `git clone …` and `node scripts/setup.mjs`.
   - `npm install` (better-sqlite3 ships a Windows prebuilt — no Visual Studio Build Tools needed for Node 20).
   - Register the service with [NSSM](https://nssm.cc/) or `node-windows`:
     ```cmd
     nssm install SecureWorkspaceHub "C:\Program Files\nodejs\node.exe" "C:\swh\index.js"
     nssm set    SecureWorkspaceHub AppDirectory "C:\swh"
     nssm set    SecureWorkspaceHub AppEnvironmentExtra DATA_DIR=D:\swh-data JWT_SECRET=...
     nssm start  SecureWorkspaceHub
     ```
   - Front it with IIS (URL Rewrite + ARR) or just open port 8080 on the firewall.
3. **Antivirus:** set `SWH_SCANNER=defender` to invoke `MpCmdRun.exe -Scan -ScanType 3 -File <path>` on uploads. No daemon needed; Windows Defender is already present.
4. **VPN:** if you need WireGuard on Windows, install the official [WireGuard for Windows](https://www.wireguard.com/install/) MSI; the admin UI shows peers read-only via a tunnel-config file path (`SWH_WG_CONFIG=C:\Program Files\WireGuard\Data\Configurations\wg0.conf.dpapi.ndk`).

---

## What is **not** OS-specific in the code

- No shell-outs to `bash`, `sh`, `cmd`, `powershell` in the request path.
- No hard-coded `/var/...`, `C:\...`, or `~/...` — everything goes through `DATA_DIR` env or `path.join(...)`.
- No Linux-only Node modules (`node-pty`, `unix-dgram`, etc.).
- File permissions handled at the application layer (ownership, ACLs in DB), not via `chown`/`icacls`.

---

## Verification matrix

Run `npm run check:portability` (added in `package.json`) to assert:

- `path.sep`-safe storage paths
- `better-sqlite3` loads on the current platform
- `DATA_DIR` is writable
- No `child_process.exec` calls without explicit allow-list

Any failure blocks startup with a clear error and pointer to this document.
