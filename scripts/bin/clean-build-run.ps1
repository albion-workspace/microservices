# Clean, Install, Build, and Run All Services
# Stops all services, cleans artifacts, installs dependencies, builds, and runs everything

# Calculate project root: bin -> scripts -> project root
$rootDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "     Clean, Install, Build & Run All Services                  " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Clean artifacts (calls clean-all.ps1 which also kills processes)
Write-Host "[STEP 1] Cleaning build artifacts..." -ForegroundColor Yellow
& "$PSScriptRoot\clean-all.ps1"
Write-Host ""

# Step 2: Install dependencies
Write-Host "[STEP 2] Installing dependencies..." -ForegroundColor Yellow
$allServices = @("access-engine", "bonus-shared", "core-service", "auth-service", "payment-service", "bonus-service", "notification-service", "app")

foreach ($service in $allServices) {
    $servicePath = Join-Path $rootDir $service
    if (Test-Path $servicePath) {
        Write-Host "  Installing $service..." -ForegroundColor Cyan
        Push-Location $servicePath
        npm install --silent 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "    [OK] $service dependencies installed" -ForegroundColor Green
        } else {
            Write-Host "    [FAIL] Failed to install $service dependencies" -ForegroundColor Red
        }
        Pop-Location
    }
}

# Install scripts dependencies
Write-Host "  Installing scripts dependencies..." -ForegroundColor Cyan
$scriptsDir = Split-Path -Parent $PSScriptRoot
Push-Location $scriptsDir
npm install --silent 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "    [OK] Scripts dependencies installed" -ForegroundColor Green
} else {
    Write-Host "    [FAIL] Failed to install scripts dependencies" -ForegroundColor Red
}
Pop-Location

Write-Host "[OK] Install completed" -ForegroundColor Green
Write-Host ""

# Step 3: Build access-engine first (required by core-service)
Write-Host "[STEP 3] Building access-engine..." -ForegroundColor Yellow
$accessEnginePath = Join-Path $rootDir "access-engine"
Push-Location $accessEnginePath
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to build access-engine" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "[OK] access-engine built successfully" -ForegroundColor Green
Write-Host ""

# Step 4: Build core-service (required by all other services)
Write-Host "[STEP 4] Building core-service..." -ForegroundColor Yellow
$corePath = Join-Path $rootDir "core-service"
Push-Location $corePath
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to build core-service" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "[OK] core-service built successfully" -ForegroundColor Green
Write-Host ""

# Step 4b: Build bonus-shared (required by bonus-service)
Write-Host "[STEP 4b] Building bonus-shared..." -ForegroundColor Yellow
$bonusSharedPath = Join-Path $rootDir "bonus-shared"
Push-Location $bonusSharedPath
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to build bonus-shared" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "[OK] bonus-shared built successfully" -ForegroundColor Green
Write-Host ""

# Step 5: Set shared JWT secret
# Use consistent default secret instead of random to ensure all services can verify tokens
$sharedJwtSecret = if ($env:SHARED_JWT_SECRET) { $env:SHARED_JWT_SECRET } else { "shared-jwt-secret-change-in-production" }
Write-Host "[INFO] Using shared JWT_SECRET for all services" -ForegroundColor Cyan
Write-Host "[INFO] JWT_SECRET: $sharedJwtSecret" -ForegroundColor Gray
Write-Host ""

# Step 6: Start all services
Write-Host "[STEP 6] Starting all services..." -ForegroundColor Yellow
Write-Host ""

# Notification Service (port 3006)
Write-Host "  Starting Notification Service (port 3006)..." -ForegroundColor Cyan
$notificationScript = "cd '$rootDir\notification-service'; `$env:PORT='3006'; `$env:MONGO_URI='mongodb://localhost:27017/notification_service'; `$env:JWT_SECRET='$sharedJwtSecret'; Write-Host '=== NOTIFICATION SERVICE (Port 3006) ===' -ForegroundColor Cyan; npm run build:run"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $notificationScript
Start-Sleep -Seconds 3

# Auth Service (port 3003)
Write-Host "  Starting Auth Service (port 3003)..." -ForegroundColor Cyan
$authScript = "cd '$rootDir\auth-service'; `$env:PORT='3003'; `$env:MONGO_URI='mongodb://localhost:27017/auth_service'; `$env:NOTIFICATION_SERVICE_URL='http://localhost:3006/graphql'; `$env:JWT_SECRET='$sharedJwtSecret'; Write-Host '=== AUTH SERVICE (Port 3003) ===' -ForegroundColor Cyan; npm run build:run"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $authScript
Start-Sleep -Seconds 3

# Payment Service (port 3004)
Write-Host "  Starting Payment Service (port 3004)..." -ForegroundColor Cyan
$paymentScript = "cd '$rootDir\payment-service'; `$env:PORT='3004'; `$env:MONGO_URI='mongodb://localhost:27017/payment_service'; `$env:JWT_SECRET='$sharedJwtSecret'; Write-Host '=== PAYMENT SERVICE (Port 3004) ===' -ForegroundColor Cyan; npm run build:run"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $paymentScript
Start-Sleep -Seconds 3

# Bonus Service (port 3005)
Write-Host "  Starting Bonus Service (port 3005)..." -ForegroundColor Cyan
$bonusScript = "cd '$rootDir\bonus-service'; `$env:PORT='3005'; `$env:MONGO_URI='mongodb://localhost:27017/bonus_service'; `$env:JWT_SECRET='$sharedJwtSecret'; Write-Host '=== BONUS SERVICE (Port 3005) ===' -ForegroundColor Cyan; npm run build:run"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $bonusScript
Start-Sleep -Seconds 3

# React App (port 5173)
Write-Host "  Starting React App (port 5173)..." -ForegroundColor Cyan
$reactScript = "cd '$rootDir\app'; Write-Host '=== REACT APP (Port 5173) ===' -ForegroundColor Cyan; npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $reactScript
Start-Sleep -Seconds 3

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "           Services Started                                    " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Service URLs:" -ForegroundColor Green
Write-Host "  - Notification Service: http://localhost:3006" -ForegroundColor Green
Write-Host "  - Auth Service:         http://localhost:3003" -ForegroundColor Green
Write-Host "  - Payment Service:      http://localhost:3004" -ForegroundColor Green
Write-Host "  - Bonus Service:        http://localhost:3005" -ForegroundColor Green
Write-Host "  - React App:            http://localhost:5173" -ForegroundColor Green
Write-Host ""
Write-Host "[WAIT] Waiting 25 seconds for services to initialize..." -ForegroundColor Yellow
Start-Sleep -Seconds 25

# Health checks
Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "           Health Checks                                      " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

$services = @(
    @{ Name = "Notification Service"; Url = "http://localhost:3006/health" },
    @{ Name = "Auth Service"; Url = "http://localhost:3003/health" },
    @{ Name = "Payment Service"; Url = "http://localhost:3004/health" },
    @{ Name = "Bonus Service"; Url = "http://localhost:3005/health" }
)

foreach ($service in $services) {
    try {
        $response = Invoke-RestMethod -Uri $service.Url -Method GET -TimeoutSec 5 -ErrorAction Stop
        $status = if ($response.status -eq "healthy") { "healthy" } else { "degraded" }
        Write-Host "[OK] $($service.Name): $status" -ForegroundColor Green
    } catch {
        Write-Host "[WARN] $($service.Name): not responding yet" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "[COMPLETE] All services are running in separate PowerShell windows." -ForegroundColor Cyan
Write-Host "          Check each window for detailed logs." -ForegroundColor Gray
Write-Host ""
