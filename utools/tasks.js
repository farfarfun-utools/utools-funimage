const path = require('node:path')

const MAX_INPUT_BYTES = 32 * 1024 * 1024
const FORMATS = { '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp' }
const OPERATIONS = new Set(['compress', 'convert', 'resize'])

function inputFormat(name) {
  const format = FORMATS[path.extname(name).toLowerCase()]
  if (!format) throw new Error('仅支持 PNG、JPEG 和 WebP 图片')
  return format
}

function outputName(sourceName, operation, format) {
  inputFormat(sourceName)
  if (!OPERATIONS.has(operation)) throw new Error('不支持的处理方式')
  if (!['png', 'jpeg', 'webp'].includes(format)) throw new Error('不支持的输出格式')
  const source = path.basename(sourceName)
  const stem = source.slice(0, -path.extname(source).length)
  const suffix = { compress: '压缩', convert: '转换', resize: '尺寸' }[operation]
  return `${stem}_${suffix}.${format === 'jpeg' ? 'jpg' : format}`
}

module.exports = { MAX_INPUT_BYTES, FORMATS, inputFormat, outputName }
