# Comprehensive GraphQL API Test Script
# Tests all queries and mutations across all services

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "     Testing All GraphQL Queries and Mutations                 " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# No hardcoded dev token - using dynamic authentication flow
# System token will be created during test execution

function Test-GraphQL {
    param(
        [string]$ServiceName,
        [string]$Url,
        [string]$Query,
        [hashtable]$Variables = @{},
        [string]$Token = $null,
        [string]$Description = ""
    )
    
    $body = @{
        query = $Query
        variables = $Variables
    } | ConvertTo-Json -Depth 10 -Compress
    
    $headers = @{
        "Content-Type" = "application/json"
    }
    
    if ($Token) {
        $headers["Authorization"] = $Token
    }
    
    try {
        $response = Invoke-RestMethod -Uri $Url -Method POST -Body $body -Headers $headers -TimeoutSec 10 -ErrorAction Stop
        
        if ($response.errors) {
            Write-Host "  ❌ $Description" -ForegroundColor Red
            Write-Host "     Error: $($response.errors[0].message)" -ForegroundColor Yellow
            return $false
        } else {
            Write-Host "  ✅ $Description" -ForegroundColor Green
            return $true
        }
    } catch {
        Write-Host "  ❌ $Description" -ForegroundColor Red
        Write-Host "     Exception: $($_.Exception.Message)" -ForegroundColor Yellow
        return $false
    }
}

# Wait for services to be ready
Write-Host "[WAIT] Waiting for services to initialize..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

# ═══════════════════════════════════════════════════════════════
# AUTH SERVICE TESTS (Port 3003)
# ═══════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "AUTH SERVICE (Port 3003)" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$authUrl = "http://localhost:3003/graphql"
$testResults = @{}

# Test user for auth operations
$testEmail = "testuser_$(Get-Random)@test.com"
$testPassword = "Test123!@#"

# QUERIES
Write-Host "QUERIES:" -ForegroundColor Yellow
$testResults["auth_health"] = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query "query { health { status service } }" -Description "health"
$testResults["auth_authHealth"] = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query "query { authHealth }" -Description "authHealth"

# MUTATIONS - Public (no auth)
Write-Host ""
Write-Host "MUTATIONS (Public):" -ForegroundColor Yellow
$registerResult = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query "mutation Register(`$input: RegisterInput!) { register(input: `$input) { success message user { id email status } } }" -Variables @{ input = @{ tenantId = "default-tenant"; email = $testEmail; password = $testPassword; autoVerify = $true } } -Description "register"
$testResults["auth_register"] = $registerResult

