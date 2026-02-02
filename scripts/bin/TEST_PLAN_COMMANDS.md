# Post-refactor test plan – step-by-step commands

Run these from the **project root** (`c:\Users\albion\b2tech\tst`) unless otherwise noted. Execute in order.

---

## Current status (as of last update)

*Update this table and the "Fixes applied" line when you re-run the plan or fix issues.*

| Area | Status | Notes |
|------|--------|--------|
| **Build (Phase 1)** | ✅ Verified | access-engine → core-service → shared-validators |
| **Local dev (Phase 2)** | ✅ Verified | Gateway `npm run dev` or `.\scripts\bin\clean-build-run.ps1` |
| **Health check (Phase 3)** | ✅ Verified | All five services 9001–9005 (+ KYC 9005) |
| **Auth tests** | ✅ Run | `scripts`: `npm run auth:test` |
| **Payment tests** | ✅ Passing | `scripts`: `npm run payment:test` (transactions, gateway, flow, etc.) |
| **Channels tests** | ✅ 22/22 passing | `scripts`: `npm run channels-test` (SSE, Socket.IO, Webhooks) |
| **Bonus tests** | ⚠️ 62/63 | One failing: "Test high-value bonus claim (requires approval)" – No pending token found |
| **Docker infra** | ✅ Verified | Use `gateway`: `npm run docker:recovery:infra` if Mongo volume was from different profile |
| **Docker fresh deploy** | ❌ Failed | auth-service Docker build fails: AuthConfig / DefaultServiceConfig type mismatch (core-service export or auth-service types). Fix auth-service config types or core-service build so Docker image builds. |
| **K8s fresh deploy** | ✅ Success | `gateway`: `npm run k8s:fresh` (generate → load images → apply → wait pods → cleanup). Health: `npm run health:k8s` — 5/5 services + Mongo + Redis OK. auth-service image was not present locally; other images loaded; cluster had existing auth image or pulled it. |
| **Gateway via 9999** | ⚠️ Port note | Gateway uses 9999 for routing; channels-test uses 9999 (or 9998–9996 fallback) for webhook receiver – run channels-test when no gateway on 9999, or script binds to next free port |

**Fixes applied during test pass:** MongoDB default URI for local dev; Mongo client reuse (single client per server) for payment transactions; Redis URL default for scripts; payment-service `require()`→ESM fix; gateway healthcheck initiates replica set and waits for PRIMARY; `docker:recovery:infra` for fresh Mongo/Redis volumes; channels-test webhook receiver tries ports 9999, 9998, 9997, 9996 on EADDRINUSE.

---

## Phase 1: Build dependencies

```powershell
# Step 1.1 – Build access-engine (required by core-service)
cd access-engine
npm run build
cd ..

# Step 1.2 – Build core-service (required by all microservices)
cd core-service
npm run build
cd ..

# Step 1.3 – Build shared-validators (required by bonus-service, kyc-service)
cd shared-validators
npm run build
cd ..
```

---

## Phase 2: Start services locally (watch mode)

**Option A – Single terminal (gateway dev)**

```powershell
# Step 2.1 – Start all five services in watch mode in one terminal
cd gateway
npm run dev
# Leave this running. Ctrl+C stops all.
```

**Option B – Full clean + build + start (PowerShell script, separate windows)**

```powershell
# Step 2.2 – Clean, install, build, then start each service in its own window
.\scripts\bin\clean-build-run.ps1
# Opens separate windows for auth, payment, bonus, notification, kyc, and app.
```

---

## Phase 3: Health check (local)

```powershell
# Step 3.1 – Check all five services (9001–9005) are healthy
cd gateway
npm run health
cd ..
```

---

## Phase 4: Verify through gateway (optional)

- Ensure services are still running from Phase 2.
- If you run nginx (or another gateway) in front of local services, use port **9999** and header **X-Target-Service: auth|payment|bonus|notification|kyc**.
- Example (PowerShell, adjust URL if needed):

