import { drawGifFrame } from './gif-frame.mjs'
import {
  MIME as mime,
  compressToTargetSize,
  encodeBmp,
  encodeIco,
  encodeTiff,
  formatBytes as bytes,
  formatOf,
  readOperationOptions,
  validateMagicBytes,
} from './image-helpers.mjs'
import { moveJob } from './queue.mjs'

const bridge = window.funimage
const vendorExports = window.exports
const jobs = []
const maxBytes = 32 * 1024 * 1024
const THEME_KEY = 'funimage.theme'
const elements = Object.fromEntries([
  'add-files', 'start', 'stop', 'choose-output', 'output-label', 'options', 'quality', 'quality-value',
  'format', 'width', 'preview-meta', 'preview-compare', 'preview-empty', 'preview-image', 'show-original', 'show-result',
  'make-preview', 'file-count', 'queue-summary', 'job-list', 'clear-done', 'notice', 'drop-overlay',
  'batch-progress', 'open-settings', 'settings-dialog', 'close-settings', 'operation',
  'crop-dialog', 'crop-image', 'crop-status', 'edit-crop', 'theme-toggle',
].map(id => [id, document.getElementById(id)]))

let operation = 'compress'
let outputDir = ''
let selected = null
let selectedBlob = null
let originalUrl = ''
let resultUrl = ''
let resultSize = 0
let showingResult = false
let previewVersion = 0
let running = false
let stopRequested = false
let cropper = null
let watermarkImage = null
const mergeOperations = new Set(['merge', 'mergePdf', 'mergeGif'])

const systemDarkQuery = window.matchMedia?.('(prefers-color-scheme: dark)')

function readSavedTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system'
  } catch {
    return 'system'
  }
}

let themeMode = readSavedTheme()

function applyTheme(mode) {
  themeMode = mode
  if (mode === 'light' || mode === 'dark') {
    document.documentElement.dataset.theme = mode
  } else {
    delete document.documentElement.dataset.theme
  }
  try { localStorage.setItem(THEME_KEY, mode) } catch { /* ignore storage errors */ }
  const toggle = elements['theme-toggle']
  if (!toggle) return
  const labels = { system: '跟随系统', light: '浅色主题', dark: '深色主题' }
  const icons = { system: 'monitor', light: 'sun', dark: 'moon' }
  const title = `切换外观（当前：${labels[mode]}）`
  toggle.title = title
  toggle.setAttribute('aria-label', title)
  toggle.replaceChildren(icon(icons[mode]))
}

function cycleTheme() {
  const isSystemDark = Boolean(systemDarkQuery?.matches)
  if (themeMode === 'system') applyTheme(isSystemDark ? 'light' : 'dark')
  else if ((themeMode === 'dark' && !isSystemDark) || (themeMode === 'light' && isSystemDark)) applyTheme(themeMode === 'dark' ? 'light' : 'dark')
  else applyTheme('system')
}

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

function message(text, error = false) {
  elements.notice.textContent = text
  elements.notice.classList.toggle('error', error)
}

function readOptions() {
  return readOperationOptions(
    operation,
    id => elements[id]?.value ?? document.getElementById(id).value,
    id => document.querySelector(`label[for="${id}"]`)?.textContent || id,
    watermarkImage,
  )
}

async function sourceBlob(job) {
  if (job.file) return job.file
  return new Blob([await bridge.readFile(job.path)], { type: mime[job.format] })
}

function revokeJobThumb(job) {
  if (!job?.thumbUrl) return
  URL.revokeObjectURL(job.thumbUrl)
  job.thumbUrl = ''
}

function ensureJobThumb(job) {
  if (!job || job.thumbUrl || job.thumbLoading) return
  if (job.file) {
    job.thumbUrl = URL.createObjectURL(job.file)
    return
  }
  if (!bridge) return
  job.thumbLoading = true
  sourceBlob(job).then(blob => {
    job.thumbLoading = false
    if (!jobs.includes(job)) return
    job.thumbUrl = URL.createObjectURL(blob)
    render()
  }).catch(() => {
    job.thumbLoading = false
  })
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (!blob || blob.type !== type || !blob.size) reject(new Error('当前环境无法编码该图片格式'))
    else resolve(blob)
  }, type, quality))
}

