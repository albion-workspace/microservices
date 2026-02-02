# Post-refactor test plan – step-by-step commands

Run these from the **project root** (`c:\Users\albion\b2tech\tst`) unless otherwise noted. Execute in order.

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

# Optional one-shot: clean + build + start
# npm run docker:fresh
```

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

---

## Phase 7: API / REST tests (optional)

Run only after local services (and optionally gateway) are up.

```powershell
# Step 7.1 – GraphQL API tests (direct service ports)
.\scripts\bin\test-all-api.ps1

# Step 7.2 – Auth-specific tests
.\scripts\bin\auth-test.ps1

# Step 7.3 – Payment gateway tests (from scripts folder)
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
