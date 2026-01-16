# Generic Service Dev Script - Start any service in Watch Mode
# Auto-restarts on code changes
#
# Usage:
#   .\scripts\start-service-dev.ps1 payment-service
#   .\scripts\start-service-dev.ps1 auth-service
#   .\scripts\start-service-dev.ps1 bonus-service
#   .\scripts\start-service-dev.ps1 notification-service

param(
    [Parameter(Mandatory=$true)]
    [string]$ServiceName
)

# Calculate paths
$rootDir = Split-Path -Parent $PSScriptRoot
$sharedJwtSecret = if ($env:SHARED_JWT_SECRET) { $env:SHARED_JWT_SECRET } else { "shared-jwt-secret-change-in-production" }

# Service configuration
$serviceConfig = @{
    "payment-service" = @{
        Port = 3004
        MongoDb = "payment_service"
        DisplayName = "PAYMENT SERVICE"
    }
    "auth-service" = @{
        Port = 3003
        MongoDb = "auth_service"
        DisplayName = "AUTH SERVICE"
    }
    "bonus-service" = @{
        Port = 3005
        MongoDb = "bonus_service"
        DisplayName = "BONUS SERVICE"
    }
    "notification-service" = @{
        Port = 3006
        MongoDb = "notification_service"
        DisplayName = "NOTIFICATION SERVICE"
    }
}

# Validate service name
if (-not $serviceConfig.ContainsKey($ServiceName)) {
    Write-Host "[ERROR] Unknown service: $ServiceName" -ForegroundColor Red
    Write-Host "Available services: $($serviceConfig.Keys -join ', ')" -ForegroundColor Yellow
    exit 1
}

$config = $serviceConfig[$ServiceName]
$serviceDir = "$rootDir\$ServiceName"

# Display configuration before starting
Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "           SERVICE CONFIGURATION" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "Service Name    : $ServiceName" -ForegroundColor White
Write-Host "Display Name    : $($config.DisplayName)" -ForegroundColor White
Write-Host "Port            : $($config.Port)" -ForegroundColor White
Write-Host "Database        : $($config.MongoDb)" -ForegroundColor White
Write-Host "Root Directory  : $rootDir" -ForegroundColor White
Write-Host "Service Path    : $serviceDir" -ForegroundColor White
Write-Host ""

# Verify service directory exists
if (-not (Test-Path $serviceDir)) {
    Write-Host "[ERROR] Service directory not found!" -ForegroundColor Red
    Write-Host "Expected path: $serviceDir" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Available directories in root:" -ForegroundColor Yellow
    Get-ChildItem -Path $rootDir -Directory | Select-Object -First 10 | ForEach-Object { Write-Host "  - $($_.Name)" -ForegroundColor Gray }
    exit 1
}

Write-Host "[OK] Service directory found: $serviceDir" -ForegroundColor Green
Write-Host ""

# Stop existing instance on this port - use netstat for more reliable detection
Write-Host "Checking for existing processes on port $($config.Port)..." -ForegroundColor Gray
$killedAny = $false

# Method 1: Use netstat to find processes (more reliable than Get-NetTCPConnection)
try {
    $netstatOutput = netstat -ano | Select-String ":$($config.Port)\s"
    if ($netstatOutput) {
        foreach ($line in $netstatOutput) {
            if ($line -match '\s+(\d+)$') {
                $pid = [int]$matches[1]
                try {
                    $proc = Get-Process -Id $pid -ErrorAction Stop
                    Write-Host "  [KILL] Stopping process $pid ($($proc.ProcessName)) on port $($config.Port)..." -ForegroundColor Yellow
                    Stop-Process -Id $pid -Force -ErrorAction Stop
                    $killedAny = $true
                } catch {
                    Write-Host "  [SKIP] Process $pid already stopped" -ForegroundColor Gray
                }
            }
        }
    }
} catch {
    # Fallback to Get-NetTCPConnection
    try {
        $connections = Get-NetTCPConnection -LocalPort $config.Port -ErrorAction SilentlyContinue | Select-Object -First 10
        if ($connections) {
            $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
            foreach ($pid in $pids) {
                try {
                    $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
                    if ($proc) {
                        Write-Host "  [KILL] Stopping process $pid ($($proc.ProcessName)) on port $($config.Port)..." -ForegroundColor Yellow
                        Stop-Process -Id $pid -Force -ErrorAction Stop
                        $killedAny = $true
                    }
                } catch {
                    Write-Host "  [SKIP] Process $pid already stopped" -ForegroundColor Gray
                }
            }
        }
    } catch {
        # Ignore errors
    }
}

# Method 2: Kill any node processes that might be related (aggressive cleanup)
try {
    $nodeProcs = Get-Process -Name "node" -ErrorAction SilentlyContinue
    foreach ($proc in $nodeProcs) {
        try {
            # Check if process is using our port
            $procConnections = netstat -ano | Select-String ":$($config.Port)\s" | Select-String "\s+$($proc.Id)$"
            if ($procConnections) {
                Write-Host "  [KILL] Stopping Node.js process $($proc.Id) (using port $($config.Port))..." -ForegroundColor Yellow
                Stop-Process -Id $proc.Id -Force -ErrorAction Stop
                $killedAny = $true
            }
        } catch {
            # Process might have already exited
        }
    }
} catch {
    # Ignore errors
}

if ($killedAny) {
    Write-Host "  [OK] Waiting 4 seconds for processes to fully stop..." -ForegroundColor Green
    Start-Sleep -Seconds 4
    
    # Verify port is free using netstat
    try {
        $stillRunning = netstat -ano | Select-String ":$($config.Port)\s"
        if ($stillRunning) {
            Write-Host "  [WARNING] Port $($config.Port) may still be in use. Retrying kill..." -ForegroundColor Yellow
            # Try one more time
            $stillRunning | ForEach-Object {
                if ($_ -match '\s+(\d+)$') {
                    $pid = [int]$matches[1]
                    try {
                        Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                    } catch {}
                }
            }
            Start-Sleep -Seconds 2
        } else {
            Write-Host "  [OK] Port $($config.Port) is now free" -ForegroundColor Green
        }
    } catch {
        Write-Host "  [OK] Port $($config.Port) appears to be free" -ForegroundColor Green
    }
} else {
    Write-Host "  [OK] No existing processes on port $($config.Port)" -ForegroundColor Green
}

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "           STARTING $($config.DisplayName.PadRight(47))" -ForegroundColor Cyan
Write-Host "                    WATCH MODE" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# Set environment variables
$env:PORT = $config.Port
$env:MONGO_URI = "mongodb://localhost:27017/$($config.MongoDb)"
$env:JWT_SECRET = $sharedJwtSecret

# Change to service directory and run
Set-Location $serviceDir

Write-Host "[INFO] Starting $($config.DisplayName) on port $($config.Port)" -ForegroundColor Cyan
Write-Host "[INFO] Database: $($config.MongoDb)" -ForegroundColor Gray
Write-Host "[INFO] Auto-restarts on code changes" -ForegroundColor Gray
Write-Host ""
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

# Run npm run dev (this will block and show output)
npm run dev
