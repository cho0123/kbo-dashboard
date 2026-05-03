#Requires -Version 5.1
<#
  lambda/bin 의 BtbN ffmpeg·ffprobe 로 Lambda 레이어(zip)를 만들고 S3 에 올린 뒤 publish-layer-version 합니다.
  (직접 --zip-file 업로드 50MB 제한 우회)

  레이어에 올라간 바이너리는 런타임에서 /opt/bin/ffmpeg, /opt/bin/ffprobe 로 접근됩니다.

  사전: .\download-ffmpeg.ps1 로 bin/ffmpeg, bin/ffprobe 준비

  배포 후 출력되는 LayerVersionArn 을 deploy.ps1 에 전달하거나,
  같은 폴더의 ffmpeg-btbn-layer.arn 파일을 deploy.ps1 이 자동으로 읽습니다.
#>
param(
    [string]$Region = 'ap-northeast-2',
    [string]$LayerName = 'ffmpeg-btbn-layer',
    [string]$Description = 'FFmpeg BtbN build with drawtext support',
    [string]$ZipFileName = 'ffmpeg-btbn-layer.zip',
    [string]$S3Bucket = 'kbo-video-export',
    [string]$S3Key = 'lambda-deploy/ffmpeg-btbn-layer.zip'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw 'AWS CLI (aws) was not found in PATH.'
}

$LambdaDir = $PSScriptRoot
$FfmpegPath = Join-Path $LambdaDir 'bin\ffmpeg'
$FfprobePath = Join-Path $LambdaDir 'bin\ffprobe'

if (-not (Test-Path -LiteralPath $FfmpegPath)) {
    throw "ffmpeg not found: $FfmpegPath — run .\download-ffmpeg.ps1 first."
}
if (-not (Test-Path -LiteralPath $FfprobePath)) {
    throw "ffprobe not found: $FfprobePath — run .\download-ffmpeg.ps1 first."
}

$LayerZipPath = Join-Path $LambdaDir $ZipFileName
$StageRoot = Join-Path $env:TEMP ("ffmpeg-btbn-layer-stage-" + [Guid]::NewGuid().ToString('N'))

try {
    $binStage = Join-Path $StageRoot 'bin'
    New-Item -ItemType Directory -Path $binStage -Force | Out-Null
    Copy-Item -LiteralPath $FfmpegPath -Destination (Join-Path $binStage 'ffmpeg') -Force
    Copy-Item -LiteralPath $FfprobePath -Destination (Join-Path $binStage 'ffprobe') -Force

    if (Test-Path -LiteralPath $LayerZipPath) {
        Remove-Item -LiteralPath $LayerZipPath -Force
    }

    Push-Location $StageRoot
    try {
        # zip 루트에 bin/ffmpeg, bin/ffprobe 구조 유지
        Compress-Archive -Path 'bin' -DestinationPath $LayerZipPath -CompressionLevel Optimal -Force
    }
    finally {
        Pop-Location
    }
    Write-Host "Layer zip: $LayerZipPath" -ForegroundColor Cyan
}
finally {
    Remove-Item -LiteralPath $StageRoot -Recurse -Force -ErrorAction SilentlyContinue
}

$s3Uri = "s3://$S3Bucket/$S3Key"
Write-Host "Uploading layer zip to $s3Uri ..." -ForegroundColor Cyan
aws s3 cp $LayerZipPath $s3Uri --region $Region
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$publishOut = aws lambda publish-layer-version `
    --layer-name $LayerName `
    --description $Description `
    --content "S3Bucket=$S3Bucket,S3Key=$S3Key" `
    --compatible-runtimes nodejs24.x `
    --region $Region `
    --output json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$published = $publishOut | ConvertFrom-Json

if (-not $published.LayerVersionArn) {
    throw 'publish-layer-version did not return LayerVersionArn.'
}

$arn = $published.LayerVersionArn
Write-Host ''
Write-Host "LayerVersionArn: $arn" -ForegroundColor Green
Write-Host ''

$ArnFile = Join-Path $LambdaDir 'ffmpeg-btbn-layer.arn'
Set-Content -LiteralPath $ArnFile -Value $arn -Encoding Ascii -NoNewline
Write-Host "Saved ARN to $ArnFile (for deploy.ps1)" -ForegroundColor Cyan
