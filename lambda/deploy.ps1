#Requires -Version 5.1
<#
  function zip에는 index.mjs, package.json, bin/yt-dlp, fonts/(있으면) 포함.
  ffmpeg·ffprobe 는 Lambda 레이어(.\create-ffmpeg-layer.ps1)의 /opt/bin 을 사용.

  업로드: S3 — kbo-video-export/lambda-deploy/kbo-video-encoder.zip (70MB 직접 업로드 한도 우회)

  레이어 ARN: -FfmpegLayerArn 전달 또는 .\create-ffmpeg-layer.ps1 실행 후 생성되는 ffmpeg-btbn-layer.arn
#>
param(
    [string]$Region = 'ap-northeast-2',
    [string]$FunctionName = 'kbo-video-encoder',
    [string]$S3Bucket = 'kbo-video-export',
    [string]$S3Key = 'lambda-deploy/kbo-video-encoder.zip',
    [string]$FfmpegLayerArn = ''
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw 'AWS CLI (aws) was not found in PATH. Install and configure it before deploying.'
}

$LambdaDir = $PSScriptRoot
$ArnFile = Join-Path $LambdaDir 'ffmpeg-btbn-layer.arn'
if ([string]::IsNullOrWhiteSpace($FfmpegLayerArn) -and (Test-Path -LiteralPath $ArnFile)) {
    $FfmpegLayerArn = (Get-Content -LiteralPath $ArnFile -Raw).Trim()
}
if ([string]::IsNullOrWhiteSpace($FfmpegLayerArn)) {
    throw "FfmpegLayerArn 비어 있음. .\create-ffmpeg-layer.ps1 로 레이어를 배포한 뒤 ffmpeg-btbn-layer.arn 이 생기거나, -FfmpegLayerArn 'arn:...:layer:ffmpeg-btbn-layer:N' 로 전달하세요."
}

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

$StageRoot = Join-Path $env:TEMP ("lambda-func-stage-" + [Guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $StageRoot -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $LambdaDir 'index.mjs') -Destination $StageRoot -Force
    Copy-Item -LiteralPath (Join-Path $LambdaDir 'package.json') -Destination $StageRoot -Force

    $stageBin = Join-Path $StageRoot 'bin'
    New-Item -ItemType Directory -Path $stageBin -Force | Out-Null
    Copy-Item -LiteralPath $YtdlpPath -Destination (Join-Path $stageBin 'yt-dlp') -Force

    $fontsDir = Join-Path $LambdaDir 'fonts'
    if (Test-Path -LiteralPath $fontsDir) {
        Copy-Item -LiteralPath $fontsDir -Destination (Join-Path $StageRoot 'fonts') -Recurse -Force
    }

    Push-Location $StageRoot
    try {
        $toZip = @('index.mjs', 'package.json', 'bin')
        if (Test-Path -LiteralPath (Join-Path $StageRoot 'fonts')) {
            $toZip += 'fonts'
        }
        Compress-Archive -Path $toZip -DestinationPath $zipPath -CompressionLevel Optimal -Force
    }
    finally {
        Pop-Location
    }
}
finally {
    Remove-Item -LiteralPath $StageRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Deployment package (no ffmpeg in zip): $zipPath" -ForegroundColor Cyan

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

    $layersJsonPath = Join-Path $env:TEMP ("lambda-layers-" + [Guid]::NewGuid().ToString('N') + '.json')
    try {
        $esc = $FfmpegLayerArn -replace '\\', '\\\\' -replace '"', '\"'
        [System.IO.File]::WriteAllText($layersJsonPath, "[`"$esc`"]", (New-Object System.Text.UTF8Encoding $false))

        $abs = (Resolve-Path -LiteralPath $layersJsonPath).Path
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
            --environment "Variables={S3_BUCKET=$S3Bucket,PATH=/var/task/bin:/opt/bin:/usr/local/bin:/usr/bin:/bin}" `
            --region $Region
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    finally {
        Remove-Item -LiteralPath $layersJsonPath -Force -ErrorAction SilentlyContinue
    }
}
finally {
    Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
}

Write-Host 'Lambda deploy finished.' -ForegroundColor Green