```powershell
# Step 4.1 – Example: health via gateway (if gateway is running on 9999)
Invoke-RestMethod -Uri "http://localhost:9999/health" -Headers @{ "X-Target-Service" = "auth" } -Method GET
```

---

## Phase 5: Docker (local)

```powershell
# Step 5.1 – Go to gateway
cd gateway

# Step 5.2 – Generate Docker config (if not already generated)
npm run generate
# or: npm run generate:all

# Step 5.3 – Build all service images
npm run docker:build

# Step 5.4 – Start containers
npm run docker:up

# Step 5.5 – Health check (Docker)
npm run health:docker
```

**If Mongo fails (e.g. "replica set config invalid" or volume from different profile):** run `npm run docker:recovery:infra` (down -v, then up infra) to get fresh Mongo + Redis volumes, then start services again.

**Optional:** `npm run docker:fresh` for a one-shot clean + build + start. *Note: As of last run, `docker:fresh` fails at auth-service build (AuthConfig/DefaultServiceConfig type mismatch); see Current status.*

---

## Phase 6: Kubernetes (local K8s)

```powershell
# Step 6.1 – Stay in gateway
cd gateway

# Step 6.2 – Generate K8s manifests for local cluster
npm run generate:local-k8s
# or: npm run generate:all

# Step 6.3 – Load images (if using a local cluster that needs local images)
npm run k8s:load-images

# Step 6.4 – Apply manifests
npm run k8s:apply:local
# or: npm run k8s:apply

# Step 6.5 – Check status
npm run k8s:status:local
# or: npm run k8s:status

# Step 6.6 – Health check (K8s)
npm run health:k8s
```

**Fresh deploy:** `npm run k8s:fresh` (generate → load images → apply → wait for pods → cleanup). For local cluster: ensure images are built first (`npm run docker:build` when Docker build is fixed) or use existing images; then `npm run health:k8s` to verify. *Last run: K8s fresh + health:k8s succeeded (5/5 services + infra).*

---

## Phase 7: Script-based test suites (auth, payment, bonus, channels)

Run from the **scripts** folder after local services (Phase 2) are up. See **Current status** above for latest pass/fail summary.

```powershell
cd scripts

# Step 7.1 – Auth tests (registration, login, OTP, token, 2FA, etc.)
npm run auth:test
# or: npm run auth:test:all

# Step 7.2 – Payment tests (gateway, funding, flow, ledger, recovery, etc.)
npm run payment:test
# or: npm run payment:test:all

# Step 7.3 – Bonus tests (onboarding, recurring, referral, eligibility, etc.)
npm run bonus:test
# or: npm run bonus:test:all

# Step 7.4 – Channels tests (SSE, Socket.IO, Webhooks)
npm run channels-test
```

Sub-suites (examples): `npm run payment:test:gateway`, `npm run bonus:test:onboarding`, `npm run auth:test:login`.

---

## Phase 8: API / REST tests (optional)

Run only after local services (and optionally gateway) are up.

```powershell
# Step 8.1 – GraphQL API tests (direct service ports)
.\scripts\bin\test-all-api.ps1

# Step 8.2 – Auth-specific tests
.\scripts\bin\auth-test.ps1

# Step 8.3 – Payment gateway tests (from scripts folder)
cd scripts
npm run payment:test:gateway
cd ..
```

---

## Quick reference – service ports

| Service        | Port | Health URL                  |
|----------------|------|-----------------------------|
| auth-service   | 9001 | http://localhost:9001/health |
| payment-service| 9002 | http://localhost:9002/health |
| bonus-service  | 9003 | http://localhost:9003/health |
| notification-service | 9004 | http://localhost:9004/health |
| kyc-service    | 9005 | http://localhost:9005/health |
| Gateway        | 9999 | (with X-Target-Service header) |
