# Quick script to update GitHub Pages (same idea as Lyrico)

Write-Host "Updating GitHub Pages..." -ForegroundColor Cyan

Set-Location $PSScriptRoot

git add -A
$message = Read-Host "Enter commit message (or press Enter for default)"
if ([string]::IsNullOrWhiteSpace($message)) {
  $message = "Update Debate Roulette"
}

git commit -m $message
Write-Host "Pushing to GitHub..." -ForegroundColor Yellow
git push

Write-Host "Done. Live in 1-2 minutes:" -ForegroundColor Green
Write-Host "https://FrostyDog8.github.io/DebateRoulette/" -ForegroundColor Cyan
