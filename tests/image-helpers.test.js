const test = require('node:test')
const assert = require('node:assert/strict')

function asciiBytes(text) {
  return Uint8Array.from(text, ch => ch.charCodeAt(0))
}

test('formatOf and formatBytes normalize image extensions and format readable sizes', async () => {
  const { formatOf, formatBytes } = await import('../src/image-helpers.mjs')
  assert.equal(formatOf('photo.JPG'), 'jpeg')
  assert.equal(formatOf('photo.jpeg'), 'jpeg')
  assert.equal(formatOf('photo.PNG'), 'png')
  assert.equal(formatOf('photo.webp'), 'webp')
  assert.equal(formatOf('photo.avif'), 'avif')
  assert.equal(formatOf('photo.ico'), 'ico')
  assert.equal(formatOf('photo.txt'), null)
  assert.equal(formatOf('noext'), null)

  assert.equal(formatBytes(10), '1 KB')
  assert.equal(formatBytes(2048), '2 KB')
  assert.equal(formatBytes(1024 * 1024), '1.0 MB')
  assert.equal(formatBytes(2.5 * 1024 * 1024), '2.5 MB')
})

test('validateMagicBytes verifies PNG, JPEG, WebP, GIF, BMP, ICO, and AVIF ftyp brands', async () => {
  const { validateMagicBytes } = await import('../src/image-helpers.mjs')

  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])
  const jpeg = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1])
  const webp = asciiBytes('RIFF\x24\x00\x00\x00WEBP')
  const gif = asciiBytes('GIF89a\x01\x00\x01\x00\x00\x00')
  const bmp = new Uint8Array([66, 77, 0, 0, 0, 0, 0, 0, 0, 0, 54, 0])
  const ico = new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0])
  const avif = (brand) => asciiBytes(`\x00\x00\x00\x1cftyp${brand}`)

  assert.equal(validateMagicBytes(png, 'png'), true)
  assert.equal(validateMagicBytes(jpeg, 'jpeg'), true)
  assert.equal(validateMagicBytes(webp, 'webp'), true)
  assert.equal(validateMagicBytes(gif, 'gif'), true)
  assert.equal(validateMagicBytes(bmp, 'bmp'), true)
  assert.equal(validateMagicBytes(ico, 'ico'), true)
  assert.equal(validateMagicBytes(avif('avif'), 'avif'), true)
  assert.equal(validateMagicBytes(avif('avis'), 'avif'), true)
  assert.equal(validateMagicBytes(avif('mif1'), 'avif'), true)

  // Reject mismatches, non-AVIF ISO-BMFF brands (e.g. mp42 / heic), truncated headers, and unknown formats.
  assert.equal(validateMagicBytes(png, 'jpeg'), false)
  assert.equal(validateMagicBytes(jpeg, 'png'), false)
  assert.equal(validateMagicBytes(asciiBytes('RIFF\x24\x00\x00\x00WAVE'), 'webp'), false)
  assert.equal(validateMagicBytes(avif('mp42'), 'avif'), false)
  assert.equal(validateMagicBytes(avif('heic'), 'avif'), false)
  assert.equal(validateMagicBytes(asciiBytes('\x00\x00\x00\x1cxxxxavif'), 'avif'), false)
  assert.equal(validateMagicBytes(new Uint8Array([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 'ico'), false)
  assert.equal(validateMagicBytes(new Uint8Array(0), 'png'), false)
  assert.equal(validateMagicBytes(png, 'tiff'), false)
})

test('encodeIco produces valid ICO directory header, encodes 256 as 0, and rejects oversized icons', async () => {
  const { encodeIco, validateMagicBytes } = await import('../src/image-helpers.mjs')
  const payload = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])

  const ico32 = encodeIco(payload, 32, 16)
  assert.equal(validateMagicBytes(ico32, 'ico'), true)
  const view32 = new DataView(ico32.buffer)
  assert.equal(view32.getUint16(2, true), 1)
  assert.equal(view32.getUint16(4, true), 1)
  assert.equal(ico32[6], 32)
  assert.equal(ico32[7], 16)
  assert.equal(view32.getUint16(10, true), 1)
  assert.equal(view32.getUint16(12, true), 32)
  assert.equal(view32.getUint32(14, true), payload.length)
  assert.equal(view32.getUint32(18, true), 22)
  assert.deepEqual(ico32.subarray(22), payload)

  const ico256 = encodeIco(payload, 256, 256)
  assert.equal(ico256[6], 0)
  assert.equal(ico256[7], 0)

  assert.throws(() => encodeIco(payload, 257, 32), /256/)
  assert.throws(() => encodeIco(payload, 32, 257), /256/)
})

