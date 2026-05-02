#Requires -Version 5.1
<#
.SYNOPSIS
  Downloads John Van Sickle FFmpeg amd64 static build and publishes an AWS Lambda layer ( /opt/bin/ffmpeg ).

.NOTES
  Release tarball URL (verified 2026): https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz

.EXAMPLE
  .\create-ffmpeg-layer.ps1
.EXAMPLE
  .\create-ffmpeg-layer.ps1 -LayerName my-ffmpeg -Region ap-northeast-2 -ProfileName myprofile
#>
param(
    [string] $Region = 'ap-northeast-2',
    [string] $LayerName = 'ffmpeg-static',
    [string] $DownloadUrl = 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
    [string[]] $CompatibleRuntimes = @('nodejs22.x', 'nodejs20.x', 'nodejs18.x'),
    [string[]] $CompatibleArchitectures = @('x86_64'),
    [string] $ProfileName = '',
    [switch] $KeepBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-7ZipExecutable {
    $fromPath = Get-Command 7z -ErrorAction SilentlyContinue
    if ($fromPath -and (Test-Path -LiteralPath $fromPath.Source)) {
        return $fromPath.Source
    }
    foreach ($p in @(
            (Join-Path $env:ProgramFiles '7-Zip\7z.exe'),
            (Join-Path ${env:ProgramFiles(x86)} '7-Zip\7z.exe')
        )) {
        if (Test-Path -LiteralPath $p) {
            return $p
        }
    }
    return $null
}

function Test-WslTarAvailable {
    $wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
    if (-not $wsl) {
        return $false
    }
    $uname = & wsl.exe uname 2>$null
    return ($uname -match '^Linux')
}

function Expand-FfmpegTarXzWsl {
    param(
        [string] $TarXzPath,
        [string] $DestinationDir
    )
    if (-not (Test-WslTarAvailable)) {
        return $false
    }
    try {
        $bashTar = (& wsl.exe wslpath -a $TarXzPath).Trim()
        $bashDest = (& wsl.exe wslpath -a $DestinationDir).Trim()
    } catch {
        return $false
    }
    if (-not $bashTar -or -not $bashDest) {
        return $false
    }
    Write-Host "Using WSL tar to extract .tar.xz..."
    & wsl.exe -- bash -lc "tar -xf `"$bashTar`" -C `"$bashDest`""
    if ($LASTEXITCODE -ne 0) {
        return $false
    }
    $extracted = Get-ChildItem -LiteralPath $DestinationDir -ErrorAction SilentlyContinue
    if (-not $extracted) {
        return $false
    }
    return $true
}

function Get-XzFromGitHubRelease {
    param([string] $ToolsRoot)
    # Official Windows xz utils (ZIP expands with Expand-Archive; no 7-Zip required).
    $xzZipUrl = 'https://github.com/tukaani-project/xz/releases/download/v5.8.3/xz-5.8.3-windows.zip'
    $xzZipPath = Join-Path $ToolsRoot 'xz-windows.zip'
    $xzExtract = Join-Path $ToolsRoot 'xz-extract'
    New-Item -ItemType Directory -Path $ToolsRoot -Force | Out-Null
    Write-Host "Downloading xz.exe helper from GitHub ($xzZipUrl)..."
    Invoke-WebRequest -Uri $xzZipUrl -OutFile $xzZipPath -UseBasicParsing
    if (Test-Path -LiteralPath $xzExtract) {
        Remove-Item -LiteralPath $xzExtract -Recurse -Force
    }
    Expand-Archive -LiteralPath $xzZipPath -DestinationPath $xzExtract -Force
    $xzExe = Get-ChildItem -LiteralPath $xzExtract -Recurse -Filter 'xz.exe' -File |
        Where-Object { $_.DirectoryName -match 'bin_x86-64' } |
        Select-Object -First 1
    if (-not $xzExe) {
        $xzExe = Get-ChildItem -LiteralPath $xzExtract -Recurse -Filter 'xz.exe' -File | Select-Object -First 1
    }
    if (-not $xzExe) {
        throw "xz.exe not found inside xz-windows.zip."
    }
    return $xzExe.FullName
}

function Get-XzExecutable {
    $xzCmd = Get-Command xz -ErrorAction SilentlyContinue
    if ($xzCmd -and (Test-Path -LiteralPath $xzCmd.Source)) {
        return $xzCmd.Source
    }
    $pf86 = ${env:ProgramFiles(x86)}
    foreach ($dir in @(
            (Join-Path $env:ProgramFiles 'Git\usr\bin'),
            (Join-Path $pf86 'Git\usr\bin')
        )) {
        $candidate = Join-Path $dir 'xz.exe'
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }
    return $null
}

function Expand-FfmpegTarXz {
    param(
        [string] $TarXzPath,
        [string] $DestinationDir,
        [string] $ToolsRoot
    )
    $xzPath = Get-XzExecutable
    if ($xzPath) {
        $xzDir = Split-Path -Parent $xzPath
        if ($env:PATH -notlike "*${xzDir}*") {
            $env:PATH = $xzDir + [IO.Path]::PathSeparator + $env:PATH
        }
    }
    & tar.exe -xf $TarXzPath -C $DestinationDir
    if ($LASTEXITCODE -eq 0) {
        return
    }

    if (-not $xzPath) {
        $xzPath = Get-XzExecutable
    }

    if (-not $xzPath) {
        try {
            $xzPath = Get-XzFromGitHubRelease -ToolsRoot (Join-Path $ToolsRoot 'xz-portable')
        } catch {
            Write-Host "GitHub xz fallback failed: $($_.Exception.Message)"
        }
    }

    if ($xzPath) {
        $plainTar = $TarXzPath -replace '\.xz$', ''
        if (Test-Path -LiteralPath $plainTar) {
            Remove-Item -LiteralPath $plainTar -Force
        }
        Write-Host "Using xz decompressor, then tar..."
        & $xzPath -dk $TarXzPath
        if ($LASTEXITCODE -ne 0) {
            throw "xz decompression failed (exit $LASTEXITCODE)."
        }
        if (-not (Test-Path -LiteralPath $plainTar)) {
            throw "Expected tar file not found: $plainTar"
        }
        & tar.exe -xf $plainTar -C $DestinationDir
        if ($LASTEXITCODE -ne 0) {
            throw "tar extraction failed on decompressed .tar (exit $LASTEXITCODE)."
        }
        Remove-Item -LiteralPath $plainTar -Force -ErrorAction SilentlyContinue
        return
    }

    if (Expand-FfmpegTarXzWsl -TarXzPath $TarXzPath -DestinationDir $DestinationDir) {
        return
    }

    $seven = Get-7ZipExecutable
    if ($seven) {
        Write-Host "Using 7-Zip to unpack .tar.xz, then tar..."
        $plainTar = $TarXzPath -replace '\.xz$', ''
        if (Test-Path -LiteralPath $plainTar) {
            Remove-Item -LiteralPath $plainTar -Force
        }
        & $seven x $TarXzPath "-o$(Split-Path -Parent $TarXzPath)" -y | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "7-Zip extraction failed (exit $LASTEXITCODE)."
        }
        if (-not (Test-Path -LiteralPath $plainTar)) {
            throw "7-Zip did not produce: $plainTar"
        }
        & tar.exe -xf $plainTar -C $DestinationDir
        if ($LASTEXITCODE -ne 0) {
            throw "tar extraction failed on .tar from 7-Zip (exit $LASTEXITCODE)."
        }
        Remove-Item -LiteralPath $plainTar -Force -ErrorAction SilentlyContinue
        return
    }

    throw @"
Could not extract .tar.xz (Windows tar needs xz).
Tried: PATH xz, GitHub xz portable, WSL tar, 7-Zip.
Install Git for Windows (Git\usr\bin\xz.exe) or 7-Zip, then retry.
Original tar exit code: $LASTEXITCODE
"@
}