function gifBlob(canvas, delay = 500, encoder = vendorExports.GIFEncoder()) {
  const { width, height } = canvas
  const rgba = canvas.getContext('2d').getImageData(0, 0, width, height).data
  const palette = vendorExports.quantize(rgba, 256)
  encoder.writeFrame(vendorExports.applyPalette(rgba, palette), width, height, { palette, delay })
  return encoder
}

async function encodeCanvas(canvas, format, quality = 0.9) {
  if (['png', 'jpeg', 'webp', 'avif'].includes(format)) return canvasBlob(canvas, mime[format], quality)
  if (format === 'gif') { if (canvas.width * canvas.height > 1_440_000) throw new Error('GIF 输出最多 144 万像素，请先缩小图片'); const encoder = gifBlob(canvas); encoder.finish(); return new Blob([encoder.bytes()], { type: mime.gif }) }
  if (format === 'ico') {
    if (canvas.width > 256 || canvas.height > 256) throw new Error('ICO 图片最大为 256 × 256 像素')
    const png = new Uint8Array(await (await canvasBlob(canvas, mime.png)).arrayBuffer())
    return new Blob([encodeIco(png, canvas.width, canvas.height)], { type: mime.ico })
  }
  if (format === 'bmp') {
    const { width, height } = canvas
    if (width * height * 3 > 64 * 1024 * 1024) throw new Error('BMP 输出超过 64 MB，请先缩小图片')
    const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data
    return new Blob([encodeBmp(pixels, width, height)], { type: mime.bmp })
  }
  if (format === 'tiff') {
    const { width, height } = canvas
    if (width * height * 3 > 64 * 1024 * 1024) throw new Error('TIFF 输出超过 64 MB，请先缩小图片')
    const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data
    return new Blob([encodeTiff(pixels, width, height)], { type: 'image/tiff' })
  }
  throw new Error('不支持的输出格式')
}

async function assertMagicBytes(source, sourceFormat) {
  const header = new Uint8Array(await source.slice(0, 12).arrayBuffer())
  if (!validateMagicBytes(header, sourceFormat)) throw new Error('图片内容与扩展名不符')
}