test('encodeBmp writes 24-bit DIB header, 4-byte padded rows, and bottom-up BGR pixels', async () => {
  const { encodeBmp, validateMagicBytes } = await import('../src/image-helpers.mjs')
  // 1x2 image: top pixel red (255, 0, 0, 255), bottom pixel blue (0, 0, 255, 255)
  const pixels = new Uint8Array([
    255, 0, 0, 255,
    0, 0, 255, 255,
  ])
  const bmp = encodeBmp(pixels, 1, 2)
  assert.equal(validateMagicBytes(bmp, 'bmp'), true)
  // Row stride for width=1 is ((1*3)+3)&~3 = 4 bytes -> 54 + 4*2 = 62 bytes
  assert.equal(bmp.length, 62)
  const view = new DataView(bmp.buffer)
  assert.equal(view.getUint32(2, true), 62)
  assert.equal(view.getUint32(10, true), 54)
  assert.equal(view.getUint32(14, true), 40)
  assert.equal(view.getInt32(18, true), 1)
  assert.equal(view.getInt32(22, true), 2)
  assert.equal(view.getUint16(26, true), 1)
  assert.equal(view.getUint16(28, true), 24)
  assert.equal(view.getUint32(34, true), 8)
  // First stored row is bottom row (blue -> BGR = 255, 0, 0, pad 0)
  assert.deepEqual([...bmp.subarray(54, 58)], [255, 0, 0, 0])
  // Second stored row is top row (red -> BGR = 0, 0, 255, pad 0)
  assert.deepEqual([...bmp.subarray(58, 62)], [0, 0, 255, 0])

  assert.throws(() => encodeBmp(new Uint8Array(0), 5000, 5000), /64 MB/)
})

test('encodeTiff writes little-endian TIFF header, 10 IFD tags, BitsPerSample, and RGB pixels', async () => {
  const { encodeTiff } = await import('../src/image-helpers.mjs')
  // 2x1 RGBA pixels
  const pixels = new Uint8Array([
    10, 20, 30, 255,
    40, 50, 60, 128,
  ])
  const tiff = encodeTiff(pixels, 2, 1)
  const view = new DataView(tiff.buffer)
  assert.equal(String.fromCharCode(tiff[0], tiff[1]), 'II')
  assert.equal(view.getUint16(2, true), 42)
  assert.equal(view.getUint32(4, true), 8)
  assert.equal(view.getUint16(8, true), 10)

  const readTag = index => {
    const at = 10 + index * 12
    return [view.getUint16(at, true), view.getUint16(at + 2, true), view.getUint32(at + 4, true), view.getUint32(at + 8, true)]
  }
  assert.deepEqual(readTag(0), [256, 4, 1, 2]) // ImageWidth
  assert.deepEqual(readTag(1), [257, 4, 1, 1]) // ImageLength
  const bitsOffset = readTag(2)[3]
  const imageOffset = readTag(5)[3]
  assert.equal(bitsOffset, 134)
  assert.equal(imageOffset, 140)
  assert.deepEqual(
    [view.getUint16(bitsOffset, true), view.getUint16(bitsOffset + 2, true), view.getUint16(bitsOffset + 4, true)],
    [8, 8, 8],
  )
  assert.deepEqual([...tiff.subarray(imageOffset)], [10, 20, 30, 40, 50, 60])

  assert.throws(() => encodeTiff(new Uint8Array(0), 5000, 5000), /64 MB/)
})

