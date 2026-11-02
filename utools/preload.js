const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { fileURLToPath } = require('node:url')
const { MAX_INPUT_BYTES, FORMATS, inputFormat, outputName } = require('./tasks')

const enterQueue = []
let enterHandler

function deliverFiles(paths) {
  if (enterHandler) enterHandler(paths)
  else enterQueue.push(paths)
}

utools.onPluginEnter(action => {
  if (action.type !== 'files' || !Array.isArray(action.payload)) return
  const paths = action.payload.filter(file => file?.isFile && typeof file.path === 'string').map(file => file.path)
  deliverFiles(paths)
})

window.addEventListener?.('paste', event => {
  const data = event.clipboardData
  if (!data || data.files?.length || [...(data.items || [])].some(item => item.kind === 'file') || event.target?.closest?.('input, textarea, select, [contenteditable]')) return
  const text = data.getData('text/uri-list') || data.getData('text/plain')
  if (text.length > 32768) return
  const paths = text.split(/\r?\n/).filter(line => line && !line.startsWith('#')).slice(0, 100).map(line => {
    try { return line.startsWith('file://') ? fileURLToPath(line) : line }
    catch { return '' }
  }).filter(file => {
    try { checkedFile(file); return true }
    catch { return false }
  })
  if (paths.length) { event.preventDefault(); deliverFiles(paths) }
})

function checkedFile(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('请选择有效的本地图片')
  const format = inputFormat(file)
  const stat = fs.statSync(file)
  if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) throw new Error('图片必须是 32 MB 以内的文件')
  return { path: file, name: path.basename(file), size: stat.size, format }
}

utools.registerTool?.('queue_images', ({ paths }) => {
  if (!Array.isArray(paths) || !paths.length || paths.length > 100) throw new Error('请提供 1 至 100 个本地图片路径')
  const files = paths.map(checkedFile)
  deliverFiles(files.map(file => file.path))
  return { queued: files.map(({ name, size, format }) => ({ name, size, format })) }
})

function publishOutput(temporaryFile, directory, name) {
  const extension = path.extname(name)
  const stem = name.slice(0, -extension.length)
  for (let index = 1; ; index++) {
    const target = path.join(directory, index === 1 ? name : `${stem}_${index}${extension}`)
    try {
      try {
        fs.linkSync(temporaryFile, target)
      } catch (error) {
        if (!['EPERM', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV'].includes(error.code)) throw error
        fs.copyFileSync(temporaryFile, target, fs.constants.COPYFILE_EXCL)
      }
      return target
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
  }
}

window.funimage = {
  onFiles(callback) {
    enterHandler = callback
    for (const paths of enterQueue.splice(0)) callback(paths)
  },
  addPaths(paths) {
    if (!Array.isArray(paths)) throw new Error('文件列表无效')
    return paths.map(checkedFile)
  },
  chooseFiles() {
    const paths = utools.showOpenDialog({
      title: '选择图片',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: Object.keys(FORMATS).map(ext => ext.slice(1)) }],
    })
    return paths ? paths.map(checkedFile) : []
  },
  chooseOverlay() {
    const selected = utools.showOpenDialog({ title: '选择水印图片', properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })?.[0]
    return selected ? checkedFile(selected) : null
  },
  chooseOutput() {
    return utools.showOpenDialog({ title: '选择输出文件夹', properties: ['openDirectory'] })?.[0] || null
  },
  async readFile(file) {
    checkedFile(file)
    return new Uint8Array(await fs.promises.readFile(file))
  },
  saveImage({ sourceName, operation, format, outputDir, bytes }) {
    if (typeof outputDir !== 'string' || !path.isAbsolute(outputDir) || !fs.statSync(outputDir).isDirectory()) throw new Error('请选择有效的输出文件夹')
    if (!ArrayBuffer.isView(bytes) || !bytes.length || bytes.length > 64 * 1024 * 1024) throw new Error('处理结果无效或超过 64 MB')
    const name = outputName(sourceName, operation, format)
    const temporaryDir = fs.mkdtempSync(path.join(outputDir, '.funimage-'))
    try {
      const temporaryFile = path.join(temporaryDir, randomUUID())
      fs.writeFileSync(temporaryFile, bytes, { flag: 'wx' })
      return publishOutput(temporaryFile, outputDir, name)
    } finally {
      fs.rmSync(temporaryDir, { recursive: true, force: true })
    }
  },
  openOutput(file) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || !fs.statSync(file).isFile()) throw new Error('输出文件不存在')
    return utools.shellOpenPath(file)
  },
}
