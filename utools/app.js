const bridge = window.funimage
const jobs = []
const mime = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon' }
const maxBytes = 32 * 1024 * 1024
const elements = Object.fromEntries([
  'add-files', 'start', 'stop', 'choose-output', 'output-label', 'options', 'quality', 'quality-value',
  'format', 'width', 'preview-meta', 'preview-empty', 'preview-image', 'show-original', 'show-result',
  'make-preview', 'file-count', 'queue-summary', 'job-list', 'clear-done', 'notice', 'drop-overlay',
  'batch-progress', 'open-settings', 'settings-dialog', 'close-settings', 'queue-empty', 'operation',
  'operation-description', 'crop-dialog', 'crop-image', 'crop-status', 'edit-crop',
].map(id => [id, document.getElementById(id)]))

let operation = 'compress'
let outputDir = ''
let selected = null
let selectedBlob = null
let originalUrl = ''
let resultUrl = ''
let showingResult = false
let previewVersion = 0
let running = false
let stopRequested = false
let cropper = null
let watermarkImage = null
const mergeOperations = new Set(['merge', 'mergePdf', 'mergeGif'])
const operationNames = { compress: '批量压缩图片', convert: '批量转换格式', resize: '批量调整尺寸', watermark: '添加文字水印', round: '应用圆角', border: '添加边框', pad: '补边留白', crop: '按坐标裁剪', manualCrop: '逐张手动裁剪', rotate: '旋转画面', flip: '翻转画面', merge: '拼接队列中的图片', mergePdf: '合并队列为 PDF', mergeGif: '合并队列为 GIF' }

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
  use.setAttribute('href', `#icon-${name}`)
  svg.append(use)
  svg.setAttribute('aria-hidden', 'true')
  return svg
}

function actionButton(iconName, title, action) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'row-action'
  button.title = title
  button.setAttribute('aria-label', title)
  button.append(icon(iconName))
  button.addEventListener('click', event => { event.stopPropagation(); action() })
  return button
}

function bytes(size) {
  return size >= 1024 ** 2 ? `${(size / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`
}

function message(text, error = false) {
  elements.notice.textContent = text
  elements.notice.classList.toggle('error', error)
}

function formatOf(name) {
  const extension = name.split('.').pop().toLowerCase()
  return extension === 'jpg' || extension === 'jpeg' ? 'jpeg' : mime[extension] ? extension : null
}

