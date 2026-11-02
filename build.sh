#!/bin/sh
set -eu
cd "$(dirname "$0")"

npm ci
npm run check
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
