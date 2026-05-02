#Requires -Version 5.1
<#
  Packages only index.mjs and package.json from this folder (excludes ffmpeg-layer.zip and all other files),
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

$zipPath = Join-Path $env:TEMP "kbo-video-encoder-$([Guid]::NewGuid().ToString('N')).zip"
if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}

$toZip = foreach ($name in $Entries) {
    Join-Path $LambdaDir $name
}
Compress-Archive -LiteralPath $toZip -DestinationPath $zipPath -CompressionLevel Optimal -Force

$zipFileUri = 'fileb://' + ($zipPath -replace '\\', '/')
Write-Host "Deployment package: $zipPath" -ForegroundColor Cyan

try {
    aws lambda update-function-code `
        --function-name $FunctionName `
        --zip-file $zipFileUri `
        --region $Region
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    aws lambda update-function-configuration `
        --function-name $FunctionName `
        --timeout 900 `
        --memory-size 3008 `
        --layers $FfmpegLayerArn `
        --environment "Variables={S3_BUCKET=$S3Bucket}" `
        --region $Region
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
    Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
}

Write-Host 'Lambda deploy finished.' -ForegroundColor Green
