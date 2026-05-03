#Requires -Version 5.1
<#
  Packages index.mjs, package.json, and bin/ (yt-dlp binary after .\download-ytdlp.ps1),
  uploads to kbo-video-encoder, and applies function configuration.
#>
param(
    [string]$Region = 'ap-northeast-2',
    [string]$FunctionName = 'kbo-video-encoder',
    [string]$S3Bucket = 'kbo-video-export',
    [string]$FfmpegLayerArn = 'arn:aws:lambda:ap-northeast-2:261142222626:layer:ffmpeg-layer:1'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw 'AWS CLI (aws) was not found in PATH. Install and configure it before deploying.'
}

$LambdaDir = $PSScriptRoot
$Entries = @('index.mjs', 'package.json')

foreach ($name in $Entries) {
    $p = Join-Path $LambdaDir $name
    if (-not (Test-Path -LiteralPath $p)) {
        throw "Required file not found: $p"
    }
}

$YtdlpPath = Join-Path $LambdaDir 'bin\yt-dlp'
if (-not (Test-Path -LiteralPath $YtdlpPath)) {
    throw "yt-dlp binary not found: $YtdlpPath — run .\download-ytdlp.ps1 in this folder first."
}

$zipPath = Join-Path $env:TEMP "kbo-video-encoder-$([Guid]::NewGuid().ToString('N')).zip"
if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}

Push-Location $LambdaDir
try {
    Compress-Archive -Path @('index.mjs', 'package.json', 'bin') -DestinationPath $zipPath -CompressionLevel Optimal -Force
}
finally {
    Pop-Location
}

$zipFileUri = 'fileb://' + ($zipPath -replace '\\', '/')
Write-Host "Deployment package: $zipPath" -ForegroundColor Cyan

try {
    aws lambda update-function-code `
        --function-name $FunctionName `
        --zip-file $zipFileUri `
        --region $Region
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    aws lambda wait function-updated --function-name $FunctionName --region $Region
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    # 환경변수 PATH: /var/task/bin 우선 (번들 yt-dlp). S3_BUCKET 기본=kbo-video-export ($S3Bucket)
    aws lambda update-function-configuration `
        --function-name $FunctionName `
        --timeout 900 `
        --memory-size 3008 `
        --ephemeral-storage Size=10240 `
        --layers $FfmpegLayerArn `
        --environment "Variables={S3_BUCKET=$S3Bucket,PATH=/var/task/bin:/usr/local/bin:/usr/bin:/bin}" `
        --region $Region
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
    Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
}

Write-Host 'Lambda deploy finished.' -ForegroundColor Green