if ($registerResult) {
    # Wait a moment for user to be fully created and activated
    Start-Sleep -Seconds 2
    
    # Login to get token - use the same email that was registered
    # User should be active now due to autoVerify
    $loginQuery = "mutation Login(`$input: LoginInput!) { login(input: `$input) { success message user { id email status } tokens { accessToken refreshToken } } }"
    $loginVars = @{ input = @{ tenantId = "default-tenant"; identifier = $testEmail; password = $testPassword } }
    
    try {
        $loginResponse = Invoke-RestMethod -Uri $authUrl -Method POST -Body (@{ query = $loginQuery; variables = $loginVars } | ConvertTo-Json -Depth 10 -Compress) -ContentType "application/json" -TimeoutSec 10
        
        if ($loginResponse.data.login -and $loginResponse.data.login.success) {
        $userToken = "Bearer $($loginResponse.data.login.tokens.accessToken)"
        $refreshToken = $loginResponse.data.login.tokens.refreshToken
        $userId = $loginResponse.data.login.user.id
        
        Write-Host ""
        Write-Host "MUTATIONS (Authenticated):" -ForegroundColor Yellow
        $testResults["auth_login"] = $true
        Write-Host "  ✅ login" -ForegroundColor Green
        
        $testResults["auth_refreshToken"] = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query "mutation RefreshToken(`$input: RefreshTokenInput!) { refreshToken(input: `$input) { success tokens { accessToken } } }" -Variables @{ input = @{ refreshToken = $refreshToken; tenantId = "test" } } -Description "refreshToken"
        
        $testResults["auth_me"] = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query "query { me { id email username status roles } }" -Token $userToken -Description "me"
        
        $testResults["auth_mySessions"] = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query "query { mySessions { id isValid } }" -Token $userToken -Description "mySessions"
        
        $testResults["auth_sendOTP"] = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query "mutation SendOTP(`$input: SendOTPInput!) { sendOTP(input: `$input) { success message } }" -Variables @{ input = @{ tenantId = "test"; recipient = $testEmail; channel = "email"; purpose = "verification" } } -Description "sendOTP"
        
        $testResults["auth_forgotPassword"] = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query "mutation ForgotPassword(`$input: ForgotPasswordInput!) { forgotPassword(input: `$input) { success message } }" -Variables @{ input = @{ tenantId = "test"; identifier = $testEmail } } -Description "forgotPassword"
        
        $testResults["auth_changePassword"] = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query "mutation ChangePassword(`$input: ChangePasswordInput!) { changePassword(input: `$input) { success message } }" -Variables @{ input = @{ userId = $userId; tenantId = "test"; currentPassword = $testPassword; newPassword = "NewTest123!@#" } } -Token $userToken -Description "changePassword"
        
        $testResults["auth_logout"] = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query "mutation Logout(`$refreshToken: String!) { logout(refreshToken: `$refreshToken) { success } }" -Variables @{ refreshToken = $refreshToken } -Token $userToken -Description "logout"
        
        # Setup static system user (system@demo.com) - create if doesn't exist
        Write-Host ""
        Write-Host "Setting up system user (system@demo.com)..." -ForegroundColor Yellow
        $systemEmail = "system@demo.com"
        $systemPassword = "System123!@#"
        $systemToken = $null
        
        # Step 1: Try to login first (user might already exist)
        $systemLoginQuery = "mutation Login(`$input: LoginInput!) { login(input: `$input) { success tokens { accessToken } user { id roles } } }"
        $systemLoginVars = @{ input = @{ tenantId = "default-tenant"; identifier = $systemEmail; password = $systemPassword } }
        $systemLoginBody = @{ query = $systemLoginQuery; variables = $systemLoginVars } | ConvertTo-Json -Depth 10 -Compress
        
        try {
            $systemLogin = Invoke-RestMethod -Uri $authUrl -Method POST -Body $systemLoginBody -ContentType "application/json" -TimeoutSec 10 -ErrorAction Stop
            
            if ($systemLogin.data.login.success -and ($systemLogin.data.login.user.roles -contains "system")) {
                $systemToken = "Bearer $($systemLogin.data.login.tokens.accessToken)"
                Write-Host "  ✅ System user exists and logged in successfully" -ForegroundColor Green
            } else {
                Write-Host "  ⚠️  System user exists but login failed or not system. Creating/updating system user..." -ForegroundColor Yellow
                $systemToken = $null
            }
        } catch {
            Write-Host "  ⚠️  System user not found or login failed. Creating system user..." -ForegroundColor Yellow
            $systemToken = $null
        }
        
        # Step 2: If login failed, try to register or promote existing user
        if (-not $systemToken) {
            $userExists = $false
            $registerSuccess = $false
            
            # Try to register user first
            $systemRegisterQuery = "mutation Register(`$input: RegisterInput!) { register(input: `$input) { success message user { id email } } }"
            $systemRegisterVars = @{ input = @{ tenantId = "default-tenant"; email = $systemEmail; password = $systemPassword; autoVerify = $true } }
            $systemRegisterBody = @{ query = $systemRegisterQuery; variables = $systemRegisterVars } | ConvertTo-Json -Depth 10 -Compress
            
            try {
                $systemRegister = Invoke-RestMethod -Uri $authUrl -Method POST -Body $systemRegisterBody -ContentType "application/json" -TimeoutSec 10 -ErrorAction Stop
                
                if ($systemRegister.data -and $systemRegister.data.register -and $systemRegister.data.register.success) {
                    Write-Host "  ✅ User registered: $systemEmail" -ForegroundColor Green
                    $registerSuccess = $true
                } elseif ($systemRegister.errors -and $systemRegister.errors.Count -gt 0) {
                    $errorMsg = $systemRegister.errors[0].message
                    if ($errorMsg -match "already exists" -or $errorMsg -match "duplicate") {
                        Write-Host "  [INFO] User already exists, will promote to system..." -ForegroundColor Cyan
                        $userExists = $true
                    } else {
                        Write-Host "  [INFO] Registration failed: $errorMsg. Will try to promote existing user..." -ForegroundColor Yellow
                        $userExists = $true
                    }
                } else {
                    Write-Host "  [INFO] Registration response unclear. Will try to promote existing user..." -ForegroundColor Yellow
                    $userExists = $true
                }
            } catch {
                Write-Host "  [INFO] Registration failed: $($_.Exception.Message). Will try to promote existing user..." -ForegroundColor Yellow
                $userExists = $true
            }
            
            # Step 3: Promote to system via MongoDB (works for both new and existing users)
            if ($registerSuccess -or $userExists) {
                Write-Host "  Promoting user to system via MongoDB..." -ForegroundColor Yellow
                Start-Sleep -Seconds 1
                $scriptsDir = Split-Path -Parent $PSScriptRoot
                Push-Location $scriptsDir
                $promoteResult = npx tsx typescript/auth/manage-user.ts $systemEmail --all 2>&1 | Out-String
                Pop-Location
                
                if ($promoteResult -match "updated successfully" -or $promoteResult -match "SUCCESS" -or $promoteResult -match "User updated successfully") {
                    Write-Host "  ✅ User promoted to system" -ForegroundColor Green
                    Start-Sleep -Seconds 1
                    
                    # Step 4: Login as system
                    try {
                        $systemLogin = Invoke-RestMethod -Uri $authUrl -Method POST -Body $systemLoginBody -ContentType "application/json" -TimeoutSec 10 -ErrorAction Stop
                        
                        if ($systemLogin.data -and $systemLogin.data.login -and $systemLogin.data.login.success -and ($systemLogin.data.login.user.roles -contains "system")) {
                            $systemToken = "Bearer $($systemLogin.data.login.tokens.accessToken)"
                            Write-Host "  ✅ System user created and logged in successfully" -ForegroundColor Green
                        } else {
                            $loginMsg = if ($systemLogin.data -and $systemLogin.data.login) { $systemLogin.data.login.message } else { "Unknown error" }
                            Write-Host "  ⚠️  Login failed after promotion: $loginMsg" -ForegroundColor Yellow
                            $systemToken = $null
                        }
                    } catch {
                        Write-Host "  ⚠️  Login failed after promotion: $($_.Exception.Message)" -ForegroundColor Yellow
                        $systemToken = $null
                    }
                } else {
                    Write-Host "  ⚠️  Failed to promote user to system. Output: $promoteResult" -ForegroundColor Yellow
                    $systemToken = $null
                }
            } else {
                Write-Host "  ⚠️  Could not register or find user to promote" -ForegroundColor Yellow
                $systemToken = $null
            }
        }
        
        # Step 5: Use system token for system queries
        if ($systemToken) {
            Write-Host ""
            Write-Host "QUERIES (System):" -ForegroundColor Yellow
            $testResults["auth_users"] = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query "query { users(first: 10) { nodes { id email } totalCount } }" -Token $systemToken -Description "users"
            $testResults["auth_getUser"] = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query "query GetUser(`$id: ID!, `$tenantId: String!) { getUser(id: `$id, tenantId: `$tenantId) { id email } }" -Variables @{ id = $userId; tenantId = "test" } -Token $systemToken -Description "getUser"
            
            # Store system token for other services
            $global:systemToken = $systemToken
        } else {
            Write-Host "  ⚠️  Could not setup system user. System operations will be skipped." -ForegroundColor Yellow
            $testResults["auth_users"] = $false
            $testResults["auth_getUser"] = $false
        }
        
        # Store user token for other services
        $global:userToken = $userToken
        $global:testUserId = $userId
        } else {
            Write-Host "  ❌ login failed: $($loginResponse.data.login.message)" -ForegroundColor Red
            $testResults["auth_login"] = $false
        }
    } catch {
        Write-Host "  ❌ login exception: $($_.Exception.Message)" -ForegroundColor Red
        $testResults["auth_login"] = $false
    }
} else {
    Write-Host "  ⚠️  Skipping authenticated tests (register failed)" -ForegroundColor Yellow
}

