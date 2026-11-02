const test = require('node:test')
const assert = require('node:assert/strict')
const { inputFormat, outputName } = require('../utools/tasks')

test('accepts the supported input extensions, case insensitively', () => {
  assert.equal(inputFormat('photo.PNG'), 'png')
  assert.equal(inputFormat('photo.JpEg'), 'jpeg')
  assert.equal(inputFormat('photo.webp'), 'webp')
  assert.throws(() => inputFormat('photo.gif'), /仅支持/)
})

test('output names use a new file and reject unsupported options', () => {
  assert.equal(outputName('photo.jpeg', 'compress', 'jpeg'), 'photo_压缩.jpg')
  assert.equal(outputName('photo.png', 'convert', 'webp'), 'photo_转换.webp')
  assert.throws(() => outputName('photo.png', 'watermark', 'png'), /处理方式/)
  assert.throws(() => outputName('photo.png', 'convert', 'gif'), /输出格式/)
})
