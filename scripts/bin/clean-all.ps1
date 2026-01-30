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

$services = @("access-engine", "shared-validators", "core-service", "auth-service", "payment-service", "bonus-service", "notification-service", "kyc-service", "app")

foreach ($service in $services) {
    $path = Join-Path $rootDir $service
    if (Test-Path $path) {
        Write-Host "  Cleaning $service..." -ForegroundColor Cyan
        $dist = Join-Path $path "dist"
        $nodeModules = Join-Path $path "node_modules"
        $lock = Join-Path $path "package-lock.json"
        
        # Build artifacts
        if (Test-Path $dist) { Remove-Item $dist -Recurse -Force -ErrorAction SilentlyContinue }
        if (Test-Path $nodeModules) { Remove-Item $nodeModules -Recurse -Force -ErrorAction SilentlyContinue }
        if (Test-Path $lock) { Remove-Item $lock -Force -ErrorAction SilentlyContinue }
        
        # Generated infrastructure files
        $dockerfile = Join-Path $path "Dockerfile"
        $dockerCompose = Join-Path $path "docker-compose.yml"
        $nginxConf = Join-Path $path "nginx.conf"
        $k8sDir = Join-Path $path "k8s"
        $infraConfig = Join-Path $path "infra.config.json"
        
        if (Test-Path $dockerfile) { Remove-Item $dockerfile -Force -ErrorAction SilentlyContinue }
        if (Test-Path $dockerCompose) { Remove-Item $dockerCompose -Force -ErrorAction SilentlyContinue }
        if (Test-Path $nginxConf) { Remove-Item $nginxConf -Force -ErrorAction SilentlyContinue }
        if (Test-Path $k8sDir) { Remove-Item $k8sDir -Recurse -Force -ErrorAction SilentlyContinue }
        # Note: infra.config.json is kept as it's a configuration file, not generated output
    }
}

Write-Host "Clean completed!" -ForegroundColor Green