# ═══════════════════════════════════════════════════════════════
# PAYMENT SERVICE TESTS (Port 3004)
# ═══════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "PAYMENT SERVICE (Port 3004)" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$paymentUrl = "http://localhost:3004/graphql"

Write-Host "QUERIES:" -ForegroundColor Yellow
$testResults["payment_health"] = Test-GraphQL -ServiceName "Payment" -Url $paymentUrl -Query "query { health { status service } }" -Description "health"

Write-Host ""
Write-Host "MUTATIONS:" -ForegroundColor Yellow
if ($global:systemToken) {
    $testResults["payment_createProviderConfig"] = Test-GraphQL -ServiceName "Payment" -Url $paymentUrl -Query "mutation CreateProviderConfig(`$input: CreateProviderConfigInput!) { createProviderConfig(input: `$input) { success providerConfig { id provider name } } }" -Variables @{ input = @{ provider = "stripe"; name = "Stripe Test"; tenantId = "test"; supportedMethods = @("card"); supportedCurrencies = @("USD"); feePercentage = 2.5 } } -Token $global:systemToken -Description "createProviderConfig (system)"
} else {
    Write-Host "  ⚠️  Skipping system operations (createProviderConfig) - no system token" -ForegroundColor Yellow
    $testResults["payment_createProviderConfig"] = $false
}

