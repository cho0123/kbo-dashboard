/**
 * AWS Lambda용 FFmpeg 레이어 zip(ffmpeg-layer.zip)을 만듭니다.
 * 압축 루트에 `bin/ffmpeg`가 있어 런타임에서 `/opt/bin/ffmpeg`로 마운트됩니다.
 *
 * -- 수동(Windows)으로 zip 만들기 (Node 없이) --
 * 1) 브라우저에서 John Van Sickle amd64 static 빌드 다운로드:
 *    https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
 * 2) 7-Zip으로 `.tar.xz` 를 연 뒤, 안의 `.tar` 만 꺼내서 저장합니다.
 * 3) 그 `.tar` 를 다시 7-Zip으로 열어 `ffmpeg-*-amd64-static` 폴더를 풉니다.
 * 4) 새 폴더 `layer` 를 만들고 그 안에 `bin` 을 만든 뒤, 풀린 폴더의 `ffmpeg`·`ffprobe` 를
 *    `layer\bin\` 으로 복사합니다. (이름은 `ffmpeg`, `ffprobe` 그대로, 확장자 없음)
 * 5) `bin` 폴더를 선택 → 7-Zip → "zip"으로 `ffmpeg-layer.zip` 생성
 *    (zip 안 최상위에 `bin\ffmpeg` 가 보이면 올바른 구조입니다.)
 *
 * -- AWS 콘솔에서 레이어 등록 --
 * 1) AWS Console → Lambda → Layers → Create layer
 * 2) Name: 예) ffmpeg-static
 * 3) "Upload a .zip file" → 위에서 만든 `ffmpeg-layer.zip` 선택
 * 4) Compatible architectures: x86_64
 * 5) Compatible runtimes: 함수에 쓰는 Node.js 버전(예: Node.js 22.x) 등 선택
 * 6) Create → 표시되는 Layer version ARN을 함수 설정의 Layers에 추가
 */

import archiver from 'archiver'
import sevenBin from '7zip-bin'
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const DEFAULT_URL =
  'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function parseArgv(argv) {
  const out = {
    url: DEFAULT_URL,
    outZip: path.join(__dirname, 'ffmpeg-layer.zip'),
    keepTemp: false,
  }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out' && argv[i + 1]) {
      out.outZip = path.resolve(argv[++i])
    } else if (a === '--url' && argv[i + 1]) {
      out.url = argv[++i]
    } else if (a === '--keep-temp') {
      out.keepTemp = true
    } else if (a === '--help' || a === '-h') {
      out.help = true
    }
  }
  return out
}

async function downloadFile(url, destPath) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText} (${url})`)
  }
  if (!res.body) {
    throw new Error('Response has no body')
  }
  await pipeline(res.body, createWriteStream(destPath))
}

function run7z(args) {
  const seven = sevenBin.path7za
  if (!existsSync(seven)) {
    throw new Error(`7za not found at ${seven} (7zip-bin package broken?)`)
  }
  execFileSync(seven, args, { stdio: 'inherit' })
}

/**
 * @param {string} dir
 * @param {string} baseName  e.g. "ffmpeg"
 * @returns {Promise<string | null>}
 */
async function findBinaryPath(dir, baseName) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      const sub = await findBinaryPath(p, baseName)
      if (sub) {
        return sub
      }
    } else if (e.name === baseName) {
      return p
    }
  }
  return null
}

/**
 * @param {string} workDir
 * @param {string} tarXzPath
 * @param {string} extractDir
 */
function extractArchive(workDir, tarXzPath, extractDir) {
  console.log('Extracting .tar.xz (7za)…')
  run7z(['x', tarXzPath, `-o${workDir}`, '-y'])

  const expectedTar = path.join(workDir, path.basename(tarXzPath).replace(/\.xz$/i, ''))
  let tarFile = expectedTar
  if (!existsSync(expectedTar)) {
    const tars = readdirSync(workDir).filter((f) => f.endsWith('.tar'))
    if (tars.length !== 1) {
      throw new Error(
        `Expected exactly one .tar in ${workDir}; got: ${tars.length ? tars.join(', ') : 'none'}`,
      )
    }
    tarFile = path.join(workDir, tars[0])
  }

  mkdirSync(extractDir, { recursive: true })
  console.log('Extracting .tar (7za)…')
  run7z(['x', tarFile, `-o${extractDir}`, '-y'])
}

/**
 * @param {string} ffmpegPath
 * @param {string | null} ffprobePath
 * @param {string} zipPath
 */
function buildZip(ffmpegPath, ffprobePath, zipPath) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath)
    const archive = archiver('zip', { zlib: { level: 9 } })
    output.on('close', () => {
      console.log(`Wrote ${zipPath} (${archive.pointer()} bytes)`)
      resolve()
    })
    archive.on('error', reject)
    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        console.warn('archiver warning:', err)
      } else {
        reject(err)
      }
    })
    archive.pipe(output)
    archive.file(ffmpegPath, { name: 'bin/ffmpeg' })
    if (ffprobePath && existsSync(ffprobePath)) {
      archive.file(ffprobePath, { name: 'bin/ffprobe' })
    }
    archive.finalize()
  })
}

async function main() {
  const opts = parseArgv(process.argv)
  if (opts.help) {
    console.log(`Usage: node prepare-ffmpeg-layer.mjs [options]

  --out <path>     Output zip (default: ./ffmpeg-layer.zip next to this script)
  --url <url>      Source .tar.xz (default: John Van Sickle release amd64)
  --keep-temp      Keep temp build directory and print its path
`)
    process.exit(0)
  }

  const workDir = mkdtempSync(path.join(tmpdir(), 'ffmpeg-layer-'))
  const tarXzName = 'ffmpeg-release-amd64-static.tar.xz'
  const tarXzPath = path.join(workDir, tarXzName)
  const extractDir = path.join(workDir, 'extracted')

  try {
    console.log(`Download: ${opts.url}`)
    await downloadFile(opts.url, tarXzPath)

    extractArchive(workDir, tarXzPath, extractDir)

    const ffmpegPath = await findBinaryPath(extractDir, 'ffmpeg')
    if (!ffmpegPath) {
      throw new Error(
        `Could not find "ffmpeg" binary under ${extractDir} (check archive layout).`,
      )
    }
    const probePath = path.join(path.dirname(ffmpegPath), 'ffprobe')
    const ffprobePath = existsSync(probePath) ? probePath : null

    await buildZip(ffmpegPath, ffprobePath, opts.outZip)

    console.log('')
    console.log('Next: AWS Console → Lambda → Layers → Create layer → Upload', opts.outZip)
    console.log('      Architecture: x86_64 — Runtimes: match your function.')
    if (opts.keepTemp) {
      console.log('Temp dir kept:', workDir)
    }
  } finally {
    if (!opts.keepTemp) {
      try {
        rmSync(workDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
