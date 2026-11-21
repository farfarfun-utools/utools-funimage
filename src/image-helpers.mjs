export const MIME = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
  ico: 'image/x-icon',
}

export const AVIF_BRANDS = new Set(['avif', 'avis', 'mif1'])

export function formatBytes(size) {
  return size >= 1024 ** 2 ? `${(size / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`
}

export function formatOf(name) {
  const extension = name.split('.').pop().toLowerCase()
  return extension === 'jpg' || extension === 'jpeg' ? 'jpeg' : MIME[extension] ? extension : null
}

export function parseIntegerOption(rawValue, label, min, max, optional = false) {
  if (optional && rawValue === '') return null
  const parsed = Number(rawValue)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} 必须在 ${min} 至 ${max} 之间`)
  }
  return parsed
}

export function readOperationOptions(operation, getValue, getLabel = id => id, watermarkImage = null) {
  const number = (id, min, max, optional = false) => parseIntegerOption(getValue(id), getLabel(id), min, max, optional)
  switch (operation) {
    case 'compress': return { quality: number('quality', 35, 95), targetSize: number('target-size', 1, 32768, true) }
    case 'convert': return { format: getValue('format') }
    case 'resize': return { width: number('width', 1, 8000), height: number('height', 1, 8000, true) }
    case 'watermark': {
      const mode = getValue('watermark-mode')
      const options = { mode, position: getValue('watermark-position'), opacity: number('watermark-opacity', 10, 100) / 100 }
      if (mode === 'image') {
        if (!watermarkImage) throw new Error('请先选择水印图片')
        return { ...options, image: watermarkImage, imageWidth: number('watermark-image-width', 1, 2000) }
      }
      const text = getValue('watermark-text').trim()
      if (!text) throw new Error('请输入水印文字')
      return { ...options, text, size: number('watermark-size', 8, 300), color: getValue('watermark-color') }
    }
    case 'round': return { radius: number('radius', 1, 2000) }
    case 'border': return { size: number('border-size', 1, 1000), color: getValue('border-color') }
    case 'shadow': return { blur: number('shadow-blur', 0, 100), offsetX: number('shadow-x', -200, 200), offsetY: number('shadow-y', -200, 200), color: getValue('shadow-color'), opacity: number('shadow-opacity', 10, 100) / 100 }
    case 'pad': return { width: number('pad-width', 1, 8000), height: number('pad-height', 1, 8000), color: getValue('pad-color') }
    case 'crop': return { x: number('crop-x', 0, 8000), y: number('crop-y', 0, 8000), width: number('crop-width', 1, 8000), height: number('crop-height', 1, 8000) }
    case 'rotate': return { degrees: number('rotation', 90, 270) }
    case 'flip': return { axis: getValue('flip-axis') }
    case 'merge': return { direction: getValue('merge-direction'), gap: number('merge-gap', 0, 500), color: getValue('merge-color') }
    case 'mergeGif': return { delay: number('gif-delay', 20, 10000), width: number('gif-width', 1, 1200) }
    default: return {}
  }
}

export function encodeIco(pngBytes, width, height) {
  if (width > 256 || height > 256) throw new Error('ICO 图片最大为 256 × 256 像素')
  const buffer = new Uint8Array(22 + pngBytes.length)
  const view = new DataView(buffer.buffer)
  view.setUint16(2, 1, true)
  view.setUint16(4, 1, true)
  buffer[6] = width % 256
  buffer[7] = height % 256
  view.setUint16(10, 1, true)
  view.setUint16(12, 32, true)
  view.setUint32(14, pngBytes.length, true)
  view.setUint32(18, 22, true)
  buffer.set(pngBytes, 22)
  return buffer
}

export function encodeBmp(pixels, width, height) {
  if (width * height * 3 > 64 * 1024 * 1024) throw new Error('BMP 输出超过 64 MB，请先缩小图片')
  const stride = (width * 3 + 3) & ~3
  const buffer = new Uint8Array(54 + stride * height)
  const view = new DataView(buffer.buffer)
  buffer[0] = 66
  buffer[1] = 77
  view.setUint32(2, buffer.length, true)
  view.setUint32(10, 54, true)
  view.setUint32(14, 40, true)
  view.setInt32(18, width, true)
  view.setInt32(22, height, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, 24, true)
  view.setUint32(34, stride * height, true)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4
      const target = 54 + (height - y - 1) * stride + x * 3
      buffer[target] = pixels[source + 2]
      buffer[target + 1] = pixels[source + 1]
      buffer[target + 2] = pixels[source]
    }
  }
  return buffer
}

export function encodeTiff(pixels, width, height) {
  if (width * height * 3 > 64 * 1024 * 1024) throw new Error('TIFF 输出超过 64 MB，请先缩小图片')
  const tags = [
    [256, 4, 1, width],
    [257, 4, 1, height],
    [258, 3, 3, 0],
    [259, 3, 1, 1],
    [262, 3, 1, 2],
    [273, 4, 1, 0],
    [277, 3, 1, 3],
    [278, 4, 1, height],
    [279, 4, 1, width * height * 3],
    [284, 3, 1, 1],
  ]
  const bitsOffset = 8 + 2 + tags.length * 12 + 4
  const imageOffset = bitsOffset + 6
  tags[2][3] = bitsOffset
  tags[5][3] = imageOffset
  const buffer = new Uint8Array(imageOffset + width * height * 3)
  const view = new DataView(buffer.buffer)
  buffer[0] = 73
  buffer[1] = 73
  view.setUint16(2, 42, true)
  view.setUint32(4, 8, true)
  view.setUint16(8, tags.length, true)
  tags.forEach(([tag, type, count, value], index) => {
    const at = 10 + index * 12
    view.setUint16(at, tag, true)
    view.setUint16(at + 2, type, true)
    view.setUint32(at + 4, count, true)
    view.setUint32(at + 8, value, true)
  })
  for (let i = 0; i < 3; i++) view.setUint16(bitsOffset + i * 2, 8, true)
  for (let i = 0; i < width * height; i++) buffer.set(pixels.subarray(i * 4, i * 4 + 3), imageOffset + i * 3)
  return buffer
}

export function validateMagicBytes(header, sourceFormat) {
  if (sourceFormat === 'png') return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte)
  if (sourceFormat === 'jpeg') return header[0] === 255 && header[1] === 216 && header[2] === 255
  if (sourceFormat === 'webp') return String.fromCharCode(...header.slice(0, 4)) === 'RIFF' && String.fromCharCode(...header.slice(8, 12)) === 'WEBP'
  if (sourceFormat === 'gif') return String.fromCharCode(...header.slice(0, 3)) === 'GIF'
  if (sourceFormat === 'bmp') return header[0] === 66 && header[1] === 77
  if (sourceFormat === 'ico') return header[0] === 0 && header[1] === 0 && header[2] === 1 && header[3] === 0
  if (sourceFormat === 'avif') return String.fromCharCode(...header.slice(4, 8)) === 'ftyp' && AVIF_BRANDS.has(String.fromCharCode(...header.slice(8, 12)))
  return false
}

export async function compressToTargetSize(initialOutput, initialQuality, targetSizeKb, encodeAtQuality) {
  const limit = targetSizeKb * 1024
  let output = initialOutput
  let triedMin = false
  for (let q = Math.round(initialQuality * 100) - 10; output.size > limit && q >= 5; q -= 10) {
    if (q === 5) triedMin = true
    output = await encodeAtQuality(q / 100)
  }
  if (!triedMin && output.size > limit) {
    output = await encodeAtQuality(0.05)
  }
  return output
}
