#Requires -Version 5.1
<#
  Packages index.mjs, package.json, bin/ (yt-dlp: .\download-ytdlp.ps1, ffmpeg/ffprobe: .\download-ffmpeg.ps1),
  uploads zip to S3, then updates kbo-video-encoder code from that object (직접 zip 업로드 70MB 제한 우회).

  FFmpeg 는 Lambda 레이어가 아니라 deployment zip 의 bin/ffmpeg · bin/ffprobe 를 사용합니다.
#>
param(
    [string]$Region = 'ap-northeast-2',
    [string]$FunctionName = 'kbo-video-encoder',
    [string]$S3Bucket = 'kbo-video-export',
    [string]$S3Key = 'lambda-deploy/kbo-video-encoder.zip'
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

$FfmpegPath = Join-Path $LambdaDir 'bin\ffmpeg'
if (-not (Test-Path -LiteralPath $FfmpegPath)) {
    throw "ffmpeg binary not found: $FfmpegPath — run .\download-ffmpeg.ps1 in this folder first."
}

$FfprobePath = Join-Path $LambdaDir 'bin\ffprobe'
if (-not (Test-Path -LiteralPath $FfprobePath)) {
    throw "ffprobe binary not found: $FfprobePath — run .\download-ffmpeg.ps1 (BtbN tarball includes both in bin/)."
}

$zipPath = Join-Path $env:TEMP "kbo-video-encoder-$([Guid]::NewGuid().ToString('N')).zip"
if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}

Push-Location $LambdaDir
try {
    $zipEntries = @('index.mjs', 'package.json', 'bin')
    $fontsDir = Join-Path $LambdaDir 'fonts'
    if (Test-Path -LiteralPath $fontsDir) {
        $zipEntries += 'fonts'
    }
    Compress-Archive -Path $zipEntries -DestinationPath $zipPath -CompressionLevel Optimal -Force
}
finally {
    Pop-Location
}

Write-Host "Deployment package: $zipPath" -ForegroundColor Cyan

$s3Uri = "s3://$S3Bucket/$S3Key"

try {
    Write-Host "Uploading zip to $s3Uri ..." -ForegroundColor Cyan
    aws s3 cp $zipPath $s3Uri --region $Region
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    aws lambda update-function-code `
        --function-name $FunctionName `
        --s3-bucket $S3Bucket `
        --s3-key $S3Key `
        --region $Region
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    aws lambda wait function-updated --function-name $FunctionName --region $Region
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    # PATH: 번들 ffmpeg/ffprobe·yt-dlp (/var/task/bin). FFmpeg Lambda 레이어 제거 시 빈 Layers JSON 파일 필요 (Windows CLI 안정).
    $emptyLayersJson = Join-Path $env:TEMP ("lambda-clear-layers-" + [Guid]::NewGuid().ToString('N') + '.json')
    try {
        [System.IO.File]::WriteAllText($emptyLayersJson, '[]')

        $abs = (Resolve-Path -LiteralPath $emptyLayersJson).Path
        if ($abs -match '^([A-Za-z]):\\(.*)$') {
            $drive = $Matches[1].ToUpper()
            $rest = ($Matches[2] -replace '\\', '/')
            $layersFileUri = "file:///$drive`:/$rest"
        } else {
            $layersFileUri = 'file://' + ($abs -replace '\\', '/')
        }

        aws lambda update-function-configuration `
            --function-name $FunctionName `
            --timeout 900 `
            --memory-size 3008 `
            --ephemeral-storage Size=10240 `
            --layers $layersFileUri `
            --environment "Variables={S3_BUCKET=$S3Bucket,PATH=/var/task/bin:/usr/local/bin:/usr/bin:/bin}" `
            --region $Region
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    finally {
        Remove-Item -LiteralPath $emptyLayersJson -Force -ErrorAction SilentlyContinue
    }
}
finally {
    Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
}

Write-Host 'Lambda deploy finished.' -ForegroundColor Green
