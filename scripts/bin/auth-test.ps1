# Comprehensive Auth Service Test Script
# Tests all authentication and authorization functionality via GraphQL API

# Calculate project root: bin -> scripts -> project root
$rootDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

$authUrl = "http://localhost:3003/graphql"
$tenantId = "default-tenant"

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "     Auth Service Comprehensive Tests                          " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# Wait for service to be ready
Write-Host "[WAIT] Waiting for auth service to initialize..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Test helper function
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
            Write-Host "  [FAIL] $Description" -ForegroundColor Red
            Write-Host "     Error: $($response.errors[0].message)" -ForegroundColor Yellow
            return @{ Success = $false; Data = $null; Error = $response.errors[0].message }
        } else {
            # Check if response data contains a success field (for mutations like register, login, etc.)
            $hasSuccessField = $false
            $isSuccess = $true
            if ($response.data) {
                # Check common mutation response patterns: register.success, login.success, etc.
                $mutationKeys = @('register', 'login', 'changePassword', 'resetPassword', 'forgotPassword', 'verifyOTP', 'verify2FA', 'enable2FA', 'disable2FA')
                foreach ($key in $mutationKeys) {
                    if ($response.data.$key -and [bool]($response.data.$key.PSObject.Properties.Name -contains 'success')) {
                        $hasSuccessField = $true
                        $isSuccess = $response.data.$key.success
                        break
                    }
                }
            }
            
            if ($hasSuccessField -and -not $isSuccess) {
                Write-Host "  [FAIL] $Description" -ForegroundColor Red
                $errorMsg = $response.data.$key.message
                if ($errorMsg) {
                    Write-Host "     Error: $errorMsg" -ForegroundColor Yellow
                }
                return @{ Success = $false; Data = $response.data; Error = $errorMsg }
            } else {
                Write-Host "  [OK] $Description" -ForegroundColor Green
                return @{ Success = $true; Data = $response.data; Error = $null }
            }
        }
    } catch {
        Write-Host "  [FAIL] $Description" -ForegroundColor Red
        Write-Host "     Exception: $($_.Exception.Message)" -ForegroundColor Yellow
        return @{ Success = $false; Data = $null; Error = $_.Exception.Message }
    }
}

$testResults = @{}
$testUser = @{
    Email = "authtest-$(Get-Random)@test.com"
    Username = "authtest$(Get-Random)"
    Password = "TestPass123!@#"
    Phone = "+1234567890"
}
$userToken = $null
$refreshToken = $null
$userId = $null

# ═══════════════════════════════════════════════════════════════
# SECTION 1: HEALTH CHECKS
# ═══════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "SECTION 1: Health Checks" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$testResults["health"] = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query "query { health { status service } }" -Description "health"
$testResults["authHealth"] = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query "query { authHealth }" -Description "authHealth"

# ═══════════════════════════════════════════════════════════════
# SECTION 2: REGISTRATION TESTS
# ═══════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "SECTION 2: Registration Tests" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Test 1: Register with email only
Write-Host "Test 1: Register with email only" -ForegroundColor Yellow
$registerQuery = "mutation Register(`$input: RegisterInput!) { register(input: `$input) { success message user { id email username phone roles status emailVerified phoneVerified } tokens { accessToken refreshToken } } }"
$registerVars = @{ input = @{ tenantId = $tenantId; email = $testUser.Email; password = $testUser.Password; autoVerify = $true } }
$result = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $registerQuery -Variables $registerVars -Description "register with email"
$testResults["register_email"] = $result.Success

if ($result.Success -and $result.Data.register.success) {
    $userId = $result.Data.register.user.id
    $userToken = "Bearer $($result.Data.register.tokens.accessToken)"
    $refreshToken = $result.Data.register.tokens.refreshToken
    Write-Host "    User ID: $userId" -ForegroundColor Gray
    Write-Host "    Email: $($result.Data.register.user.email)" -ForegroundColor Gray
    Write-Host "    Status: $($result.Data.register.user.status)" -ForegroundColor Gray
}

# Test 2: Register with username
Write-Host ""
Write-Host "Test 2: Register with username" -ForegroundColor Yellow
$testUser2 = @{
    Username = "testuser$(Get-Random)"
    Password = "TestPass123!@#"
}
$registerVars2 = @{ input = @{ tenantId = $tenantId; username = $testUser2.Username; password = $testUser2.Password; autoVerify = $true } }
$result2 = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $registerQuery -Variables $registerVars2 -Description "register with username"
$testResults["register_username"] = $result2.Success

