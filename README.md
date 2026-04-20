# Wave Streaming Platform

Prototype music streaming platform focused on royalty transparency. The system records listening activity, runs a repeatable month-scoped royalty settlement, persists contributor-level allocations, and surfaces results in creator and listener reporting views.

## Deployed demo

- Functional deployed prototype (Vercel): `https://wave-streaming-platform.vercel.app/`
- API (Cloud Run): `https://wave-server-988410817606.europe-west2.run.app`

Demo admin account (deployed environment):
- Email: `assessor@test.com`
- Password: `Password123!`

## Features

- Auth with JWT and role-based access (`CREATOR`, `LISTENER`, `ADMIN`)
- UC1: Track registration with contributor splits and media upload (audio plus optional cover)
- UC2: Creator reporting (monthly royalties, per-track breakdown, payout trace, per-track earnings view)
- UC4: Listener reporting ("My Impact" month view) driven by persisted play events
- Admin operations: run monthly royalties, generate subscriptions, view recent runs
- Audit support: server-generated CSV exports and a read-only ledger events endpoint

## Tech

- Frontend: React + Vite
- Backend: Express
- Database: PostgreSQL
- Object storage: S3-compatible adapter (MinIO for local; cloud object storage supported via env)

## Local development

### Prerequisites

- Node.js (for frontend and backend)
- PostgreSQL
- S3-compatible object storage (MinIO recommended for local)

### 1) Backend env

Create `server/.env`:

```env
PORT=3000
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DBNAME
JWT_SECRET=<strong_secret_min_32_chars>

# Storage adapter
STORAGE_PROVIDER=minio
MINIO_ENDPOINT=http://127.0.0.1:9000
MINIO_REGION=us-east-1
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=wave-audio
MINIO_FORCE_PATH_STYLE=true
```

Note: this repo does not include automated DB migrations. The database schema must be provisioned before running.

### 2) Frontend env (optional)

For local dev, Vite proxies `/api` to a backend target. `VITE_API_PROXY_TARGET` defaults to `http://localhost:3000`.

Create `.env.local` if needed:

```env
VITE_API_PROXY_TARGET=http://localhost:3000
```

For production builds that call the API directly (no proxy), set:

```env
VITE_API_BASE_URL=https://your-api-host
```

### 3) Run the apps

Backend:

```powershell
cd server
npm install
npm run dev
```

Frontend:

```powershell
npm install
npm run dev
```

## Key API endpoints

Auth
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`

Tracks and media
- `POST /api/tracks` (multipart form upload)
- `GET /api/tracks`
- `GET /api/tracks/:id/cover`
- `GET /api/tracks/:id/stream`

Playback and impact
- `POST /api/play-events`
- `GET /api/listener/impact?month=YYYY-MM-01`

Royalties and exports
- `POST /api/royalties/run?month=YYYY-MM-01` (admin only)
- `GET /api/royalties/allocations?month=YYYY-MM-01`
- `GET /api/royalties/export?month=YYYY-MM-01&scope=me|all`
- `GET /api/tracks/:id/earnings?month=YYYY-MM-01`
- `GET /api/tracks/:id/export?month=YYYY-MM-01`

Admin
- `GET /api/admin/royalties/runs?limit=N`
- `POST /api/admin/subscriptions/generate`

Audit
- `GET /api/ledger/events?limit=N&cursor=...` (creator/admin)

## Known limitations

- Prototype scope: limited automated testing coverage
- Ledger inspection is API-based (no dedicated UI view)
- Some UX and edge-case handling remain future work as mentioned in the report

## Demo flow

This is the shortest end-to-end path to see the prototype working in a browser.

1) Log in
- Use the demo admin account above (or register a new account via the login UI).

2) Create some data (tracks + listening)
- Register at least 1 track as a creator (audio file plus optional cover).
- Log in as a listener and play tracks for at least 10 seconds so play events are persisted.

3) Generate subscriptions (admin) and run royalties for a month
- Pick a month start in `YYYY-MM-01` format (example: `2026-04-01`).
- Generate subscriptions for that month, then execute the royalty run.

Example (PowerShell):

```powershell
$API = "https://wave-server-988410817606.europe-west2.run.app"

$login = @{ email="assessor@test.com"; password="Password123!" } | ConvertTo-Json
$auth  = Invoke-RestMethod -Method Post -ContentType "application/json" -Body $login "$API/api/auth/login"
$TOKEN = $auth.token

$monthStart = "2026-04-01"

# Generate subscriptions (repeatable demo runs)
Invoke-RestMethod -Method Post "$API/api/admin/subscriptions/generate" `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body (@{ monthStart=$monthStart; amountPennies=999 } | ConvertTo-Json)

# Run royalties for the month
Invoke-RestMethod -Method Post "$API/api/royalties/run?month=$monthStart" `
  -Headers @{ Authorization = "Bearer $TOKEN" }
```

4) Inspect reporting
- Creator: open Royalties, select the month, view per-track breakdown and payout trace.
- Listener: open My Impact, select the month, view impact metrics and top tracks/artists.

5) Export and audit
- Export monthly royalties CSV (creator scope) and per-track CSV.
- Inspect ledger events via `GET /api/ledger/events` (creator/admin).