if ($global:userToken) {
    $testResults["payment_createWallet"] = Test-GraphQL -ServiceName "Payment" -Url $paymentUrl -Query "mutation CreateWallet(`$input: CreateWalletInput!) { createWallet(input: `$input) { success wallet { id userId currency balance } } }" -Variables @{ input = @{ userId = $global:testUserId; currency = "USD"; tenantId = "test" } } -Token $global:userToken -Description "createWallet (authenticated)"
    
    $testResults["payment_createDeposit"] = Test-GraphQL -ServiceName "Payment" -Url $paymentUrl -Query "mutation CreateDeposit(`$input: CreateDepositInput!) { createDeposit(input: `$input) { success deposit { id amount currency status } } }" -Variables @{ input = @{ userId = $global:testUserId; amount = 100.0; currency = "USD"; tenantId = "test"; method = "card" } } -Token $global:userToken -Description "createDeposit (authenticated)"
    
    $testResults["payment_createWithdrawal"] = Test-GraphQL -ServiceName "Payment" -Url $paymentUrl -Query "mutation CreateWithdrawal(`$input: CreateWithdrawalInput!) { createWithdrawal(input: `$input) { success withdrawal { id amount currency status } } }" -Variables @{ input = @{ userId = $global:testUserId; amount = 50.0; currency = "USD"; tenantId = "test"; method = "bank" } } -Token $global:userToken -Description "createWithdrawal (authenticated)"
    
    Write-Host ""
    Write-Host "QUERIES (After Mutations):" -ForegroundColor Yellow
    if ($global:systemToken) {
        $testResults["payment_providerConfigs"] = Test-GraphQL -ServiceName "Payment" -Url $paymentUrl -Query "query { providerConfigs(first: 10) { nodes { id provider name } totalCount } }" -Token $global:systemToken -Description "providerConfigs (system)"
    } else {
        $testResults["payment_providerConfigs"] = $false
    }
    $testResults["payment_wallets"] = Test-GraphQL -ServiceName "Payment" -Url $paymentUrl -Query "query { wallets(first: 10) { nodes { id userId currency balance } totalCount } }" -Token $global:userToken -Description "wallets (authenticated)"
    $testResults["payment_deposits"] = Test-GraphQL -ServiceName "Payment" -Url $paymentUrl -Query "query { deposits(first: 10) { nodes { id amount currency status } totalCount } }" -Token $global:userToken -Description "deposits (authenticated)"
    $testResults["payment_withdrawals"] = Test-GraphQL -ServiceName "Payment" -Url $paymentUrl -Query "query { withdrawals(first: 10) { nodes { id amount currency status } totalCount } }" -Token $global:userToken -Description "withdrawals (authenticated)"
} else {
    Write-Host "  ⚠️  Skipping authenticated payment tests (no user token)" -ForegroundColor Yellow
}

# ═══════════════════════════════════════════════════════════════
# BONUS SERVICE TESTS (Port 3005)
# ═══════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "BONUS SERVICE (Port 3005)" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$bonusUrl = "http://localhost:3005/graphql"

Write-Host "QUERIES:" -ForegroundColor Yellow
$testResults["bonus_health"] = Test-GraphQL -ServiceName "Bonus" -Url $bonusUrl -Query "query { health { status service } }" -Description "health"

