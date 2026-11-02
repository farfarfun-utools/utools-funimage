const test = require('node:test')
const assert = require('node:assert/strict')
const { inputFormat, outputName } = require('../utools/tasks')

test('accepts the supported input extensions, case insensitively', () => {
  assert.equal(inputFormat('photo.PNG'), 'png')
  assert.equal(inputFormat('photo.JpEg'), 'jpeg')
  assert.equal(inputFormat('photo.webp'), 'webp')
  assert.equal(inputFormat('photo.gif'), 'gif')
  assert.equal(inputFormat('photo.AVIF'), 'avif')
  assert.throws(() => inputFormat('photo.tif'), /仅支持/)
})

test('output names use a new file and reject unsupported options', () => {
  assert.equal(outputName('photo.jpeg', 'compress', 'jpeg'), 'photo_压缩.jpg')
  assert.equal(outputName('photo.png', 'convert', 'webp'), 'photo_转换.webp')
  assert.equal(outputName('photo.png', 'watermark', 'png'), 'photo_水印.png')
  assert.equal(outputName('photo.png', 'shadow', 'png'), 'photo_阴影.png')
  assert.equal(outputName('photo.png', 'mergePdf', 'pdf'), 'photo_合并.pdf')
  assert.equal(outputName('photo.png', 'convert', 'gif'), 'photo_转换.gif')
  assert.equal(outputName('photo.png', 'convert', 'tiff'), 'photo_转换.tif')
  assert.throws(() => outputName('photo.png', 'unknown', 'png'), /处理方式/)
  assert.throws(() => outputName('photo.png', 'convert', 'exe'), /输出格式/)
})
