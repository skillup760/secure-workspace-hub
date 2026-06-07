Local API + SQLite

Quickstart:

1. Install dependencies:

```bash
npm install
```

2. Start the local API server (creates `data/database.sqlite` on first run):

```bash
npm run dev:api
```

3. During development run the frontend:

```bash
npm run dev
```

Vite dev is configured to proxy `/api` to `http://localhost:4000` so the frontend's `src/lib/api-client.ts` can use the default `/api/v1` base path.

Notes:
- The API is intentionally minimal and uses `better-sqlite3` for a zero-config local DB.
- Seed admin user: `admin@example.com` / `password`.
