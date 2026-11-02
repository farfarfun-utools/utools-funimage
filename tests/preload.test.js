const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

let pasteHandler
global.window = { addEventListener(name, handler) { if (name === 'paste') pasteHandler = handler } }
global.utools = { onPluginEnter() {} }
require('../utools/preload')

test('pasted local image paths join the queue without intercepting editable fields', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'funimage-paste-'))
  try {
    const image = path.join(directory, 'photo.png')
    fs.writeFileSync(image, 'image bytes')
    const received = []
    window.funimage.onFiles(paths => received.push(...paths))
    const event = editable => ({
      clipboardData: { files: [], items: [], getData: () => image },
      target: { closest: () => editable ? {} : null },
      preventDefault() { this.prevented = true },
    })
    const inputPaste = event(true)
    pasteHandler(inputPaste)
    assert.equal(inputPaste.prevented, undefined)
    const pagePaste = event(false)
    pasteHandler(pagePaste)
    assert.equal(pagePaste.prevented, true)
    assert.deepEqual(received, [image])
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('saves new files without overwriting existing images or prior outputs', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'funimage-test-'))
  try {
    fs.writeFileSync(path.join(directory, 'photo.png'), 'original')
    const job = { sourceName: 'photo.png', operation: 'compress', format: 'png', outputDir: directory, bytes: new Uint8Array([1, 2, 3]) }
    const first = window.funimage.saveImage(job)
    const second = window.funimage.saveImage(job)
    assert.equal(path.basename(first), 'photo_压缩.png')
    assert.equal(path.basename(second), 'photo_压缩_2.png')
    assert.equal(fs.readFileSync(path.join(directory, 'photo.png'), 'utf8'), 'original')
    assert.deepEqual([...fs.readFileSync(first)], [1, 2, 3])
    assert.deepEqual([...fs.readFileSync(second)], [1, 2, 3])
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
