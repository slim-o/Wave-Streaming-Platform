## Sprint 2 Completion (Implementation + Demo Runbook)

### Scope Delivered
Sprint 2 implemented:
- Authentication-ready backend with JWT login/register/me flow.
- Role-based routing and protected views (`CREATOR`, `LISTENER`).
- Royalty run computation endpoint (monthly user-centric allocation).
- Royalty allocations read endpoint and creator royalties page:
  - monthly total
  - per-track breakdown
  - payout trace (subscription → platform → tracks → creators)
- Listener-side playback session tracking and play event recording.
- Listener landing experience (home/search/library/my impact placeholders + layout).
- Shared profile modal and dynamic display name rendering in navigation/sidebar.

Key API Endpoints (Sprint 2)
POST /api/auth/register
POST /api/auth/login
GET /api/auth/me
POST /api/tracks
GET /api/tracks
POST /api/play-events
POST /api/royalties/run?month=YYYY-MM-01
GET /api/royalties/allocations?month=YYYY-MM-01
GET /api/dashboard/summary
Known Sprint 2 Limits
Playback is MVP-level and focused on event capture accuracy.
Object storage is MinIO-first for local development.
No payout execution/settlement workflow yet (allocation only).
No email verification/reset in auth flow yet.

### Environment Setup
Create/update `server/.env` with required values:

```env
PORT=3000
DATABASE_URL=<your_postgres_url>
JWT_SECRET=<strong_secret_min_32_chars>

STORAGE_PROVIDER=minio
MINIO_ENDPOINT=http://127.0.0.1:9000
MINIO_REGION=us-east-1
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=wave-audio
MINIO_FORCE_PATH_STYLE=true

Run Locally
1. Start PostgreSQL.
2. Start MinIO.
3. Start backend:
    cd server
    npm install
    npm run dev
4. Start frontend:
    npm install
    npm run dev


TO-DO:
    FULL LOGIN USER SYSTEM
    
    app.get("/api/royalties/allocations" 
        add query params so it scales into UC2:
            ?trackId=... (show one track’s breakdown)
            ?contributor=... or ?email=... (later map contributors to users)

royalties run (powershell)

Invoke-RestMethod -Method Post "http://localhost:3000/api/royalties/run?month=2026-03-01"

  
minIO storage solution

mkdir C:\minio-data -Force
$env:MINIO_ROOT_USER="minioadmin"
$env:MINIO_ROOT_PASSWORD="minioadmin"
$ennvnnnv:MINIO_REGION_NAME="us-east-1"
& "$env:USERPROFILE\go\bin\minio.exe" server C:\minio-data --address ":9000" --console-address ":9001"

& "C:\Users\ikema\go\bin\minio.exe" server C:\minio-data --address ":9000" --console-address ":9001"
