# Start one or all microservices in watch mode (tsx watch).
# Usage: .\start-service-dev.ps1 <service-name>
#        .\start-service-dev.ps1 all
# Example: .\start-service-dev.ps1 auth-service
#          .\start-service-dev.ps1 all
#
# Called by clean-build-run.ps1 to start each service in a separate window.

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$ServiceName
)

$allServices = @("auth-service", "payment-service", "bonus-service", "notification-service", "kyc-service")

if ($ServiceName -eq "all") {
    Write-Host "Starting all services in WATCH MODE (each in a new window)..." -ForegroundColor Cyan
    Write-Host ""
    foreach ($svc in $allServices) {
        Write-Host "  Starting $svc..." -ForegroundColor Yellow
        Start-Process powershell -ArgumentList "-ExecutionPolicy", "Bypass", "-NoExit", "-File", $PSCommandPath, $svc
        Start-Sleep -Seconds 2
    }
    Write-Host ""
    Write-Host "All services started. Check the opened windows for logs." -ForegroundColor Green
    Write-Host "  Auth: 9001 | Payment: 9002 | Bonus: 9003 | Notification: 9004 | KYC: 9005" -ForegroundColor Gray
    exit 0
}

# bin -> scripts -> project root
$rootDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$servicePath = Join-Path $rootDir $ServiceName

if (-not (Test-Path $servicePath)) {
    Write-Host "[ERROR] Service directory not found: $servicePath" -ForegroundColor Red
    exit 1
}

$portMap = @{
    "auth-service"         = 9001
    "payment-service"     = 9002
    "bonus-service"        = 9003
    "notification-service" = 9004
    "kyc-service"         = 9005
}
$port = $portMap[$ServiceName]
$portLabel = if ($port) { " (Port $port)" } else { "" }

Write-Host "=== $ServiceName$portLabel - WATCH MODE ===" -ForegroundColor Cyan
Write-Host "Directory: $servicePath" -ForegroundColor Gray
Write-Host ""

Set-Location $servicePath
npm run dev