# Test 3: Register with all identifiers
Write-Host ""
Write-Host "Test 3: Register with all identifiers" -ForegroundColor Yellow
$randomSuffix = Get-Random
# Ensure phone number is valid format: +1 followed by 10 digits
$phoneSuffix = ($randomSuffix % 10000000000).ToString("0000000000")
$testUser3 = @{
    Email = "fulluser-$randomSuffix@test.com"
    Username = "fulluser$randomSuffix"
    Phone = "+1$phoneSuffix"
    Password = "TestPass123!@#"
}
$registerVars3 = @{ input = @{ tenantId = $tenantId; email = $testUser3.Email; username = $testUser3.Username; phone = $testUser3.Phone; password = $testUser3.Password; autoVerify = $true } }
$result3 = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $registerQuery -Variables $registerVars3 -Description "register with all identifiers"
$testResults["register_all"] = $result3.Success

# Test 4: Register duplicate email (should fail)
Write-Host ""
Write-Host "Test 4: Register duplicate email (should fail)" -ForegroundColor Yellow
Write-Host "  [INFO] Attempting to register duplicate email: $($testUser.Email)" -ForegroundColor Gray
$result4 = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $registerQuery -Variables $registerVars -Description "register duplicate email"
# Check if the registration actually failed (success: false in response data)
$registrationFailed = $false
if ($result4.Data -and $result4.Data.register -and $result4.Data.register.success -eq $false) {
    $registrationFailed = $true
    Write-Host "  [OK] Duplicate registration correctly rejected: $($result4.Data.register.message)" -ForegroundColor Green
} elseif (-not $result4.Success) {
    $registrationFailed = $true
    Write-Host "  [OK] Duplicate registration correctly rejected" -ForegroundColor Green
} else {
    Write-Host "  [WARN] Duplicate registration unexpectedly succeeded" -ForegroundColor Yellow
}
# Test passes if registration fails (duplicate detected)
$testResults["register_duplicate"] = $registrationFailed

# Test 5: Register with weak password (should fail)
Write-Host ""
Write-Host "Test 5: Register with weak password (should fail)" -ForegroundColor Yellow
$weakPasswordVars = @{ input = @{ tenantId = $tenantId; email = "weak-$(Get-Random)@test.com"; password = "weak" } }
$result5 = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $registerQuery -Variables $weakPasswordVars -Description "register with weak password"
$testResults["register_weak_password"] = -not $result5.Success  # Should fail

# ═══════════════════════════════════════════════════════════════
# SECTION 3: LOGIN TESTS
# ═══════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "SECTION 3: Login Tests" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Test 1: Login with email
Write-Host "Test 1: Login with email" -ForegroundColor Yellow
$loginQuery = "mutation Login(`$input: LoginInput!) { login(input: `$input) { success message user { id email username roles status twoFactorEnabled } tokens { accessToken refreshToken } requiresOTP } }"
$loginVars = @{ input = @{ tenantId = $tenantId; identifier = $testUser.Email; password = $testUser.Password } }
$loginResult = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $loginQuery -Variables $loginVars -Description "login with email"
$testResults["login_email"] = $loginResult.Success

if ($loginResult.Success -and $loginResult.Data.login.success) {
    $userToken = "Bearer $($loginResult.Data.login.tokens.accessToken)"
    $refreshToken = $loginResult.Data.login.tokens.refreshToken
    Write-Host "    Access Token: $($userToken.Substring(0, 30))..." -ForegroundColor Gray
}

# Test 2: Login with username
Write-Host ""
Write-Host "Test 2: Login with username" -ForegroundColor Yellow
$loginVars2 = @{ input = @{ tenantId = $tenantId; identifier = $testUser2.Username; password = $testUser2.Password } }
$loginResult2 = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $loginQuery -Variables $loginVars2 -Description "login with username"
$testResults["login_username"] = $loginResult2.Success