test('readOperationOptions validates ranges, optional fields, and watermark modes', async () => {
  const { readOperationOptions } = await import('../src/image-helpers.mjs')
  const makeReader = values => (op, watermarkImage = null) =>
    readOperationOptions(op, id => values[id], id => `label:${id}`, watermarkImage)

  const reader = makeReader({
    quality: '80',
    'target-size': '',
    format: 'webp',
    width: '1200',
    height: '',
    'watermark-mode': 'text',
    'watermark-position': 'bottom-right',
    'watermark-opacity': '50',
    'watermark-text': '  FunImage  ',
    'watermark-size': '24',
    'watermark-color': '#ffffff',
    'watermark-image-width': '160',
    radius: '16',
    'border-size': '10',
    'border-color': '#000000',
    'shadow-blur': '12',
    'shadow-x': '-4',
    'shadow-y': '8',
    'shadow-color': '#000000',
    'shadow-opacity': '40',
    'pad-width': '1000',
    'pad-height': '800',
    'pad-color': '#ffffff',
    'crop-x': '0',
    'crop-y': '10',
    'crop-width': '400',
    'crop-height': '300',
    rotation: '90',
    'flip-axis': 'horizontal',
    'merge-direction': 'vertical',
    'merge-gap': '12',
    'merge-color': '#ffffff',
    'gif-delay': '300',
    'gif-width': '640',
  })

  assert.deepEqual(reader('compress'), { quality: 80, targetSize: null })
  assert.deepEqual(makeReader({ quality: '80', 'target-size': '250' })('compress'), { quality: 80, targetSize: 250 })
  assert.deepEqual(reader('convert'), { format: 'webp' })
  assert.deepEqual(reader('resize'), { width: 1200, height: null })
  assert.deepEqual(reader('watermark'), { mode: 'text', position: 'bottom-right', opacity: 0.5, text: 'FunImage', size: 24, color: '#ffffff' })
  assert.deepEqual(reader('round'), { radius: 16 })
  assert.deepEqual(reader('border'), { size: 10, color: '#000000' })
  assert.deepEqual(reader('shadow'), { blur: 12, offsetX: -4, offsetY: 8, color: '#000000', opacity: 0.4 })
  assert.deepEqual(reader('pad'), { width: 1000, height: 800, color: '#ffffff' })
  assert.deepEqual(reader('crop'), { x: 0, y: 10, width: 400, height: 300 })
  assert.deepEqual(reader('rotate'), { degrees: 90 })
  assert.deepEqual(reader('flip'), { axis: 'horizontal' })
  assert.deepEqual(reader('merge'), { direction: 'vertical', gap: 12, color: '#ffffff' })
  assert.deepEqual(reader('mergeGif'), { delay: 300, width: 640 })
  assert.deepEqual(reader('manualCrop'), {})

  // Image watermark mode & error branches
  const imgValues = { 'watermark-mode': 'image', 'watermark-position': 'center', 'watermark-opacity': '80', 'watermark-image-width': '200' }
  assert.throws(() => makeReader(imgValues)('watermark', null), /水印图片/)
  const fakeBlob = { size: 100 }
  assert.deepEqual(makeReader(imgValues)('watermark', fakeBlob), { mode: 'image', position: 'center', opacity: 0.8, image: fakeBlob, imageWidth: 200 })

  // Blank text watermark rejected
  assert.throws(() => makeReader({ 'watermark-mode': 'text', 'watermark-position': 'center', 'watermark-opacity': '80', 'watermark-text': '   ' })('watermark'), /水印文字/)

  // Non-integer and out-of-range values rejected with label name
  assert.throws(() => makeReader({ quality: '80.5', 'target-size': '' })('compress'), /label:quality 必须在 35 至 95 之间/)
  assert.throws(() => makeReader({ quality: '34', 'target-size': '' })('compress'), /35 至 95/)
  assert.throws(() => makeReader({ quality: '80', 'target-size': '0' })('compress'), /1 至 32768/)
})

test('compressToTargetSize steps by integer 10% decrements without drift and falls back cleanly to 0.05', async () => {
  const { compressToTargetSize } = await import('../src/image-helpers.mjs')

  // Already within target size -> no re-encoding attempts.
  const noCalls = []
  const alreadySmall = await compressToTargetSize({ size: 5000 }, 0.8, 10, async q => {
    noCalls.push(q)
    return { size: 1000 }
  })
  assert.equal(alreadySmall.size, 5000)
  assert.deepEqual(noCalls, [])

  // Starting at 0.85 steps cleanly through 0.75..0.05 without repeating 0.05.
  const stepsFrom85 = []
  const minFrom85 = await compressToTargetSize({ size: 50_000 }, 0.85, 1, async q => {
    stepsFrom85.push(q)
    return { size: 50_000 }
  })
  assert.equal(minFrom85.size, 50_000)
  assert.deepEqual(stepsFrom85, [0.75, 0.65, 0.55, 0.45, 0.35, 0.25, 0.15, 0.05])

  // Starting at 0.80 steps 0.70..0.10 then performs a final 0.05 fallback.
  const stepsFrom80 = []
  await compressToTargetSize({ size: 50_000 }, 0.8, 1, async q => {
    stepsFrom80.push(q)
    return { size: 50_000 }
  })
  assert.deepEqual(stepsFrom80, [0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.05])

  // Stops early once encoded size <= targetSize * 1024.
  const earlyCalls = []
  const earlyResult = await compressToTargetSize({ size: 30_000 }, 0.8, 10, async q => {
    earlyCalls.push(q)
    return { size: q <= 0.6 ? 9_000 : 20_000 }
  })
  assert.equal(earlyResult.size, 9_000)
  assert.deepEqual(earlyCalls, [0.7, 0.6])
})
