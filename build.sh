#!/bin/sh
set -eu
cd "$(dirname "$0")"

npm run check
node <<'JS'
const fs = require('node:fs')
const path = require('node:path')
const plugin = JSON.parse(fs.readFileSync('utools/plugin.json', 'utf8'))
if (plugin.version !== require('./package.json').version) throw new Error('Version mismatch')
for (const name of [plugin.main, plugin.preload, plugin.logo, 'app.js', 'style.css', 'workshop.css', 'tasks.js']) {
  const file = path.join('utools', name)
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Missing ${file}`)
}
JS
