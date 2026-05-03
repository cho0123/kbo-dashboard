#Requires -Version 5.1
<#
  Downloads the official yt-dlp Linux x86_64 standalone binary for Lambda deployment.
  Run before deploy.ps1 so lambda/bin/yt-dlp exists.

  After download on Linux/macOS, run: chmod +x lambda/bin/yt-dlp
  (Windows zip upload may not preserve +x; verify execute bit if Lambda fails to spawn.)
#>
param()

$ErrorActionPreference = 'Stop'

$LambdaDir = $PSScriptRoot
$BinDir = Join-Path $LambdaDir 'bin'
$Dest = Join-Path $BinDir 'yt-dlp'
$Url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp'

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

Write-Host "Downloading yt-dlp from $Url ..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing

Write-Host "Saved: $Dest" -ForegroundColor Green
