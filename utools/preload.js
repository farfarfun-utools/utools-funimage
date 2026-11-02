const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { MAX_INPUT_BYTES, FORMATS, inputFormat, outputName } = require('./tasks')

const enterQueue = []
let enterHandler

utools.onPluginEnter(action => {
  if (action.type !== 'files' || !Array.isArray(action.payload)) return
  const paths = action.payload.filter(file => file?.isFile && typeof file.path === 'string').map(file => file.path)
  if (enterHandler) enterHandler(paths)
  else enterQueue.push(paths)
})

function checkedFile(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('请选择有效的本地图片')
  const format = inputFormat(file)
  const stat = fs.statSync(file)
  if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) throw new Error('图片必须是 32 MB 以内的文件')
  return { path: file, name: path.basename(file), size: stat.size, format }
}

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
