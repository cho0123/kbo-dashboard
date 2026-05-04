#Requires -Version 5.1
<#
  BtbN FFmpeg-Builds — linux64 GPL (fontconfig / drawtext 등 포함).
  7-Zip 으로 tar.xz → tar → 전체 폴더 순서로 풀고 bin/ffmpeg · bin/ffprobe 를 lambda/bin/ 에 복사.

  deploy.ps1 전에 실행: .\download-ffmpeg.ps1

  참고: Windows에서 재패키지 시 Linux 실행 비트(+x)가 빠질 수 있습니다.
  Lambda 에서 EACCES 가 나면 WSL/CI에서 chmod +x 후 배포 패키지를 만드세요.
#>
param(
    [string]$Url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz',
    [string]$SevenZip = 'C:\Program Files\7-Zip\7z.exe'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $SevenZip)) {
    throw "7-Zip 이 없습니다. 설치 또는 경로를 확인하세요: $SevenZip"
}

$LambdaDir = $PSScriptRoot
$BinDir = Join-Path $LambdaDir 'bin'
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

$TempRoot = Join-Path $env:TEMP ("ffmpeg-btbn-" + [Guid]::NewGuid().ToString('N'))
$TarXzPath = Join-Path $env:TEMP ("ffmpeg-linux64-" + [Guid]::NewGuid().ToString('N') + '.tar.xz')

try {
    New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null

    Write-Host "Downloading: $Url" -ForegroundColor Cyan
    Invoke-WebRequest -Uri $Url -OutFile $TarXzPath -UseBasicParsing

    Write-Host 'Step 1: tar.xz -> .tar (7z extract)' -ForegroundColor Cyan
    & $SevenZip e $TarXzPath "-o$TempRoot\" -y
    if ($LASTEXITCODE -ne 0) {
        throw "7z extraction (tar.xz) failed with exit code $LASTEXITCODE"
    }

    $tarInner = Get-ChildItem -LiteralPath $TempRoot -File -Filter '*.tar' |
        Select-Object -First 1
    if (-not $tarInner) {
        throw "압축 해제 후 $TempRoot 안에서 .tar 파일을 찾을 수 없습니다."
    }
    $TarPath = $tarInner.FullName

    $ExtractedDir = Join-Path $TempRoot 'extracted'
    New-Item -ItemType Directory -Path $ExtractedDir -Force | Out-Null

    Write-Host 'Step 2: .tar 전체 내용 추출 (7z x)' -ForegroundColor Cyan
    & $SevenZip x $TarPath "-o$ExtractedDir\" -y
    if ($LASTEXITCODE -ne 0) {
        throw "7z extraction (.tar) failed with exit code $LASTEXITCODE"
    }

    $ffmpegSrc = Get-ChildItem -LiteralPath $ExtractedDir -Recurse -File -Filter 'ffmpeg' -ErrorAction SilentlyContinue |
        Where-Object { $_.Directory.Name -eq 'bin' } |
        Select-Object -First 1

    if (-not $ffmpegSrc) {
        throw "extracted 폴더 안에서 bin/ffmpeg 을 찾을 수 없습니다."
    }

    $ffprobeSrc = Join-Path $ffmpegSrc.Directory.FullName 'ffprobe'
    $DestFfmpeg = Join-Path $BinDir 'ffmpeg'
    $DestFfprobe = Join-Path $BinDir 'ffprobe'

    Copy-Item -LiteralPath $ffmpegSrc.FullName -Destination $DestFfmpeg -Force
    Write-Host "Saved: $DestFfmpeg" -ForegroundColor Green

    if (Test-Path -LiteralPath $ffprobeSrc) {
        Copy-Item -LiteralPath $ffprobeSrc -Destination $DestFfprobe -Force
        Write-Host "Saved: $DestFfprobe" -ForegroundColor Green
    } else {
        Write-Warning "ffprobe not found in the same bin folder; Lambda probe calls may fail until you add it."
    }
}
finally {
    Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $TarXzPath -Force -ErrorAction SilentlyContinue
}

Write-Host 'Done.' -ForegroundColor Green