function number(id, min, max, optional = false) {
  const value = elements[id]?.value ?? document.getElementById(id).value
  if (optional && value === '') return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${document.querySelector(`label[for="${id}"]`)?.textContent || id} 必须在 ${min} 至 ${max} 之间`)
  return parsed
}

function readOptions() {
  const value = id => document.getElementById(id).value
  switch (operation) {
    case 'compress': return { quality: number('quality', 35, 95), targetSize: number('target-size', 1, 32768, true) }
    case 'convert': return { format: value('format') }
    case 'resize': return { width: number('width', 1, 8000), height: number('height', 1, 8000, true) }
    case 'watermark': {
      const mode = value('watermark-mode')
      const options = { mode, position: value('watermark-position'), opacity: number('watermark-opacity', 10, 100) / 100 }
      if (mode === 'image') {
        if (!watermarkImage) throw new Error('请先选择水印图片')
        return { ...options, image: watermarkImage, imageWidth: number('watermark-image-width', 1, 2000) }
      }
      const text = value('watermark-text').trim()
      if (!text) throw new Error('请输入水印文字')
      return { ...options, text, size: number('watermark-size', 8, 300), color: value('watermark-color') }
    }
    case 'round': return { radius: number('radius', 1, 2000) }
    case 'border': return { size: number('border-size', 1, 1000), color: value('border-color') }
    case 'pad': return { width: number('pad-width', 1, 8000), height: number('pad-height', 1, 8000), color: value('pad-color') }
    case 'crop': return { x: number('crop-x', 0, 8000), y: number('crop-y', 0, 8000), width: number('crop-width', 1, 8000), height: number('crop-height', 1, 8000) }
    case 'rotate': return { degrees: number('rotation', 90, 270) }
    case 'flip': return { axis: value('flip-axis') }
    case 'merge': return { direction: value('merge-direction'), gap: number('merge-gap', 0, 500), color: value('merge-color') }
    case 'mergeGif': return { delay: number('gif-delay', 20, 10000), width: number('gif-width', 1, 1200) }
    default: return {}
  }
}

async function sourceBlob(job) {
  if (job.file) return job.file
  return new Blob([await bridge.readFile(job.path)], { type: mime[job.format] })
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (!blob || blob.type !== type || !blob.size) reject(new Error('当前环境无法编码该图片格式'))
    else resolve(blob)
  }, type, quality))
}

function gifBlob(canvas, delay = 500, encoder = exports.GIFEncoder()) {
  const { width, height } = canvas
  const rgba = canvas.getContext('2d').getImageData(0, 0, width, height).data
  const palette = exports.quantize(rgba, 256)
  encoder.writeFrame(exports.applyPalette(rgba, palette), width, height, { palette, delay })
  return encoder
}

async function encodeCanvas(canvas, format, quality = 0.9) {
  if (['png', 'jpeg', 'webp', 'avif'].includes(format)) return canvasBlob(canvas, mime[format], quality)
  if (format === 'gif') { if (canvas.width * canvas.height > 1_440_000) throw new Error('GIF 输出最多 144 万像素，请先缩小图片'); const encoder = gifBlob(canvas); encoder.finish(); return new Blob([encoder.bytes()], { type: mime.gif }) }
  if (format === 'ico') {
    if (canvas.width > 256 || canvas.height > 256) throw new Error('ICO 图片最大为 256 × 256 像素')
    const png = new Uint8Array(await (await canvasBlob(canvas, mime.png)).arrayBuffer())
    const buffer = new Uint8Array(22 + png.length)
    const view = new DataView(buffer.buffer)
    view.setUint16(2, 1, true); view.setUint16(4, 1, true)
    buffer[6] = canvas.width % 256; buffer[7] = canvas.height % 256
    view.setUint16(10, 1, true); view.setUint16(12, 32, true)
    view.setUint32(14, png.length, true); view.setUint32(18, 22, true)
    buffer.set(png, 22)
    return new Blob([buffer], { type: mime.ico })
  }
  if (format === 'bmp') {
    const { width, height } = canvas
    if (width * height * 3 > 64 * 1024 * 1024) throw new Error('BMP 输出超过 64 MB，请先缩小图片')
    const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data
    const stride = (width * 3 + 3) & ~3
    const buffer = new Uint8Array(54 + stride * height)
    const view = new DataView(buffer.buffer)
    buffer[0] = 66; buffer[1] = 77
    view.setUint32(2, buffer.length, true); view.setUint32(10, 54, true); view.setUint32(14, 40, true)
    view.setInt32(18, width, true); view.setInt32(22, height, true); view.setUint16(26, 1, true); view.setUint16(28, 24, true)
    view.setUint32(34, stride * height, true)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4
      const target = 54 + (height - y - 1) * stride + x * 3
      buffer[target] = pixels[source + 2]; buffer[target + 1] = pixels[source + 1]; buffer[target + 2] = pixels[source]
    }
    return new Blob([buffer], { type: mime.bmp })
  }
  if (format === 'tiff') {
    const { width, height } = canvas
    if (width * height * 3 > 64 * 1024 * 1024) throw new Error('TIFF 输出超过 64 MB，请先缩小图片')
    const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data
    const tags = [[256, 4, 1, width], [257, 4, 1, height], [258, 3, 3, 0], [259, 3, 1, 1], [262, 3, 1, 2], [273, 4, 1, 0], [277, 3, 1, 3], [278, 4, 1, height], [279, 4, 1, width * height * 3], [284, 3, 1, 1]]
    const bitsOffset = 8 + 2 + tags.length * 12 + 4
    const imageOffset = bitsOffset + 6
    tags[2][3] = bitsOffset; tags[5][3] = imageOffset
    const buffer = new Uint8Array(imageOffset + width * height * 3)
    const view = new DataView(buffer.buffer)
    buffer[0] = 73; buffer[1] = 73; view.setUint16(2, 42, true); view.setUint32(4, 8, true)
    view.setUint16(8, tags.length, true)
    tags.forEach(([tag, type, count, value], index) => { const at = 10 + index * 12; view.setUint16(at, tag, true); view.setUint16(at + 2, type, true); view.setUint32(at + 4, count, true); view.setUint32(at + 8, value, true) })
    for (let i = 0; i < 3; i++) view.setUint16(bitsOffset + i * 2, 8, true)
    for (let i = 0; i < width * height; i++) buffer.set(pixels.subarray(i * 4, i * 4 + 3), imageOffset + i * 3)
    return new Blob([buffer], { type: 'image/tiff' })
  }
  throw new Error('不支持的输出格式')
}

async function processImage(source, sourceFormat, options, preview = false, crop = null) {
  const header = new Uint8Array(await source.slice(0, 12).arrayBuffer())
  let valid = false
  if (sourceFormat === 'png') valid = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte)
  else if (sourceFormat === 'jpeg') valid = header[0] === 255 && header[1] === 216 && header[2] === 255
  else if (sourceFormat === 'webp') valid = String.fromCharCode(...header.slice(0, 4)) === 'RIFF' && String.fromCharCode(...header.slice(8, 12)) === 'WEBP'
  else if (sourceFormat === 'gif') valid = String.fromCharCode(...header.slice(0, 3)) === 'GIF'
  else if (sourceFormat === 'bmp') valid = header[0] === 66 && header[1] === 77
  else if (sourceFormat === 'ico') valid = header[0] === 0 && header[1] === 0 && header[2] === 1 && header[3] === 0
  else if (sourceFormat === 'avif') valid = String.fromCharCode(...header.slice(4, 8)) === 'ftyp'
  if (!valid) throw new Error('图片内容与扩展名不符')
  const bitmap = await createImageBitmap(source)
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 32_000_000) throw new Error('图片像素超过 3200 万，暂不支持处理')
    const format = operation === 'convert' ? options.format : ['gif', 'ico'].includes(sourceFormat) ? 'png' : sourceFormat
    let width = bitmap.width
    let height = bitmap.height
    let sx = 0; let sy = 0; let sw = width; let sh = height
    if (operation === 'resize') { width = options.width; height = options.height || Math.max(1, Math.round(bitmap.height * width / bitmap.width)) }
    if (format === 'ico') { const scale = Math.min(1, 256 / Math.max(width, height)); width = Math.max(1, Math.round(width * scale)); height = Math.max(1, Math.round(height * scale)) }
    if (operation === 'crop' || operation === 'manualCrop') {
      const region = operation === 'manualCrop' ? crop : options
      if (!region) throw new Error('请先为每张图片设置手动裁剪区域')
      ;({ x: sx, y: sy, width: sw, height: sh } = region)
      if (sx < 0 || sy < 0 || sw < 1 || sh < 1 || sx + sw > bitmap.width + 0.001 || sy + sh > bitmap.height + 0.001) throw new Error('裁剪区域超出图片范围')
      width = Math.round(sw); height = Math.round(sh)
    }
    if (operation === 'rotate' && options.degrees % 180) [width, height] = [height, width]
    if (operation === 'border') { width += options.size * 2; height += options.size * 2 }
    if (operation === 'pad') { if (options.width < width || options.height < height) throw new Error('留白画布不能小于原图'); width = options.width; height = options.height }
    const fullWidth = width; const fullHeight = height
    if (preview) {
      const scale = Math.min(1, 1100 / Math.max(width, height))
      width = Math.max(1, Math.round(width * scale))
      height = Math.max(1, Math.round(height * scale))
    }
    if (width * height > 32_000_000) throw new Error('输出尺寸超过 3200 万像素')
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建图片画布')
    context.scale(width / fullWidth, height / fullHeight)
    if (['jpeg', 'bmp', 'tiff', 'gif'].includes(format) || operation === 'pad' || operation === 'border') {
      context.fillStyle = operation === 'pad' ? options.color : operation === 'border' ? options.color : '#fff'
      context.fillRect(0, 0, fullWidth, fullHeight)
    }
    const inset = operation === 'border' ? options.size : 0
    context.save()
    if (operation === 'rotate') { context.translate(fullWidth / 2, fullHeight / 2); context.rotate(options.degrees * Math.PI / 180); context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2); }
    else if (operation === 'flip') { context.translate(options.axis === 'horizontal' ? fullWidth : 0, options.axis === 'vertical' ? fullHeight : 0); context.scale(options.axis === 'horizontal' ? -1 : 1, options.axis === 'vertical' ? -1 : 1); context.drawImage(bitmap, 0, 0, fullWidth, fullHeight) }
    else {
      if (operation === 'round') { const radius = Math.min(options.radius, fullWidth / 2, fullHeight / 2); context.beginPath(); context.roundRect(0, 0, fullWidth, fullHeight, radius); context.clip() }
      const dx = operation === 'pad' ? Math.floor((fullWidth - bitmap.width) / 2) : inset
      const dy = operation === 'pad' ? Math.floor((fullHeight - bitmap.height) / 2) : inset
      const dw = operation === 'pad' ? bitmap.width : fullWidth - inset * 2
      const dh = operation === 'pad' ? bitmap.height : fullHeight - inset * 2
      context.drawImage(bitmap, sx, sy, sw, sh, dx, dy, dw, dh)
    }
    context.restore()
    if (operation === 'watermark') {
      context.save()
      context.globalAlpha = options.opacity
      if (options.mode === 'image') {
        const overlay = await createImageBitmap(options.image)
        try {
          const width = Math.min(options.imageWidth, fullWidth)
          const height = width * overlay.height / overlay.width
          const x = options.position.includes('left') ? 16 : options.position.includes('right') ? fullWidth - width - 16 : (fullWidth - width) / 2
          const y = options.position.startsWith('top') ? 16 : options.position.startsWith('bottom') ? fullHeight - height - 16 : (fullHeight - height) / 2
          context.drawImage(overlay, x, y, width, height)
        } finally { overlay.close() }
      } else {
        context.font = `600 ${options.size}px sans-serif`
        context.textBaseline = 'middle'
        context.textAlign = options.position.includes('left') ? 'left' : options.position.includes('right') ? 'right' : 'center'
        const padding = Math.max(16, options.size / 2)
        const x = options.position.includes('left') ? padding : options.position.includes('right') ? fullWidth - padding : fullWidth / 2
        const y = options.position.startsWith('top') ? padding + options.size / 2 : options.position.startsWith('bottom') ? fullHeight - padding - options.size / 2 : fullHeight / 2
        context.fillStyle = options.color
        context.fillText(options.text, x, y, fullWidth - padding * 2)
      }
      context.restore()
    }
    const quality = operation === 'compress' ? options.quality / 100 : 0.9
    let output
    try {
      output = await encodeCanvas(canvas, preview && format === 'tiff' ? 'png' : format, quality)
      if (operation === 'compress' && options.targetSize && ['jpeg', 'webp', 'avif'].includes(format)) {
        for (let q = quality - 0.1; output.size > options.targetSize * 1024 && q >= 0.05; q -= 0.1) output = await encodeCanvas(canvas, format, q)
      }
      if (operation === 'compress' && options.targetSize && output.size > options.targetSize * 1024) throw new Error('当前格式无法达到目标大小，请尝试转换为 JPEG 或 WebP')
    } finally { canvas.width = 0; canvas.height = 0 }
    // shortcut: Canvas cannot tune PNG compression; keep original bytes when recompression does not shrink it.
    return { blob: operation === 'compress' && !preview && !options.targetSize && output.size >= source.size && format === sourceFormat ? source : output, format }
  } finally {
    bitmap.close()
  }
}

async function mergeJobs(pending, options) {
  if (operation === 'mergePdf') {
    const pdf = await (window.PDFLib || exports).PDFDocument.create()
    for (const job of pending) {
      if (stopRequested) throw new Error('已停止')
      const bitmap = await createImageBitmap(await sourceBlob(job))
      try {
        if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 32_000_000) throw new Error('图片像素超过 3200 万')
        const scale = Math.min(1, 3000 / Math.max(bitmap.width, bitmap.height))
        const width = Math.max(1, Math.round(bitmap.width * scale)); const height = Math.max(1, Math.round(bitmap.height * scale))
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
        const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); context.drawImage(bitmap, 0, 0, width, height)
        const image = await pdf.embedJpg(await (await canvasBlob(canvas, mime.jpeg, 0.9)).arrayBuffer())
        canvas.width = 0; canvas.height = 0
        pdf.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height })
      } finally { bitmap.close() }
    }
    return { blob: new Blob([await pdf.save()], { type: 'application/pdf' }), format: 'pdf' }
  }
  if (operation === 'mergeGif') {
    const encoder = exports.GIFEncoder()
    const canvas = document.createElement('canvas')
    for (const job of pending) {
      if (stopRequested) throw new Error('已停止')
      const bitmap = await createImageBitmap(await sourceBlob(job))
      try {
        if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 32_000_000) throw new Error('图片像素超过 3200 万')
        if (!canvas.width) { canvas.width = options.width; canvas.height = Math.max(1, Math.round(bitmap.height * options.width / bitmap.width)); if (canvas.height > 1200) throw new Error('动图高度不能超过 1200 像素') }
        const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
        const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height)
        const width = bitmap.width * scale; const height = bitmap.height * scale
        context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
        gifBlob(canvas, options.delay, encoder)
      } finally { bitmap.close() }
    }
    encoder.finish(); canvas.width = 0; canvas.height = 0
    return { blob: new Blob([encoder.bytes()], { type: mime.gif }), format: 'gif' }
  }
  const bitmaps = []
  try {
    for (const job of pending) {
      if (stopRequested) throw new Error('已停止')
      const bitmap = await createImageBitmap(await sourceBlob(job))
      bitmaps.push(bitmap)
      if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 32_000_000) throw new Error('图片像素超过 3200 万')
      const vertical = options.direction === 'vertical'
      const width = vertical ? Math.max(...bitmaps.map(image => image.width)) : bitmaps.reduce((sum, image) => sum + image.width, 0) + options.gap * (bitmaps.length - 1)
      const height = vertical ? bitmaps.reduce((sum, image) => sum + image.height, 0) + options.gap * (bitmaps.length - 1) : Math.max(...bitmaps.map(image => image.height))
      if (width > 8000 || height > 8000 || width * height > 32_000_000) throw new Error('拼接结果超过 8000 像素或 3200 万像素')
    }
    const vertical = options.direction === 'vertical'
    const width = vertical ? Math.max(...bitmaps.map(image => image.width)) : bitmaps.reduce((sum, image) => sum + image.width, 0) + options.gap * (bitmaps.length - 1)
    const height = vertical ? bitmaps.reduce((sum, image) => sum + image.height, 0) + options.gap * (bitmaps.length - 1) : Math.max(...bitmaps.map(image => image.height))
    if (width > 8000 || height > 8000 || width * height > 32_000_000) throw new Error('拼接结果超过 8000 像素或 3200 万像素')
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
    const context = canvas.getContext('2d'); context.fillStyle = options.color; context.fillRect(0, 0, width, height)
    let offset = 0
    for (const image of bitmaps) { context.drawImage(image, vertical ? Math.floor((width - image.width) / 2) : offset, vertical ? offset : Math.floor((height - image.height) / 2)); offset += (vertical ? image.height : image.width) + options.gap }
    const blob = await encodeCanvas(canvas, 'png'); canvas.width = 0; canvas.height = 0
    return { blob, format: 'png' }
  } finally { bitmaps.forEach(image => image.close()) }
}

function showPreview(result) {
  showingResult = result && !!resultUrl
  elements['show-original'].setAttribute('aria-pressed', String(!showingResult))
  elements['show-result'].setAttribute('aria-pressed', String(showingResult))
  const url = showingResult ? resultUrl : originalUrl
  elements['preview-image'].src = url || ''
  elements['preview-image'].alt = url ? `${showingResult ? '处理效果' : '原图'}：${selected.name}` : ''
  elements['preview-image'].hidden = !url
  elements['preview-empty'].hidden = !!url
}

function clearPreview() {
  previewVersion++
  if (originalUrl) URL.revokeObjectURL(originalUrl)
  if (resultUrl) URL.revokeObjectURL(resultUrl)
  originalUrl = ''
  resultUrl = ''
  selectedBlob = null
  showPreview(false)
}

async function selectJob(job) {
  selected = job
  clearPreview()
  render()
  if (!job) { elements['preview-meta'].textContent = '选择图片查看'; return }
  elements['preview-meta'].textContent = `${job.name} · ${bytes(job.size)}`
  const version = previewVersion
  try {
    const source = await sourceBlob(job)
    if (version !== previewVersion) return
    selectedBlob = source
    originalUrl = URL.createObjectURL(source)
    showPreview(false)
    render()
  } catch (error) {
    if (version === previewVersion) message(error.message, true)
  }
}

function invalidateEffect() {
  previewVersion++
  if (resultUrl) URL.revokeObjectURL(resultUrl)
  resultUrl = ''
  showPreview(false)
  render()
}

async function makePreview() {
  if (!selectedBlob || running) return
  const version = ++previewVersion
  elements['make-preview'].disabled = true
  elements['make-preview'].textContent = '生成中…'
  try {
    const result = await processImage(selectedBlob, selected.format, readOptions(), true, selected.crop)
    if (version !== previewVersion) return
    if (resultUrl) URL.revokeObjectURL(resultUrl)
    resultUrl = URL.createObjectURL(result.blob)
    showPreview(true)
  } catch (error) {
    if (version === previewVersion) message(error.message, true)
  } finally {
    elements['make-preview'].textContent = '生成效果'
    render()
  }
}

function render() {
  elements['job-list'].replaceChildren()
  for (const job of jobs) {
    const row = document.createElement('li')
    row.className = `job status-${job.status}${job === selected ? ' selected' : ''}`
    const select = document.createElement('button')
    select.className = 'job-select'
    select.type = 'button'
    select.addEventListener('click', () => { if (job !== selected) void selectJob(job) })
    const marker = document.createElement('span')
    marker.className = 'job-marker'
    marker.append(icon(job.status === 'done' ? 'check' : 'image'))
    const info = document.createElement('span')
    info.className = 'job-info'
    const name = document.createElement('strong')
    name.textContent = job.name
    name.title = job.path || job.name
    const detail = document.createElement('small')
    const status = { queued: '待处理', running: '处理中', done: '已完成', failed: '处理失败' }[job.status]
    detail.textContent = `${bytes(job.size)} · ${status}${job.error ? ` · ${job.error}` : ''}`
    detail.title = job.error || ''
    info.append(name, detail)
    select.append(marker, info)
    const actions = document.createElement('span')
    actions.className = 'job-actions'
    if (job.status === 'done') actions.append(actionButton('external', '打开输出文件', () => void openOutput(job.output)))
    if (job.status === 'failed') actions.append(actionButton('refresh', '重试', () => { job.status = 'queued'; job.error = ''; render() }))
    if (!running) actions.append(actionButton('close', '从队列移除', () => {
      jobs.splice(jobs.indexOf(job), 1)
      if (job === selected) void selectJob(jobs[0] || null)
      else render()
    }))
    row.append(select, actions)
    elements['job-list'].append(row)
  }
  const done = jobs.filter(job => job.status === 'done').length
  const failed = jobs.filter(job => job.status === 'failed').length
  const queued = jobs.filter(job => job.status === 'queued').length
  elements['file-count'].textContent = String(jobs.length)
  elements['queue-empty'].hidden = jobs.length > 0
  elements['queue-summary'].textContent = jobs.length ? `${queued} 待处理 · ${done} 已完成${failed ? ` · ${failed} 失败` : ''}` : '等待添加图片'
  elements.start.disabled = running || !bridge || !queued
  elements['clear-done'].hidden = !done
  elements['show-original'].disabled = !originalUrl
  elements['show-result'].disabled = !resultUrl
  elements['make-preview'].disabled = !selectedBlob || running
  elements['make-preview'].hidden = mergeOperations.has(operation)
  elements['edit-crop'].disabled = !selectedBlob || running
  elements['crop-status'].textContent = selected?.crop ? '当前图片已设置裁剪区域' : '逐张选择图片并设置裁剪区域'
}

function addJobs(files) {
  let added = 0
  for (const file of files) {
    if (!file.format || file.size > maxBytes) continue
    if (file.path && jobs.some(job => job.path === file.path)) continue
    jobs.push({ ...file, status: 'queued', output: '', error: '' })
    added++
  }
  render()
  if (!selected && jobs.length) void selectJob(jobs[0])
  message(added ? `已添加 ${added} 张图片` : '没有可添加的 PNG、JPEG 或 WebP 图片（单张不超过 32 MB）', !added)
}

function addBrowserFiles(files) {
  addJobs([...files].map((file, index) => {
    const format = formatOf(file.name) || Object.keys(mime).find(key => mime[key] === file.type)
    const extension = format === 'jpeg' ? 'jpg' : format
    const name = formatOf(file.name) ? file.name : `${file.name || '粘贴图片'}_${jobs.length + index + 1}.${extension}`
    return { name, size: file.size, format, file }
  }))
}

function addPaths(paths) {
  try { addJobs(bridge.addPaths(paths)) } catch (error) { message(error.message, true) }
}

async function openOutput(file) {
  try {
    const error = await bridge.openOutput(file)
    if (error) message(error, true)
  } catch (error) { message(error.message, true) }
}

function setRunning(value) {
  running = value
  document.querySelectorAll('[data-lock]').forEach(control => { control.disabled = value })
  elements.options.disabled = value
  elements.stop.hidden = !value
  if (value) elements.stop.disabled = false
  render()
}

async function startBatch() {
  if (!bridge || running) return
  if (!outputDir) { elements['settings-dialog'].showModal(); elements['choose-output'].focus(); return }
  let options
  try { options = readOptions() } catch (error) { message(error.message, true); return }
  const pending = jobs.filter(job => job.status === 'queued')
  stopRequested = false
  setRunning(true)
  elements['batch-progress'].hidden = false
  elements['batch-progress'].max = pending.length
  elements['batch-progress'].value = 0
  let completed = 0
  if (mergeOperations.has(operation)) {
    try {
      pending.forEach(job => { job.status = 'running' }); render()
      message(`正在合并 ${pending.length} 张图片`)
      const { blob, format } = await mergeJobs(pending, options)
      if (stopRequested) throw new Error('已停止')
      const output = bridge.saveImage({ sourceName: pending[0].name, operation, format, outputDir, bytes: new Uint8Array(await blob.arrayBuffer()) })
      pending.forEach(job => { job.status = 'done'; job.output = output })
      message(`已合并 ${pending.length} 张图片`)
    } catch (error) {
      pending.forEach(job => { job.status = stopRequested ? 'queued' : 'failed'; job.error = stopRequested ? '' : error.message })
      message(error.message, true)
    }
    elements['batch-progress'].value = pending.length
    setRunning(false)
    return
  }
  for (const job of pending) {
    if (stopRequested) break
    job.status = 'running'
    render()
    message(`正在处理 ${completed + 1} / ${pending.length}：${job.name}`)
    try {
      const source = await sourceBlob(job)
      const { blob, format } = await processImage(source, job.format, options, false, job.crop)
      job.output = bridge.saveImage({ sourceName: job.name, operation, format, outputDir, bytes: new Uint8Array(await blob.arrayBuffer()) })
      job.status = 'done'
    } catch (error) {
      job.status = 'failed'
      job.error = error.message || String(error)
    }
    completed++
    elements['batch-progress'].value = completed
    render()
  }
  setRunning(false)
  message(stopRequested ? '已停止，未开始的图片仍在队列中' : `本轮完成：${completed - pending.filter(job => job.status === 'failed').length} 成功，${pending.filter(job => job.status === 'failed').length} 失败`)
}

elements.operation.addEventListener('change', () => {
  operation = elements.operation.value
  elements['operation-description'].textContent = operationNames[operation]
  document.querySelectorAll('[data-for]').forEach(group => { group.hidden = group.dataset.for !== operation })
  invalidateEffect()
})
elements.quality.addEventListener('input', () => { elements['quality-value'].value = elements.quality.value; invalidateEffect() })
elements.options.addEventListener('input', invalidateEffect)
elements.options.addEventListener('change', invalidateEffect)
document.getElementById('watermark-mode').addEventListener('change', event => {
  document.getElementById('watermark-text-options').hidden = event.target.value !== 'text'
  document.getElementById('watermark-image-options').hidden = event.target.value !== 'image'
})
document.getElementById('choose-watermark').addEventListener('click', async () => {
  if (!bridge) return
  try {
    const selectedFile = bridge.chooseOverlay()
    if (!selectedFile) return
    watermarkImage = await sourceBlob(selectedFile)
    document.getElementById('watermark-file').textContent = selectedFile.name
    document.getElementById('watermark-file').title = selectedFile.path
    invalidateEffect()
  } catch (error) { message(error.message, true) }
})
elements['edit-crop'].addEventListener('click', () => {
  if (!selectedBlob) return
  elements['crop-dialog'].showModal()
  elements['crop-image'].onload = () => {
    cropper?.destroy()
    cropper = new Cropper(elements['crop-image'], { viewMode: 1, autoCropArea: 0.8, data: selected.crop || undefined })
  }
  elements['crop-image'].src = originalUrl
})
document.getElementById('save-crop').addEventListener('click', () => {
  if (!cropper || !selected) return
  const { x, y, width, height } = cropper.getData()
  selected.crop = { x, y, width, height }
  elements['crop-dialog'].close()
  invalidateEffect()
})
document.getElementById('close-crop').addEventListener('click', () => elements['crop-dialog'].close())
elements['crop-dialog'].addEventListener('close', () => { cropper?.destroy(); cropper = null; elements['crop-image'].src = '' })
elements['make-preview'].addEventListener('click', () => void makePreview())
elements['show-original'].addEventListener('click', () => showPreview(false))
elements['show-result'].addEventListener('click', () => showPreview(true))
elements['add-files'].addEventListener('click', () => {
  try { addJobs(bridge.chooseFiles()) } catch (error) { message(error.message, true) }
})
document.querySelector('#add-empty').addEventListener('click', () => elements['add-files'].click())
elements['open-settings'].addEventListener('click', () => elements['settings-dialog'].showModal())
elements['close-settings'].addEventListener('click', () => elements['settings-dialog'].close())
elements['settings-dialog'].addEventListener('click', event => {
  const bounds = elements['settings-dialog'].getBoundingClientRect()
  if (event.target === elements['settings-dialog'] && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) elements['settings-dialog'].close()
})
elements['choose-output'].addEventListener('click', () => {
  try {
    const selectedDir = bridge.chooseOutput()
    if (selectedDir) { outputDir = selectedDir; elements['output-label'].textContent = selectedDir; elements['output-label'].title = selectedDir; render() }
  } catch (error) { message(error.message, true) }
})
elements.start.addEventListener('click', () => void startBatch())
elements.stop.addEventListener('click', () => { stopRequested = true; elements.stop.disabled = true; message('当前图片处理结束后停止') })
elements['clear-done'].addEventListener('click', () => {
  const remaining = jobs.filter(job => job.status !== 'done')
  jobs.splice(0, jobs.length, ...remaining)
  if (!jobs.includes(selected)) void selectJob(jobs[0] || null)
  else render()
})

document.addEventListener('dragover', event => {
  if (!event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  event.dataTransfer.dropEffect = running ? 'none' : 'copy'
  elements['drop-overlay'].hidden = running
})
document.addEventListener('dragleave', event => {
  if (event.clientX <= 0 || event.clientY <= 0) elements['drop-overlay'].hidden = true
})
document.addEventListener('drop', event => {
  elements['drop-overlay'].hidden = true
  if (!event.dataTransfer?.files.length) return
  event.preventDefault()
  if (running) return
  addBrowserFiles(event.dataTransfer.files)
})
document.addEventListener('paste', event => {
  const data = event.clipboardData
  if (!data || running || event.target?.closest?.('input, textarea, select, [contenteditable]')) return
  const files = data.files?.length ? [...data.files] : [...(data.items || [])].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean)
  if (!files.some(file => formatOf(file.name) || Object.values(mime).includes(file.type))) return
  event.preventDefault()
  addBrowserFiles(files)
})

if (bridge) bridge.onFiles(addPaths)
else {
  elements['add-files'].disabled = true
  document.querySelector('#add-empty').disabled = true
  message('请在 uTools 中打开插件', true)
}
render()
