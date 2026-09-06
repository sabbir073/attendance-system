# ---------------------------------------------------------------
#  DESCO Attendance — first push to GitHub
#
#  Usage:
#     cd D:\desco-attendance
#     powershell -ExecutionPolicy Bypass -File .\scripts\git-push.ps1
#
#  Safe to re-run. Later pushes only need:
#     git add . ; git commit -m "message" ; git push
# ---------------------------------------------------------------

$ErrorActionPreference = "Stop"

$RepoUrl = "https://github.com/sabbir073/attendance-system.git"
$Root    = Split-Path -Parent $PSScriptRoot

Set-Location $Root
Write-Host "Working in: $Root" -ForegroundColor Cyan

# --- git present? ----------------------------------------------
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "git is not installed or not on PATH. Install from https://git-scm.com/download/win" -ForegroundColor Red
    exit 1
}

# --- identity configured? --------------------------------------
$userName  = (git config --get user.name)  2>$null
$userEmail = (git config --get user.email) 2>$null
if ([string]::IsNullOrWhiteSpace($userName) -or [string]::IsNullOrWhiteSpace($userEmail)) {
    Write-Host "Git identity is not set. Run these once, then re-run this script:" -ForegroundColor Red
    Write-Host '  git config --global user.name  "Your Name"'
    Write-Host '  git config --global user.email "you@example.com"'
    exit 1
}

# --- init ------------------------------------------------------
if (-not (Test-Path (Join-Path $Root ".git"))) {
    Write-Host "Initialising repository..." -ForegroundColor Cyan
    git init | Out-Null
    git branch -M main
} else {
    Write-Host "Repository already initialised." -ForegroundColor DarkGray
}

# --- remote ----------------------------------------------------
$existing = (git remote get-url origin) 2>$null
if ([string]::IsNullOrWhiteSpace($existing)) {
    git remote add origin $RepoUrl
    Write-Host "Remote 'origin' added." -ForegroundColor Cyan
} elseif ($existing.Trim() -ne $RepoUrl) {
    Write-Host "Remote 'origin' points elsewhere:" -ForegroundColor Yellow
    Write-Host "  $existing"
    Write-Host "  expected: $RepoUrl"
    Write-Host "Fix with:  git remote set-url origin $RepoUrl" -ForegroundColor Yellow
    exit 1
}

# --- stage -----------------------------------------------------
git add -A

# --- SECRET GUARD ----------------------------------------------
# .env holds SESSION_SECRET and the database password. If .gitignore has been
# altered and .env got staged, abort before it enters history — where deleting
# the commit would not remove it.
$staged = git diff --cached --name-only
$leaked = $staged | Where-Object {
    $_ -eq ".env" -or $_ -like "*.env.local" -or $_ -like "*.pem" -or $_ -like "*.key"
}

if ($leaked) {
    Write-Host ""
    Write-Host "ABORTED — secret files are staged:" -ForegroundColor Red
    $leaked | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    Write-Host ""
    Write-Host "Unstage them and check .gitignore:" -ForegroundColor Yellow
    Write-Host "    git reset"
    exit 1
}

if ($staged -contains "node_modules" -or ($staged | Where-Object { $_ -like "node_modules/*" })) {
    Write-Host "ABORTED — node_modules is staged. Check .gitignore." -ForegroundColor Red
    git reset | Out-Null
    exit 1
}

Write-Host ""
Write-Host "$($staged.Count) file(s) staged. No secrets detected." -ForegroundColor Green

# --- commit ----------------------------------------------------
$pending = git diff --cached --name-only
if ([string]::IsNullOrWhiteSpace($pending)) {
    Write-Host "Nothing to commit — working tree is clean." -ForegroundColor DarkGray
} else {
    $msg = Read-Host "Commit message (blank = default)"
    if ([string]::IsNullOrWhiteSpace($msg)) {
        $msg = "feat: infrastructure, schema, security core and biometric libraries"
    }
    git commit -m $msg
}

# --- push ------------------------------------------------------
Write-Host ""
Write-Host "Pushing to $RepoUrl" -ForegroundColor Cyan
Write-Host "A browser or credential prompt may appear if this is your first push." -ForegroundColor DarkGray

git push -u origin main

Write-Host ""
Write-Host "Done. https://github.com/sabbir073/attendance-system" -ForegroundColor Green
