const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { fileURLToPath } = require('node:url')
const { MAX_INPUT_BYTES, FORMATS, inputFormat, outputName } = require('./tasks')

const enterQueue = []
let enterHandler
const sessionOutputs = new Set()
const MAX_OUTPUT_ATTEMPTS = 10000

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
  const resolved = path.resolve(file)
  const format = inputFormat(resolved)
  let stat
  try {
    stat = fs.lstatSync(resolved)
  } catch {
    throw new Error('图片文件不存在或无法访问')
  }
  if (stat.isSymbolicLink()) throw new Error('不支持符号链接文件')
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_INPUT_BYTES) throw new Error('图片必须是 32 MB 以内的非空文件')
  return { path: resolved, name: path.basename(resolved), size: stat.size, format }
}

utools.registerTool?.('queue_images', params => {
  const paths = params?.paths
  if (!Array.isArray(paths) || !paths.length || paths.length > 100) throw new Error('请提供 1 至 100 个本地图片路径')
  const files = paths.map(checkedFile)
  deliverFiles(files.map(file => file.path))
  return { queued: files.map(({ name, size, format }) => ({ name, size, format })) }
})

function publishOutput(temporaryFile, directory, name) {
  const extension = path.extname(name)
  const stem = name.slice(0, -extension.length)
  for (let index = 1; index <= MAX_OUTPUT_ATTEMPTS; index++) {
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
  throw new Error('输出目录中同名文件过多，请更换输出文件夹')
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
    const checked = checkedFile(file)
    return new Uint8Array(await fs.promises.readFile(checked.path))
  },
  saveImage({ sourceName, operation, format, outputDir, bytes }) {
    if (typeof outputDir !== 'string' || !path.isAbsolute(outputDir)) throw new Error('请选择有效的输出文件夹')
    const resolvedDir = path.resolve(outputDir)
    let dirStat
    try {
      dirStat = fs.statSync(resolvedDir)
    } catch {
      throw new Error('输出文件夹不存在或无法访问，请重新选择')
    }
    if (!dirStat.isDirectory()) throw new Error('请选择有效的输出文件夹')
    if (!ArrayBuffer.isView(bytes) || !bytes.byteLength || bytes.byteLength > 64 * 1024 * 1024) throw new Error('处理结果无效或超过 64 MB')
    const name = outputName(sourceName, operation, format)
    const temporaryDir = fs.mkdtempSync(path.join(resolvedDir, '.funimage-'))
    try {
      const temporaryFile = path.join(temporaryDir, randomUUID())
      fs.writeFileSync(temporaryFile, bytes, { flag: 'wx' })
      const saved = publishOutput(temporaryFile, resolvedDir, name)
      sessionOutputs.add(path.resolve(saved))
      return saved
    } finally {
      fs.rmSync(temporaryDir, { recursive: true, force: true })
    }
  },
  openOutput(file) {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('输出文件不存在')
    const resolved = path.resolve(file)
    if (!sessionOutputs.has(resolved)) throw new Error('仅支持打开本次处理的输出文件')
    let stat
    try {
      stat = fs.lstatSync(resolved)
    } catch {
      throw new Error('输出文件不存在')
    }
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('输出文件不存在')
    return utools.shellOpenPath(resolved)
  },
}
