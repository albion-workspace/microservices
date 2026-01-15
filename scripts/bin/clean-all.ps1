# Clean All Build Artifacts
# Stops all Node processes and removes build artifacts
# Calculate project root: bin -> scripts -> project root
$rootDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

Write-Host "Cleaning all build artifacts..." -ForegroundColor Yellow

# Step 1: Kill all Node processes
Write-Host "  Stopping all Node processes..." -ForegroundColor Cyan
$nodeProcesses = Get-Process node -ErrorAction SilentlyContinue
if ($nodeProcesses) {
    $nodeProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-Host "    [OK] All Node processes stopped" -ForegroundColor Green
} else {
    Write-Host "    [INFO] No Node processes running" -ForegroundColor Gray
}

$services = @("access-engine", "bonus-shared", "core-service", "auth-service", "payment-service", "bonus-service", "notification-service", "app")

foreach ($service in $services) {
    $path = Join-Path $rootDir $service
    if (Test-Path $path) {
        Write-Host "  Cleaning $service..." -ForegroundColor Cyan
        $dist = Join-Path $path "dist"
        $nodeModules = Join-Path $path "node_modules"
        $lock = Join-Path $path "package-lock.json"
        
        if (Test-Path $dist) { Remove-Item $dist -Recurse -Force -ErrorAction SilentlyContinue }
        if (Test-Path $nodeModules) { Remove-Item $nodeModules -Recurse -Force -ErrorAction SilentlyContinue }
        if (Test-Path $lock) { Remove-Item $lock -Force -ErrorAction SilentlyContinue }
    }
}

Write-Host "Clean completed!" -ForegroundColor Green
