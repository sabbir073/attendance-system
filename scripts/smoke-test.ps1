# Smoke test — verifies the deployed stack end to end.
# Compatible with Windows PowerShell 5.1 (no -SkipHttpErrorCheck).
$ErrorActionPreference = "Continue"
$base = "http://localhost:3000"

function Request {
    param(
        [string]$Url,
        [string]$Method = "GET",
        [string]$Body = $null,
        [hashtable]$Headers = @{},
        $Session = $null,
        [int]$MaxRedirect = 5
    )
    $args = @{
        Uri             = $Url
        Method          = $Method
        UseBasicParsing = $true
        Headers         = $Headers
        ErrorAction     = "Stop"
    }
    if ($Body) { $args["Body"] = $Body; $args["ContentType"] = "application/json" }
    if ($Session) { $args["WebSession"] = $Session }
    if ($MaxRedirect -eq 0) { $args["MaximumRedirection"] = 0 }

    try {
        $r = Invoke-WebRequest @args
        return [pscustomobject]@{ Code = [int]$r.StatusCode; Body = $r.Content; Raw = $r }
    } catch {
        $resp = $_.Exception.Response
        if ($resp) {
            $code = [int]$resp.StatusCode
            $text = ""
            try {
                $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
                $text = $sr.ReadToEnd()
            } catch {}
            return [pscustomobject]@{ Code = $code; Body = $text; Raw = $resp }
        }
        return [pscustomobject]@{ Code = -1; Body = $_.Exception.Message; Raw = $null }
    }
}

function Check($label, $ok, $detail) {
    $mark = if ($ok) { "PASS" } else { "FAIL" }
    $col  = if ($ok) { "Green" } else { "Red" }
    Write-Host ("  [{0}] {1}" -f $mark, $label) -ForegroundColor $col
    if ($detail) { Write-Host "         $detail" -ForegroundColor DarkGray }
}

Write-Host "`n=== DESCO Attendance :: smoke test ===`n" -ForegroundColor Cyan

# 1 ------------------------------------------------------------
$r = Request "$base/api/health"
Check "Health endpoint" ($r.Code -eq 200) $r.Body

# 2 ------------------------------------------------------------
$r = Request "$base/dashboard" -MaxRedirect 0
Check "Unauthenticated page is redirected" ($r.Code -eq 307 -or $r.Code -eq 302) "HTTP $($r.Code)"

# 3 ------------------------------------------------------------
$r = Request "$base/api/attendance/network-check"
Check "Unauthenticated API refused" ($r.Code -eq 401) "HTTP $($r.Code)"

# 4 ------------------------------------------------------------
$bad = '{"email":"admin@desco.gov.bd","password":"definitely-wrong"}'
$r = Request "$base/api/auth/login" -Method POST -Body $bad
Check "Wrong password rejected" ($r.Code -eq 401) "HTTP $($r.Code) $($r.Body)"

# 5 ------------------------------------------------------------
$good = '{"email":"admin@desco.gov.bd","password":"Admin@Desco2026"}'
$sess = $null
try {
    $login = Invoke-WebRequest -Uri "$base/api/auth/login" -Method POST -Body $good `
        -ContentType "application/json" -UseBasicParsing -SessionVariable sess -ErrorAction Stop
    Check "Login succeeds" ($login.StatusCode -eq 200) $login.Content
} catch {
    Check "Login succeeds" $false $_.Exception.Message
}

$cookies = $sess.Cookies.GetCookies($base)
$sessionCookie = $cookies | Where-Object { $_.Name -eq "desco_session" }
$csrfCookie    = $cookies | Where-Object { $_.Name -eq "desco_csrf" }

Check "Session cookie set and httpOnly" ($sessionCookie -and $sessionCookie.HttpOnly) `
    "httpOnly=$($sessionCookie.HttpOnly)"
Check "CSRF cookie set and readable by JS" ($csrfCookie -and -not $csrfCookie.HttpOnly) `
    "httpOnly=$($csrfCookie.HttpOnly)"

# 6 ------------------------------------------------------------
$r = Request "$base/api/attendance/network-check" -Session $sess
Check "VPN gate responds" ($r.Code -eq 200) $r.Body

# 7 ------------------------------------------------------------
$r = Request "$base/api/attendance/nonce" -Method POST -Body '{"purpose":"CHECK_IN"}' -Session $sess
Check "CSRF: nonce WITHOUT token is refused" ($r.Code -eq 403) "HTTP $($r.Code)"

# 8 ------------------------------------------------------------
$r = Request "$base/api/attendance/nonce" -Method POST -Body '{"purpose":"CHECK_IN"}' `
    -Headers @{ "x-csrf-token" = $csrfCookie.Value } -Session $sess
Check "CSRF: nonce WITH token succeeds" ($r.Code -eq 200) $r.Body

# 9 ------------------------------------------------------------
# A page that redirected us to /login still returns HTTP 200, so status code
# alone is a false pass. The login form is the marker for "not authenticated".
function IsLoginPage($html) {
    return ($html -match 'Use your official DESCO credentials')
}

Write-Host "`n  Admin pages:" -ForegroundColor Cyan
foreach ($p in @("/admin", "/admin/attendance", "/admin/employees", "/admin/offices", "/admin/security", "/admin/settings")) {
    $r = Request "$base$p" -Session $sess
    $bounced = IsLoginPage $r.Body
    Check $p (($r.Code -eq 200) -and (-not $bounced)) `
        "HTTP $($r.Code), $($r.Body.Length) bytes$(if ($bounced) { ' — BOUNCED TO LOGIN' })"
}

Write-Host "`n  Employee pages:" -ForegroundColor Cyan
foreach ($p in @("/dashboard", "/attendance", "/history", "/profile")) {
    $r = Request "$base$p" -Session $sess
    $bounced = IsLoginPage $r.Body
    Check $p (($r.Code -eq 200) -and (-not $bounced)) `
        "HTTP $($r.Code), $($r.Body.Length) bytes$(if ($bounced) { ' — BOUNCED TO LOGIN' })"
}

Write-Host "`n=== complete ===`n" -ForegroundColor Cyan
