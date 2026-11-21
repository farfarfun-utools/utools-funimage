#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

command -v node >/dev/null || { echo "error: Node.js is required" >&2; exit 1; }
command -v npm >/dev/null || { echo "error: npm is required" >&2; exit 1; }

node -e '
const want = (require("./package.json").engines || {}).node || "";
const match = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(want.trim());
if (!match) {
  console.error(`error: package.json#engines.node must match >=x.y.z, got "${want}"`);
  process.exit(2);
}
const need = match.slice(1).map(Number);
const have = process.versions.node.split(".").map(Number);
const diff = need.map((n, i) => have[i] - n).find((d) => d !== 0) || 0;
if (diff < 0) {
  console.error(`error: Node ${want} is required, found ${process.versions.node}`);
  process.exit(1);
}
'

npm ci
if [ "${SKIP_CHECKS:-0}" = "1" ]; then
  echo "SKIP_CHECKS=1: skipping check"
else
  npm run check
fi
node --check utools/preload.js
node --check utools/tasks.js
npm run build
node <<'JS'
const fs = require('node:fs')
const path = require('node:path')
const plugin = JSON.parse(fs.readFileSync('utools/plugin.json', 'utf8'))
if (plugin.version !== require('./package.json').version) throw new Error('Version mismatch')
for (const name of [plugin.main, plugin.preload, plugin.logo, 'tasks.js', 'dist/logo.svg', 'dist/vendor/pdf-lib.min.js', 'dist/vendor/gifenc.js', 'dist/vendor/cropper.min.js']) {
  const file = path.join('utools', name)
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Missing ${file}`)
}
const assets = fs.readdirSync('utools/dist/assets')
if (!assets.some(name => name.endsWith('.js')) || !assets.some(name => name.endsWith('.css'))) throw new Error('Missing built JS or CSS')
JS
test ! -e utools/.git || { echo "error: utools/ 内不应存在 .git" >&2; exit 1; }
