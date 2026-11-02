const bridge = window.funimage
const jobs = []
const mime = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }
const maxBytes = 32 * 1024 * 1024
const elements = Object.fromEntries([
  'add-files', 'start', 'stop', 'choose-output', 'output-label', 'options', 'quality', 'quality-value',
  'format', 'width', 'preview-meta', 'preview-empty', 'preview-image', 'show-original', 'show-result',
  'make-preview', 'file-count', 'queue-summary', 'job-list', 'clear-done', 'notice', 'drop-overlay',
  'batch-progress',
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
  return extension === 'jpg' || extension === 'jpeg' ? 'jpeg' : extension === 'png' || extension === 'webp' ? extension : null
}

function readOptions() {
  if (operation === 'compress') {
    const quality = Number(elements.quality.value)
    if (!Number.isInteger(quality) || quality < 35 || quality > 95) throw new Error('压缩质量无效')
    return { quality }
  }
  if (operation === 'convert') {
    if (!mime[elements.format.value]) throw new Error('不支持的输出格式')
    return { format: elements.format.value }
  }
  const width = Number(elements.width.value)
  if (!Number.isInteger(width) || width < 1 || width > 8000) throw new Error('宽度必须是 1 至 8000 像素')
  return { width }
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

async function processImage(source, sourceFormat, options, preview = false) {
  const bitmap = await createImageBitmap(source)
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 32_000_000) throw new Error('图片像素超过 3200 万，暂不支持处理')
    const format = operation === 'convert' ? options.format : sourceFormat
    let width = operation === 'resize' ? options.width : bitmap.width
    let height = Math.max(1, Math.round(bitmap.height * width / bitmap.width))
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
    if (format === 'jpeg') {
      context.fillStyle = '#fff'
      context.fillRect(0, 0, width, height)
    }
    context.drawImage(bitmap, 0, 0, width, height)
    const quality = operation === 'compress' ? options.quality / 100 : 0.9
    const output = await canvasBlob(canvas, mime[format], quality)
    // shortcut: Canvas cannot tune PNG compression; keep original bytes when recompression does not shrink it.
    return { blob: operation === 'compress' && !preview && output.size >= source.size ? source : output, format }
  } finally {
    bitmap.close()
  }
}

function showPreview(result) {
  showingResult = result && !!resultUrl
  elements['show-original'].setAttribute('aria-pressed', String(!showingResult))
  elements['show-result'].setAttribute('aria-pressed', String(showingResult))
  const url = showingResult ? resultUrl : originalUrl
  elements['preview-image'].src = url || ''
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
    const result = await processImage(selectedBlob, selected.format, readOptions(), true)
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
  elements['queue-summary'].textContent = jobs.length ? `${queued} 待处理 · ${done} 已完成${failed ? ` · ${failed} 失败` : ''}` : '等待添加图片'
  elements.start.disabled = running || !bridge || !queued || !outputDir
  elements['clear-done'].hidden = !done
  elements['show-original'].disabled = !originalUrl
  elements['show-result'].disabled = !resultUrl
  elements['make-preview'].disabled = !selectedBlob || running
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
  render()
}

async function startBatch() {
  if (!bridge || running || !outputDir) return
  let options
  try { options = readOptions() } catch (error) { message(error.message, true); return }
  const pending = jobs.filter(job => job.status === 'queued')
  stopRequested = false
  setRunning(true)
  elements['batch-progress'].hidden = false
  elements['batch-progress'].max = pending.length
  elements['batch-progress'].value = 0
  let completed = 0
  for (const job of pending) {
    if (stopRequested) break
    job.status = 'running'
    render()
    message(`正在处理 ${completed + 1} / ${pending.length}：${job.name}`)
    try {
      const source = await sourceBlob(job)
      const { blob, format } = await processImage(source, job.format, options)
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

document.querySelectorAll('[data-operation]').forEach(control => control.addEventListener('click', () => {
  operation = control.dataset.operation
  document.querySelectorAll('[data-operation]').forEach(item => item.setAttribute('aria-pressed', String(item === control)))
  document.querySelectorAll('[data-for]').forEach(group => { group.hidden = group.dataset.for !== operation })
  invalidateEffect()
}))
elements.quality.addEventListener('input', () => { elements['quality-value'].value = elements.quality.value; invalidateEffect() })
elements.format.addEventListener('change', invalidateEffect)
elements.width.addEventListener('input', invalidateEffect)
elements['make-preview'].addEventListener('click', () => void makePreview())
elements['show-original'].addEventListener('click', () => showPreview(false))
elements['show-result'].addEventListener('click', () => showPreview(true))
elements['add-files'].addEventListener('click', () => {
  try { addJobs(bridge.chooseFiles()) } catch (error) { message(error.message, true) }
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
  addJobs([...event.dataTransfer.files].map(file => ({ name: file.name, size: file.size, format: formatOf(file.name), file })))
})

if (bridge) bridge.onFiles(addPaths)
else message('请在 uTools 中打开插件', true)
render()