async function processImage(source, sourceFormat, options, preview = false, crop = null) {
  await assertMagicBytes(source, sourceFormat)
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
    const shadowInset = operation === 'shadow' ? {
      left: options.blur * 2 + Math.max(0, -options.offsetX),
      right: options.blur * 2 + Math.max(0, options.offsetX),
      top: options.blur * 2 + Math.max(0, -options.offsetY),
      bottom: options.blur * 2 + Math.max(0, options.offsetY),
    } : null
    if (shadowInset) { width += shadowInset.left + shadowInset.right; height += shadowInset.top + shadowInset.bottom }
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
    let output
    try {
      context.scale(width / fullWidth, height / fullHeight)
      if (['jpeg', 'bmp', 'tiff', 'gif'].includes(format) || operation === 'pad') {
        context.fillStyle = operation === 'pad' ? options.color : '#fff'
        context.fillRect(0, 0, fullWidth, fullHeight)
      }
      if (operation === 'border') {
        const b = options.size
        context.fillStyle = options.color
        context.fillRect(0, 0, fullWidth, b)
        context.fillRect(0, fullHeight - b, fullWidth, b)
        context.fillRect(0, b, b, fullHeight - b * 2)
        context.fillRect(fullWidth - b, b, b, fullHeight - b * 2)
      }
      const inset = operation === 'border' ? options.size : 0
      context.save()
      if (operation === 'rotate') { context.translate(fullWidth / 2, fullHeight / 2); context.rotate(options.degrees * Math.PI / 180); context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2); }
      else if (operation === 'flip') { context.translate(options.axis === 'horizontal' ? fullWidth : 0, options.axis === 'vertical' ? fullHeight : 0); context.scale(options.axis === 'horizontal' ? -1 : 1, options.axis === 'vertical' ? -1 : 1); context.drawImage(bitmap, 0, 0, fullWidth, fullHeight) }
      else {
        if (operation === 'round') { const radius = Math.min(options.radius, fullWidth / 2, fullHeight / 2); context.beginPath(); context.roundRect(0, 0, fullWidth, fullHeight, radius); context.clip() }
        const dx = shadowInset?.left ?? (operation === 'pad' ? Math.floor((fullWidth - bitmap.width) / 2) : inset)
        const dy = shadowInset?.top ?? (operation === 'pad' ? Math.floor((fullHeight - bitmap.height) / 2) : inset)
        const dw = shadowInset || operation === 'pad' ? bitmap.width : fullWidth - inset * 2
        const dh = shadowInset || operation === 'pad' ? bitmap.height : fullHeight - inset * 2
        if (shadowInset) {
          context.shadowColor = `${options.color}${Math.round(options.opacity * 255).toString(16).padStart(2, '0')}`
          context.shadowBlur = options.blur
          context.shadowOffsetX = options.offsetX
          context.shadowOffsetY = options.offsetY
        }
        context.drawImage(bitmap, sx, sy, sw, sh, dx, dy, dw, dh)
      }
      context.restore()
      if (operation === 'watermark') {
        context.save()
        context.globalAlpha = options.opacity
        if (options.mode === 'image') {
          const ownOverlay = !options.overlayBitmap
          const overlay = options.overlayBitmap || await createImageBitmap(options.image)
          try {
            const overlayWidth = Math.min(options.imageWidth, fullWidth)
            const overlayHeight = overlayWidth * overlay.height / overlay.width
            const x = options.position.includes('left') ? 16 : options.position.includes('right') ? fullWidth - overlayWidth - 16 : (fullWidth - overlayWidth) / 2
            const y = options.position.startsWith('top') ? 16 : options.position.startsWith('bottom') ? fullHeight - overlayHeight - 16 : (fullHeight - overlayHeight) / 2
            context.drawImage(overlay, x, y, overlayWidth, overlayHeight)
          } finally { if (ownOverlay) overlay.close() }
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
      output = await encodeCanvas(canvas, preview && format === 'tiff' ? 'png' : format, quality)
      if (operation === 'compress' && options.targetSize && ['jpeg', 'webp', 'avif'].includes(format)) {
        output = await compressToTargetSize(output, quality, options.targetSize, q => encodeCanvas(canvas, format, q))
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
    const pdf = await (window.PDFLib || vendorExports).PDFDocument.create()
    for (const job of pending) {
      if (stopRequested) throw new Error('已停止')
      const source = await sourceBlob(job)
      await assertMagicBytes(source, job.format)
      const bitmap = await createImageBitmap(source)
      let width
      let height
      let canvas
      try {
        if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 32_000_000) throw new Error('图片像素超过 3200 万')
        const scale = Math.min(1, 3000 / Math.max(bitmap.width, bitmap.height))
        width = Math.max(1, Math.round(bitmap.width * scale)); height = Math.max(1, Math.round(bitmap.height * scale))
        canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
        const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); context.drawImage(bitmap, 0, 0, width, height)
      } finally { bitmap.close() }
      try {
        const image = await pdf.embedJpg(await (await canvasBlob(canvas, mime.jpeg, 0.9)).arrayBuffer())
        pdf.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height })
      } finally { canvas.width = 0; canvas.height = 0 }
    }
    return { blob: new Blob([await pdf.save()], { type: 'application/pdf' }), format: 'pdf' }
  }
  if (operation === 'mergeGif') {
    const encoder = vendorExports.GIFEncoder()
    let canvas
    try {
      for (const job of pending) {
        if (stopRequested) throw new Error('已停止')
        const source = await sourceBlob(job)
        await assertMagicBytes(source, job.format)
        const bitmap = await createImageBitmap(source)
        try {
          if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 32_000_000) throw new Error('图片像素超过 3200 万')
          canvas = drawGifFrame(bitmap, options.width, canvas)
        } finally { bitmap.close() }
        gifBlob(canvas, options.delay, encoder)
      }
      encoder.finish()
      return { blob: new Blob([encoder.bytes()], { type: mime.gif }), format: 'gif' }
    } finally {
      if (canvas) { canvas.width = 0; canvas.height = 0 }
    }
  }
  const bitmaps = []
  try {
    for (const job of pending) {
      if (stopRequested) throw new Error('已停止')
      const source = await sourceBlob(job)
      await assertMagicBytes(source, job.format)
      const bitmap = await createImageBitmap(source)
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
    try {
      const context = canvas.getContext('2d'); context.fillStyle = options.color; context.fillRect(0, 0, width, height)
      let offset = 0
      for (const image of bitmaps) {
        const imageWidth = image.width
        const imageHeight = image.height
        try {
          context.drawImage(image, vertical ? Math.floor((width - imageWidth) / 2) : offset, vertical ? offset : Math.floor((height - imageHeight) / 2))
        } finally { image.close() }
        offset += (vertical ? imageHeight : imageWidth) + options.gap
      }
      const blob = await encodeCanvas(canvas, 'png')
      return { blob, format: 'png' }
    } finally { canvas.width = 0; canvas.height = 0 }
  } finally { bitmaps.forEach(image => image.close()) }
}

