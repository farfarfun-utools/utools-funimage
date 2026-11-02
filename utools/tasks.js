const path = require('node:path')

const MAX_INPUT_BYTES = 32 * 1024 * 1024
const FORMATS = { '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp', '.gif': 'gif', '.bmp': 'bmp', '.avif': 'avif', '.ico': 'ico' }
const SUFFIXES = { compress: '压缩', convert: '转换', resize: '尺寸', watermark: '水印', round: '圆角', border: '边框', pad: '留白', crop: '裁剪', rotate: '旋转', flip: '翻转', merge: '拼接', mergePdf: '合并', mergeGif: '动图', manualCrop: '手动裁剪' }
const OUTPUT_FORMATS = new Set([...Object.values(FORMATS), 'tiff', 'pdf'])

function inputFormat(name) {
  const format = FORMATS[path.extname(name).toLowerCase()]
  if (!format) throw new Error('仅支持 PNG、JPEG、WebP、GIF、BMP、AVIF 和 ICO 图片')
  return format
}

function outputName(sourceName, operation, format) {
  inputFormat(sourceName)
  if (!SUFFIXES[operation]) throw new Error('不支持的处理方式')
  if (!OUTPUT_FORMATS.has(format)) throw new Error('不支持的输出格式')
  const source = path.basename(sourceName)
  const stem = source.slice(0, -path.extname(source).length)
  return `${stem}_${SUFFIXES[operation]}.${format === 'jpeg' ? 'jpg' : format === 'tiff' ? 'tif' : format}`
}

module.exports = { MAX_INPUT_BYTES, FORMATS, inputFormat, outputName }