function Invoke-AwsCli {
    param([string[]] $AwsArguments)
    if ($ProfileName) {
        & aws @AwsArguments --profile $ProfileName
    } else {
        & aws @AwsArguments
    }
}

$scriptDir = $PSScriptRoot
# Build under %TEMP% (ASCII path) so Windows tar/WSL/wslpath work reliably with non-ASCII project paths.
$buildRoot = Join-Path $env:TEMP ('ffmpeg-layer-build-' + [Guid]::NewGuid().ToString('N'))
$tarPath = Join-Path $buildRoot 'ffmpeg-release-amd64-static.tar.xz'
$extractDir = Join-Path $buildRoot 'extracted'
$layerDir = Join-Path $buildRoot 'layer'
$zipPath = Join-Path $buildRoot 'ffmpeg-layer.zip'

New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
New-Item -ItemType Directory -Path $extractDir -Force | Out-Null

Write-Host "Downloading: $DownloadUrl"
$ProgressPreference = 'SilentlyContinue'
try {
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $tarPath -UseBasicParsing
} finally {
    $ProgressPreference = 'Continue'
}

Write-Host "Extracting archive..."
Expand-FfmpegTarXz -TarXzPath $tarPath -DestinationDir $extractDir -ToolsRoot $buildRoot

$ffmpegItem = Get-ChildItem -LiteralPath $extractDir -Recurse -File -Filter 'ffmpeg' -ErrorAction SilentlyContinue |
    Where-Object { $_.DirectoryName -match 'amd64-static' } |
    Select-Object -First 1