# Test 3: Login with wrong password (should fail)
Write-Host ""
Write-Host "Test 3: Login with wrong password (should fail)" -ForegroundColor Yellow
$wrongPasswordVars = @{ input = @{ tenantId = $tenantId; identifier = $testUser.Email; password = "WrongPassword123!" } }
$wrongPasswordResult = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $loginQuery -Variables $wrongPasswordVars -Description "login with wrong password"
$testResults["login_wrong_password"] = -not $wrongPasswordResult.Success  # Should fail

# Test 4: Login with non-existent user (should fail)
Write-Host ""
Write-Host "Test 4: Login with non-existent user (should fail)" -ForegroundColor Yellow
$nonexistentVars = @{ input = @{ tenantId = $tenantId; identifier = "nonexistent@test.com"; password = "TestPass123!" } }
$nonexistentResult = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $loginQuery -Variables $nonexistentVars -Description "login with non-existent user"
$testResults["login_nonexistent"] = -not $nonexistentResult.Success  # Should fail

# ═══════════════════════════════════════════════════════════════
# SECTION 4: AUTHENTICATED OPERATIONS
# ═══════════════════════════════════════════════════════════════

if ($userToken) {
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "SECTION 4: Authenticated Operations" -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""
    
    # Test 1: Get current user (me)
    Write-Host "Test 1: Get current user (me)" -ForegroundColor Yellow
    $meQuery = "query { me { id email username roles status emailVerified phoneVerified twoFactorEnabled } }"
    $meResult = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $meQuery -Token $userToken -Description "me query"
    $testResults["me"] = $meResult.Success
    
    # Test 2: Get sessions
    Write-Host ""
    Write-Host "Test 2: Get user sessions" -ForegroundColor Yellow
    $sessionsQuery = "query { mySessions { id isValid createdAt lastAccessedAt } }"
    $sessionsResult = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $sessionsQuery -Token $userToken -Description "mySessions query"
    $testResults["mySessions"] = $sessionsResult.Success
    
    # Test 3: Refresh token
    Write-Host ""
    Write-Host "Test 3: Refresh access token" -ForegroundColor Yellow
    if ($refreshToken) {
        $refreshQuery = "mutation RefreshToken(`$input: RefreshTokenInput!) { refreshToken(input: `$input) { success tokens { accessToken refreshToken } user { id } } }"
        $refreshVars = @{ input = @{ refreshToken = $refreshToken; tenantId = $tenantId } }
        $refreshResult = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $refreshQuery -Variables $refreshVars -Description "refreshToken"
        $testResults["refreshToken"] = $refreshResult.Success
    }
    
    # Test 4: Change password
    Write-Host ""
    Write-Host "Test 4: Change password" -ForegroundColor Yellow
    $changePasswordQuery = "mutation ChangePassword(`$input: ChangePasswordInput!) { changePassword(input: `$input) { success message } }"
    $changePasswordVars = @{ input = @{ userId = $userId; tenantId = $tenantId; currentPassword = $testUser.Password; newPassword = "NewTestPass123!@#" } }
    $changePasswordResult = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $changePasswordQuery -Variables $changePasswordVars -Token $userToken -Description "changePassword"
    $testResults["changePassword"] = $changePasswordResult.Success
    
    # Change password back
    if ($changePasswordResult.Success) {
        $revertVars = @{ input = @{ userId = $userId; tenantId = $tenantId; currentPassword = "NewTestPass123!@#"; newPassword = $testUser.Password } }
        Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $changePasswordQuery -Variables $revertVars -Token $userToken -Description "revert password" | Out-Null
    }
    
    # Test 5: Logout
    Write-Host ""
    Write-Host "Test 5: Logout" -ForegroundColor Yellow
    if ($refreshToken) {
        $logoutQuery = "mutation Logout(`$refreshToken: String!) { logout(refreshToken: `$refreshToken) { success message } }"
        $logoutVars = @{ refreshToken = $refreshToken }
        $logoutResult = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $logoutQuery -Variables $logoutVars -Token $userToken -Description "logout"
        $testResults["logout"] = $logoutResult.Success
    }
}

