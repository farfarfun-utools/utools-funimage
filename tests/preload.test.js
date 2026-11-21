const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

let pasteHandler
const opened = []
const tools = new Map()
global.window = { addEventListener(name, handler) { if (name === 'paste') pasteHandler = handler } }
global.utools = {
  onPluginEnter() {},
  registerTool(name, handler) { tools.set(name, handler) },
  shellOpenPath(target) { opened.push(target); return '' },
}
require('../utools/preload')

test('AI 加入队列前校验所有图片，不触发文件处理', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'funimage-ai-'))
  try {
    const image = path.join(directory, 'photo.png')
    fs.writeFileSync(image, 'image bytes')
    const queued = []
    window.funimage.onFiles(paths => queued.push(...paths))
    const tool = tools.get('queue_images')
    assert.deepEqual(tool({ paths: [image] }).queued.map(file => file.name), ['photo.png'])
    assert.deepEqual(queued, [image])
    assert.throws(() => tool({ paths: [image, path.join(directory, 'missing.png')] }))
    assert.deepEqual(queued, [image])
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

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

test('queue_images guards null/undefined params and rejects symlinks, missing and empty files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'funimage-guard-'))
  try {
    const tool = tools.get('queue_images')
    assert.throws(() => tool(null), /1 至 100/)
    assert.throws(() => tool(undefined), /1 至 100/)

    const real = path.join(directory, 'real.png')
    fs.writeFileSync(real, 'png-bytes')
    const link = path.join(directory, 'link.png')
    fs.symlinkSync(real, link)
    assert.throws(() => window.funimage.addPaths([link]), /符号链接/)

    const empty = path.join(directory, 'empty.png')
    fs.writeFileSync(empty, '')
    assert.throws(() => window.funimage.addPaths([empty]), /非空/)

    assert.throws(() => window.funimage.addPaths(['relative.png']), /有效的本地图片/)
    assert.throws(() => window.funimage.addPaths([path.join(directory, 'gone.png')]), /不存在或无法访问/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('saveImage validates byteLength & missing outputDir, and openOutput restricts to session outputs', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'funimage-open-'))
  try {
    const arbitrary = path.join(directory, 'other.png')
    fs.writeFileSync(arbitrary, 'secret')
    assert.throws(() => window.funimage.openOutput(arbitrary), /本次处理/)

    // DataView has byteLength (not .length) — must succeed when valid.
    const view = new DataView(new Uint8Array([10, 20, 30, 40]).buffer)
    const saved = window.funimage.saveImage({ sourceName: 'photo.png', operation: 'compress', format: 'png', outputDir: directory, bytes: view })
    opened.length = 0
    window.funimage.openOutput(saved)
    assert.deepEqual(opened, [path.resolve(saved)])

    const missingDir = path.join(directory, 'deleted-dir')
    assert.throws(
      () => window.funimage.saveImage({ sourceName: 'photo.png', operation: 'compress', format: 'png', outputDir: missingDir, bytes: new Uint8Array([1]) }),
      /输出文件夹不存在/,
    )
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