function updateCompareBadge() {
  const badge = elements['preview-compare']
  if (!badge) return
  if (!resultUrl || !selected || !resultSize) {
    badge.hidden = true
    badge.textContent = ''
    badge.classList.remove('is-larger')
    return
  }
  const origSize = selectedBlob?.size || selected.size || 0
  if (!origSize) {
    badge.hidden = true
    return
  }
  const delta = Math.round(((resultSize - origSize) / origSize) * 100)
  const sign = delta > 0 ? '+' : ''
  badge.textContent = `${bytes(origSize)} → ${bytes(resultSize)} (${sign}${delta}%)`
  badge.classList.toggle('is-larger', delta > 0)
  badge.hidden = false
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
  updateCompareBadge()
}

function clearPreview() {
  previewVersion++
  if (originalUrl) URL.revokeObjectURL(originalUrl)
  if (resultUrl) URL.revokeObjectURL(resultUrl)
  originalUrl = ''
  resultUrl = ''
  resultSize = 0
  selectedBlob = null
  showPreview(false)
}

async function selectJob(job) {
  selected = job
  clearPreview()
  render()
  if (!job) { elements['preview-meta'].textContent = ''; return }
  elements['preview-meta'].textContent = `${job.name} · ${bytes(job.size)}`
  const version = previewVersion
  try {
    const source = await sourceBlob(job)
    if (version !== previewVersion) return
    selectedBlob = source
    originalUrl = URL.createObjectURL(source)
    if (!job.thumbUrl) {
      job.thumbUrl = URL.createObjectURL(source)
    }
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
  resultSize = 0
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
    resultSize = result.blob.size
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
  for (const [index, job] of jobs.entries()) {
    ensureJobThumb(job)
    const row = document.createElement('li')
    row.className = `job status-${job.status}${job === selected ? ' selected' : ''}`
    const select = document.createElement('button')
    select.className = 'job-select'
    select.type = 'button'
    select.setAttribute('aria-pressed', String(job === selected))
    select.addEventListener('click', () => { if (job !== selected) void selectJob(job) })
    const marker = document.createElement('span')
    marker.className = `job-marker${job.thumbUrl ? ' has-thumb' : ''}`
    if (job.thumbUrl) {
      const thumb = document.createElement('img')
      thumb.className = 'job-thumb'
      thumb.src = job.thumbUrl
      thumb.alt = ''
      marker.append(thumb)
      if (job.status === 'done') {
        const badge = document.createElement('span')
        badge.className = 'job-done-badge'
        badge.append(icon('check'))
        marker.append(badge)
      }
    } else {
      marker.append(icon(job.status === 'done' ? 'check' : 'image'))
    }
    const info = document.createElement('span')
    info.className = 'job-info'
    const name = document.createElement('strong')
    name.textContent = job.name
    name.title = job.path || job.name
    const metaRow = document.createElement('span')
    metaRow.className = 'job-meta-row'
    if (job.format) {
      const ext = document.createElement('span')
      ext.className = 'job-ext'
      ext.textContent = job.format === 'jpeg' ? 'JPG' : job.format.toUpperCase()
      metaRow.append(ext)
    }
    const detail = document.createElement('small')
    const status = { queued: '待处理', running: '处理中', done: '已完成', failed: '处理失败' }[job.status]
    detail.textContent = `${bytes(job.size)} · ${status}${job.error ? ` · ${job.error}` : ''}`
    detail.title = job.error || ''
    metaRow.append(detail)
    info.append(name, metaRow)
    select.append(marker, info)
    const actions = document.createElement('span')
    actions.className = 'job-actions'
    if (jobs.length > 1 && !running) {
      for (const [direction, label, step] of [['up', '上移', -1], ['down', '下移', 1]]) {
        const target = index + step
        const button = actionButton(direction, `${label} ${job.name}`, () => {
          if (running || !moveJob(jobs, index, step)) return
          render()
          const moved = elements['job-list'].children[target]
          const next = moved.querySelector(`[data-move="${direction}"]:enabled`) || moved.querySelector('[data-move]:enabled')
          next?.focus()
          message(`已将 ${job.name} 移至第 ${target + 1} 位`)
        })
        button.dataset.move = direction
        button.disabled = target < 0 || target >= jobs.length
        actions.append(button)
      }
    }
    if (job.status === 'done') actions.append(actionButton('external', '打开输出文件', () => void openOutput(job.output)))
    if (job.status === 'failed' && !running) actions.append(actionButton('refresh', '重试', () => { if (running) return; job.status = 'queued'; job.error = ''; render() }))
    if (!running) actions.append(actionButton('close', '从队列移除', () => {
      if (running) return
      revokeJobThumb(job)
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
  elements['queue-summary'].textContent = jobs.length ? `${queued} 待处理 · ${done} 已完成${failed ? ` · ${failed} 失败` : ''}` : ''
  elements.start.disabled = running || !bridge || !queued
  elements['clear-done'].hidden = !done
  elements['clear-done'].disabled = running
  elements['show-original'].disabled = !originalUrl
  elements['show-result'].disabled = !resultUrl
  elements['make-preview'].disabled = !selectedBlob || running
  elements['make-preview'].hidden = mergeOperations.has(operation)
  elements['edit-crop'].disabled = !selectedBlob || running
  elements['crop-status'].textContent = selected?.crop ? '当前图片已设置裁剪区域' : '逐张选择图片并设置裁剪区域'
}

function addJobs(files) {
  if (running) { message('正在处理图片，请等待完成后再修改队列', true); return }
  let added = 0
  for (const file of files) {
    if (!file.format || file.size > maxBytes) continue
    if (file.path && jobs.some(job => job.path === file.path)) continue
    jobs.push({ ...file, status: 'queued', output: '', error: '', thumbUrl: '', thumbLoading: false })
    added++
  }
  render()
  if (!selected && jobs.length) void selectJob(jobs[0])
  message(added ? `已添加 ${added} 张图片` : '没有可添加的图片，请确认文件格式及大小（单张不超过 32 MB）', !added)
}

function addBrowserFiles(files) {
  if (running) { message('正在处理图片，请等待完成后再修改队列', true); return }
  addJobs([...files].map((file, index) => {
    const format = formatOf(file.name) || Object.keys(mime).find(key => mime[key] === file.type)
    const extension = format === 'jpeg' ? 'jpg' : format
    const name = formatOf(file.name) ? file.name : `${file.name || '粘贴图片'}_${jobs.length + index + 1}.${extension}`
    return { name, size: file.size, format, file }
  }))
}

function addPaths(paths) {
  if (running) { message('正在处理图片，请等待完成后再修改队列', true); return }
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
  if (!pending.length) return
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
  let overlayBitmap = null
  try {
    if (operation === 'watermark' && options.mode === 'image') {
      overlayBitmap = await createImageBitmap(options.image)
      options = { ...options, overlayBitmap }
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
  } catch (error) {
    message(error.message || String(error), true)
  } finally {
    overlayBitmap?.close()
    setRunning(false)
  }
  message(stopRequested ? '已停止，未开始的图片仍在队列中' : `本轮完成：${completed - pending.filter(job => job.status === 'failed').length} 成功，${pending.filter(job => job.status === 'failed').length} 失败`)
}

elements['theme-toggle']?.addEventListener('click', cycleTheme)
applyTheme(themeMode)

elements.operation.addEventListener('change', () => {
  operation = elements.operation.value
  document.querySelectorAll('[data-for]').forEach(group => { group.hidden = group.dataset.for !== operation })
  syncToolnav()
  invalidateEffect()
})
const toolGroups = [...elements.operation.querySelectorAll('optgroup')]
const categoryRail = document.querySelector('#category-rail')
const toolList = document.querySelector('#tool-list')
toolGroups.forEach((group, index) => {
  const control = document.createElement('button')
  control.type = 'button'
  control.className = 'category-button'
  control.dataset.lock = ''
  control.append(icon(['image', 'edit', 'settings', 'folder'][index]), document.createTextNode(group.label))
  control.addEventListener('click', () => {
    elements.operation.value = group.querySelector('option').value
    elements.operation.dispatchEvent(new Event('change'))
  })
  categoryRail.append(control)
})
function syncToolnav() {
  const index = toolGroups.findIndex(group => [...group.querySelectorAll('option')].some(option => option.value === operation))
  categoryRail.querySelectorAll('button').forEach((control, groupIndex) => {
    control.classList.toggle('active', groupIndex === index)
    control.setAttribute('aria-pressed', String(groupIndex === index))
  })
  if (toolList.dataset.group !== String(index)) {
    toolList.dataset.group = String(index)
    toolList.replaceChildren()
    for (const option of toolGroups[index].querySelectorAll('option')) {
      const control = document.createElement('button')
      control.type = 'button'
      control.className = 'tool-button'
      control.dataset.lock = ''
      control.dataset.operation = option.value
      control.textContent = option.textContent
      control.addEventListener('click', () => {
        elements.operation.value = option.value
        elements.operation.dispatchEvent(new Event('change'))
      })
      toolList.append(control)
    }
  }
  toolList.querySelectorAll('button').forEach(control => {
    const active = control.dataset.operation === operation
    control.classList.toggle('active', active)
    control.setAttribute('aria-pressed', String(active))
  })
  document.querySelector('.settings-heading h2').textContent = `${elements.operation.selectedOptions[0].textContent}参数`
}
syncToolnav()
elements.quality.addEventListener('input', () => { elements['quality-value'].value = elements.quality.value; invalidateEffect() })
document.getElementById('watermark-opacity')?.addEventListener('input', event => {
  const out = document.getElementById('watermark-opacity-value')
  if (out) out.value = `${event.target.value}%`
})
document.getElementById('shadow-opacity')?.addEventListener('input', event => {
  const out = document.getElementById('shadow-opacity-value')
  if (out) out.value = `${event.target.value}%`
})
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
  if (running) return
  try { addJobs(bridge.chooseFiles()) } catch (error) { message(error.message, true) }
})
document.querySelector('#add-empty').addEventListener('click', () => elements['add-files'].click())
elements['open-settings'].addEventListener('click', () => elements['settings-dialog'].showModal())
document.getElementById('output-settings').addEventListener('click', () => elements['open-settings'].click())
elements['close-settings'].addEventListener('click', () => elements['settings-dialog'].close())
elements['settings-dialog'].addEventListener('click', event => {
  const bounds = elements['settings-dialog'].getBoundingClientRect()
  if (event.target === elements['settings-dialog'] && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) elements['settings-dialog'].close()
})
elements['choose-output'].addEventListener('click', () => {
  try {
    const selectedDir = bridge.chooseOutput()
    if (selectedDir) { outputDir = selectedDir; elements['output-label'].textContent = selectedDir; elements['output-label'].title = selectedDir; document.querySelector('#footer-output').textContent = selectedDir; render() }
  } catch (error) { message(error.message, true) }
})
elements.start.addEventListener('click', () => void startBatch())
elements.stop.addEventListener('click', () => { stopRequested = true; elements.stop.disabled = true; message('当前图片处理结束后停止') })
elements['clear-done'].addEventListener('click', () => {
  if (running) return
  const remaining = []
  for (const job of jobs) {
    if (job.status === 'done') revokeJobThumb(job)
    else remaining.push(job)
  }
  jobs.splice(0, jobs.length, ...remaining)
  if (!jobs.includes(selected)) void selectJob(jobs[0] || null)
  else render()
})

window.addEventListener('beforeunload', () => {
  clearPreview()
  for (const job of jobs) revokeJobThumb(job)
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