# ═══════════════════════════════════════════════════════════════
# SECTION 5: OTP TESTS
# ═══════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "SECTION 5: OTP Tests" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Test 1: Send OTP via email
Write-Host "Test 1: Send OTP via email" -ForegroundColor Yellow
$sendOTPQuery = "mutation SendOTP(`$input: SendOTPInput!) { sendOTP(input: `$input) { success message otpSentTo channel expiresIn } }"
$sendOTPVars = @{ input = @{ tenantId = $tenantId; recipient = $testUser.Email; channel = "email"; purpose = "email_verification" } }
$sendOTPResult = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $sendOTPQuery -Variables $sendOTPVars -Description "sendOTP via email"
$testResults["sendOTP_email"] = $sendOTPResult.Success

# Test 2: Verify OTP with wrong code (should fail)
Write-Host ""
Write-Host "Test 2: Verify OTP with wrong code (should fail)" -ForegroundColor Yellow
$verifyOTPQuery = "mutation VerifyOTP(`$input: VerifyOTPInput!) { verifyOTP(input: `$input) { success message } }"
$verifyOTPVars = @{ input = @{ tenantId = $tenantId; recipient = $testUser.Email; code = "000000"; purpose = "email_verification" } }
$verifyOTPResult = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $verifyOTPQuery -Variables $verifyOTPVars -Description "verifyOTP with wrong code"
$testResults["verifyOTP_wrong"] = -not $verifyOTPResult.Success  # Should fail

# Test 3: Resend OTP
Write-Host ""
Write-Host "Test 3: Resend OTP" -ForegroundColor Yellow
$resendOTPQuery = "mutation ResendOTP(`$recipient: String!, `$purpose: String!, `$tenantId: String!) { resendOTP(recipient: `$recipient, purpose: `$purpose, tenantId: `$tenantId) { success message expiresIn } }"
$resendOTPVars = @{ recipient = $testUser.Email; purpose = "email_verification"; tenantId = $tenantId }
$resendOTPResult = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $resendOTPQuery -Variables $resendOTPVars -Description "resendOTP"
$testResults["resendOTP"] = $resendOTPResult.Success

# ═══════════════════════════════════════════════════════════════
# SECTION 6: PASSWORD RESET TESTS
# ═══════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "SECTION 6: Password Reset Tests" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Test 1: Forgot password
Write-Host "Test 1: Request password reset" -ForegroundColor Yellow
$forgotPasswordQuery = "mutation ForgotPassword(`$input: ForgotPasswordInput!) { forgotPassword(input: `$input) { success message } }"
$forgotPasswordVars = @{ input = @{ tenantId = $tenantId; identifier = $testUser.Email } }
$forgotPasswordResult = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $forgotPasswordQuery -Variables $forgotPasswordVars -Description "forgotPassword"
$testResults["forgotPassword"] = $forgotPasswordResult.Success

# Test 2: Reset password with invalid token (should fail)
Write-Host ""
Write-Host "Test 2: Reset password with invalid token (should fail)" -ForegroundColor Yellow
$resetPasswordQuery = "mutation ResetPassword(`$input: ResetPasswordInput!) { resetPassword(input: `$input) { success message } }"
$resetPasswordVars = @{ input = @{ tenantId = $tenantId; token = "invalid-token-12345"; newPassword = "NewPassword123!" } }
$resetPasswordResult = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $resetPasswordQuery -Variables $resetPasswordVars -Description "resetPassword with invalid token"
$testResults["resetPassword_invalid"] = -not $resetPasswordResult.Success  # Should fail

# ═══════════════════════════════════════════════════════════════
# SECTION 7: TWO-FACTOR AUTHENTICATION TESTS
# ═══════════════════════════════════════════════════════════════