if (-not $ffmpegItem) {
    $ffmpegItem = Get-ChildItem -LiteralPath $extractDir -Recurse -File -Filter 'ffmpeg' -ErrorAction SilentlyContinue |
        Select-Object -First 1
}
if (-not $ffmpegItem) {
    throw "Could not find ffmpeg binary under $extractDir"
}

$ffmpegSrc = $ffmpegItem.FullName
$ffprobeSrc = Join-Path $ffmpegItem.DirectoryName 'ffprobe'
if (-not (Test-Path -LiteralPath $ffmpegSrc)) {
    throw "ffmpeg binary not found at $ffmpegSrc"
}

$binDir = Join-Path $layerDir 'bin'
New-Item -ItemType Directory -Path $binDir -Force | Out-Null
Copy-Item -LiteralPath $ffmpegSrc -Destination (Join-Path $binDir 'ffmpeg') -Force
if (Test-Path -LiteralPath $ffprobeSrc) {
    Copy-Item -LiteralPath $ffprobeSrc -Destination (Join-Path $binDir 'ffprobe') -Force
}

# Lambda layers mount under /opt — zip must contain bin/ffmpeg at archive root.
if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path $binDir -DestinationPath $zipPath -Force

$zipUri = 'fileb://' + ($zipPath -replace '\\', '/')

Write-Host "Publishing Lambda layer '$LayerName' to $Region ..."
$publishArgs = @(
    'lambda', 'publish-layer-version',
    '--layer-name', $LayerName,
    '--description', 'John Van Sickle FFmpeg amd64 static (/opt/bin/ffmpeg)',
    '--zip-file', $zipUri,
    '--region', $Region,
    '--output', 'json'
)
foreach ($rt in $CompatibleRuntimes) {
    $publishArgs += @('--compatible-runtimes', $rt)
}
foreach ($arch in $CompatibleArchitectures) {
    $publishArgs += @('--compatible-architectures', $arch)
}

$json = Invoke-AwsCli $publishArgs
$result = $json | ConvertFrom-Json
$arn = $result.LayerVersionArn

Write-Host ""
Write-Host "LayerVersionArn:"
Write-Host $arn

if (-not $KeepBuild) {
    Remove-Item -LiteralPath $buildRoot -Recurse -Force
}
