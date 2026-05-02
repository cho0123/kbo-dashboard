#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

npm install --omit=dev

ZIP_PATH="$ROOT/../kbo-video-encoder.zip"
rm -f "$ZIP_PATH"

zip -qr "$ZIP_PATH" index.mjs package.json package-lock.json node_modules

echo "Zip: $ZIP_PATH ($(du -h "$ZIP_PATH" | cut -f1))"

aws lambda update-function-code \
  --region ap-northeast-2 \
  --function-name kbo-video-encoder \
  --zip-file "fileb://$ZIP_PATH"

echo "Deployed kbo-video-encoder (ap-northeast-2)."