if ($userToken -and $userId) {
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "SECTION 7: Two-Factor Authentication Tests" -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""
    
    # Test 1: Enable 2FA
    Write-Host "Test 1: Enable 2FA" -ForegroundColor Yellow
    $enable2FAQuery = "mutation Enable2FA(`$input: Enable2FAInput!) { enable2FA(input: `$input) { success secret qrCode backupCodes } }"
    $enable2FAVars = @{ input = @{ userId = $userId; tenantId = $tenantId; password = $testUser.Password } }
    $enable2FAResult = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $enable2FAQuery -Variables $enable2FAVars -Token $userToken -Description "enable2FA"
    $testResults["enable2FA"] = $enable2FAResult.Success
    
    if ($enable2FAResult.Success -and $enable2FAResult.Data.enable2FA.success) {
        Write-Host "    2FA Secret: $($enable2FAResult.Data.enable2FA.secret)" -ForegroundColor Gray
        Write-Host "    Backup Codes: $($enable2FAResult.Data.enable2FA.backupCodes.Count) codes generated" -ForegroundColor Gray
    }
    
    # Test 2: Verify 2FA with wrong code (should fail)
    Write-Host ""
    Write-Host "Test 2: Verify 2FA with wrong code (should fail)" -ForegroundColor Yellow
    $verify2FAQuery = "mutation Verify2FA(`$input: Verify2FAInput!) { verify2FA(input: `$input) { success message } }"
    $verify2FAVars = @{ input = @{ userId = $userId; tenantId = $tenantId; token = "000000" } }
    $verify2FAResult = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $verify2FAQuery -Variables $verify2FAVars -Token $userToken -Description "verify2FA with wrong code"
    $testResults["verify2FA_wrong"] = -not $verify2FAResult.Success  # Should fail
    
    # Test 3: Regenerate backup codes
    Write-Host ""
    Write-Host "Test 3: Regenerate backup codes" -ForegroundColor Yellow
    $regenerateBackupQuery = "mutation RegenerateBackupCodes(`$password: String!) { regenerateBackupCodes(password: `$password) { success backupCodes message } }"
    $regenerateBackupVars = @{ password = $testUser.Password }
    $regenerateBackupResult = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $regenerateBackupQuery -Variables $regenerateBackupVars -Token $userToken -Description "regenerateBackupCodes"
    $testResults["regenerateBackupCodes"] = $regenerateBackupResult.Success
    
    # Test 4: Disable 2FA
    Write-Host ""
    Write-Host "Test 4: Disable 2FA" -ForegroundColor Yellow
    $disable2FAQuery = "mutation Disable2FA(`$password: String!) { disable2FA(password: `$password) { success message } }"
    $disable2FAVars = @{ password = $testUser.Password }
    $disable2FAResult = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $disable2FAQuery -Variables $disable2FAVars -Token $userToken -Description "disable2FA"
    $testResults["disable2FA"] = $disable2FAResult.Success
}

# ═══════════════════════════════════════════════════════════════
# SECTION 8: ADMIN OPERATIONS (if admin token available)
# ═══════════════════════════════════════════════════════════════

# Setup system user for system tests
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "SECTION 8: System Operations" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$systemEmail = "system@demo.com"
$systemPassword = "System123!@#"
$systemToken = $null

# Try to login as system
$systemLoginQuery = "mutation Login(`$input: LoginInput!) { login(input: `$input) { success tokens { accessToken } user { id roles } } }"
$systemLoginVars = @{ input = @{ tenantId = $tenantId; identifier = $systemEmail; password = $systemPassword } }
$systemLoginBody = @{ query = $systemLoginQuery; variables = $systemLoginVars } | ConvertTo-Json -Depth 10 -Compress

try {
    $systemLogin = Invoke-RestMethod -Uri $authUrl -Method POST -Body $systemLoginBody -ContentType "application/json" -TimeoutSec 10 -ErrorAction Stop
    
    if ($systemLogin.data -and $systemLogin.data.login -and $systemLogin.data.login.success -and ($systemLogin.data.login.user.roles -contains "system")) {
        $systemToken = "Bearer $($systemLogin.data.login.tokens.accessToken)"
        Write-Host "  [OK] System user logged in successfully" -ForegroundColor Green
    } else {
        Write-Host "  [WARN] System user not available or not system. Skipping system tests..." -ForegroundColor Yellow
    }
} catch {
    Write-Host "  [WARN] Could not login as system. Skipping system tests..." -ForegroundColor Yellow
}