if ($global:userToken) {
    $testResults["bonus_availableBonuses"] = Test-GraphQL -ServiceName "Bonus" -Url $bonusUrl -Query "query { availableBonuses(currency: `"USD`") { id name code type value currency } }" -Token $global:userToken -Description "availableBonuses (authenticated)"
    
    Write-Host ""
    Write-Host "MUTATIONS:" -ForegroundColor Yellow
    $now = Get-Date
    $validFrom = $now.AddDays(-1).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    $validUntil = $now.AddDays(30).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    
    if ($global:systemToken) {
        $testResults["bonus_createBonusTemplate"] = Test-GraphQL -ServiceName "Bonus" -Url $bonusUrl -Query "mutation CreateBonusTemplate(`$input: CreateBonusTemplateInput!) { createBonusTemplate(input: `$input) { success bonusTemplate { id name code type value } } }" -Variables @{ input = @{ name = "Welcome Bonus"; code = "WELCOME100"; type = "welcome"; domain = "casino"; valueType = "fixed"; value = 100.0; currency = "USD"; turnoverMultiplier = 1.0; validFrom = $validFrom; validUntil = $validUntil; priority = 1 } } -Token $global:systemToken -Description "createBonusTemplate (system)"
    } else {
        Write-Host "  ⚠️  Skipping system operations (createBonusTemplate) - no system token" -ForegroundColor Yellow
        $testResults["bonus_createBonusTemplate"] = $false
    }
    
    $testResults["bonus_createUserBonus"] = Test-GraphQL -ServiceName "Bonus" -Url $bonusUrl -Query "mutation CreateUserBonus(`$input: CreateUserBonusInput!) { createUserBonus(input: `$input) { success userBonus { id userId templateCode status } } }" -Variables @{ input = @{ userId = $global:testUserId; templateCode = "WELCOME100"; currency = "USD"; tenantId = "test" } } -Token $global:userToken -Description "createUserBonus (authenticated)"
    
    Write-Host ""
    Write-Host "QUERIES (After Mutations):" -ForegroundColor Yellow
    if ($global:systemToken) {
        $testResults["bonus_bonusTemplates"] = Test-GraphQL -ServiceName "Bonus" -Url $bonusUrl -Query "query { bonusTemplates(first: 10) { nodes { id name code type } totalCount } }" -Token $global:systemToken -Description "bonusTemplates (system)"
    } else {
        $testResults["bonus_bonusTemplates"] = $false
    }
    $testResults["bonus_userBonuss"] = Test-GraphQL -ServiceName "Bonus" -Url $bonusUrl -Query "query { userBonuss(first: 10) { nodes { id userId templateCode status } totalCount } }" -Token $global:userToken -Description "userBonuss (authenticated)"
} else {
    Write-Host "  ⚠️  Skipping authenticated bonus tests (no user token)" -ForegroundColor Yellow
}

# ═══════════════════════════════════════════════════════════════
# NOTIFICATION SERVICE TESTS (Port 3006)
# ═══════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "NOTIFICATION SERVICE (Port 3006)" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$notificationUrl = "http://localhost:3006/graphql"

Write-Host "QUERIES:" -ForegroundColor Yellow
$testResults["notification_health"] = Test-GraphQL -ServiceName "Notification" -Url $notificationUrl -Query "query { health { status service } }" -Description "health"
$testResults["notification_notificationHealth"] = Test-GraphQL -ServiceName "Notification" -Url $notificationUrl -Query "query { notificationHealth }" -Description "notificationHealth"
$testResults["notification_availableChannels"] = Test-GraphQL -ServiceName "Notification" -Url $notificationUrl -Query "query { availableChannels }" -Description "availableChannels"

Write-Host ""
Write-Host "MUTATIONS:" -ForegroundColor Yellow
$testResults["notification_sendNotification"] = Test-GraphQL -ServiceName "Notification" -Url $notificationUrl -Query "mutation SendNotification(`$input: SendNotificationInput!) { sendNotification(input: `$input) { success message notificationId status } }" -Variables @{ input = @{ tenantId = "test"; channel = "EMAIL"; to = $testEmail; subject = "Test Notification"; body = "This is a test notification"; priority = "NORMAL" } } -Description "sendNotification"

# ═══════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "TEST SUMMARY" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$total = $testResults.Count
$passed = ($testResults.Values | Where-Object { $_ -eq $true }).Count
$failed = $total - $passed

Write-Host "Total Tests: $total" -ForegroundColor White
Write-Host "Passed: $passed" -ForegroundColor Green
Write-Host "Failed: $failed" -ForegroundColor $(if ($failed -gt 0) { "Red" } else { "Green" })
Write-Host ""

if ($failed -gt 0) {
    Write-Host "Failed Tests:" -ForegroundColor Red
    foreach ($test in $testResults.GetEnumerator() | Where-Object { $_.Value -eq $false }) {
        Write-Host "  - $($test.Key)" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Test completed!" -ForegroundColor Cyan