if ($systemToken) {
    # Test 1: List all users
    Write-Host ""
    Write-Host "Test 1: List all users (system)" -ForegroundColor Yellow
    $usersQuery = "query Users(`$tenantId: String, `$first: Int, `$skip: Int) { users(tenantId: `$tenantId, first: `$first, skip: `$skip) { nodes { id email username roles status } totalCount } }"
    $usersVars = @{ tenantId = $tenantId; first = 10; skip = 0 }
    $usersResult = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $usersQuery -Variables $usersVars -Token $systemToken -Description "users (system)"
    $testResults["users_system"] = $usersResult.Success
    
    # Get a user ID from the users list for subsequent tests
    $testUserId = $null
    if ($usersResult.Success -and $usersResult.Data.users.nodes.Count -gt 0) {
        # Try to use the original $userId if it exists in the list, otherwise use the first non-system user
        $userFound = $usersResult.Data.users.nodes | Where-Object { $_.id -eq $userId }
        if ($userFound) {
            $testUserId = $userId
        } else {
            # Find a non-system user to test with
            $nonSystemUser = $usersResult.Data.users.nodes | Where-Object { $_.roles -notcontains "system" } | Select-Object -First 1
            if ($nonSystemUser) {
                $testUserId = $nonSystemUser.id
            } else {
                # Fallback to first user if all are system users
                $testUserId = $usersResult.Data.users.nodes[0].id
            }
        }
        Write-Host "  [INFO] Using user ID for system tests: $testUserId" -ForegroundColor Gray
    }
    
    # Test 2: Get user by ID
    Write-Host ""
    Write-Host "Test 2: Get user by ID (system)" -ForegroundColor Yellow
    if ($testUserId) {
        $getUserQuery = "query GetUser(`$id: ID!, `$tenantId: String!) { getUser(id: `$id, tenantId: `$tenantId) { id email username roles status } }"
        $getUserVars = @{ id = $testUserId; tenantId = $tenantId }
        $getUserResult = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $getUserQuery -Variables $getUserVars -Token $systemToken -Description "getUser (system)"
        $testResults["getUser_system"] = $getUserResult.Success
        # Update testUserId if getUser succeeded
        if ($getUserResult.Success -and $getUserResult.Data.getUser) {
            $testUserId = $getUserResult.Data.getUser.id
        }
    } else {
        Write-Host "  [SKIP] No user ID available for getUser test" -ForegroundColor Yellow
        $testResults["getUser_admin"] = $false
    }
    
    # Test 3: Update user roles
    Write-Host ""
    Write-Host "Test 3: Update user roles (system)" -ForegroundColor Yellow
    if ($testUserId) {
        Write-Host "  [INFO] Attempting to update roles for user ID: $testUserId" -ForegroundColor Gray
        $updateRolesQuery = "mutation UpdateUserRoles(`$input: UpdateUserRolesInput!) { updateUserRoles(input: `$input) { id roles } }"
        $updateRolesVars = @{ input = @{ userId = $testUserId; tenantId = $tenantId; roles = @("user", "moderator") } }
        $updateRolesResult = Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $updateRolesQuery -Variables $updateRolesVars -Token $systemToken -Description "updateUserRoles (system)"
        $testResults["updateUserRoles"] = $updateRolesResult.Success
        
        # Revert back to user role
        if ($updateRolesResult.Success) {
            $revertRolesVars = @{ input = @{ userId = $testUserId; tenantId = $tenantId; roles = @("user") } }
            Test-GraphQL -ServiceName "Auth" -Url $authUrl -Query $updateRolesQuery -Variables $revertRolesVars -Token $systemToken -Description "revert roles" | Out-Null
        } else {
            Write-Host "  [WARN] updateUserRoles failed. Error: $($updateRolesResult.Error)" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  [SKIP] No user ID available for role update test" -ForegroundColor Yellow
        $testResults["updateUserRoles"] = $false
    }
}

# ═══════════════════════════════════════════════════════════════
# TEST SUMMARY
# ═══════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "           TEST SUMMARY                                        " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

$totalTests = $testResults.Count
$passedTests = ($testResults.Values | Where-Object { $_ -eq $true }).Count
$failedTests = $totalTests - $passedTests

Write-Host "Total Tests: $totalTests" -ForegroundColor Cyan
Write-Host "Passed: $passedTests" -ForegroundColor Green
Write-Host "Failed: $failedTests" -ForegroundColor $(if ($failedTests -eq 0) { "Green" } else { "Red" })
Write-Host ""

if ($failedTests -gt 0) {
    Write-Host "Failed Tests:" -ForegroundColor Red
    foreach ($test in $testResults.GetEnumerator() | Where-Object { $_.Value -eq $false }) {
        Write-Host "  - $($test.Key)" -ForegroundColor Yellow
    }
    Write-Host ""
}

if ($failedTests -eq 0) {
    Write-Host "[OK] All tests passed!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "[FAIL] Some tests failed" -ForegroundColor Red
    exit 1
}
