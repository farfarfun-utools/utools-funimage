const test = require('node:test')
const assert = require('node:assert/strict')

test('merged GIF uses the selected width and fits later frames into the first frame', async t => {
  const { drawGifFrame } = await import('../src/gif-frame.mjs')
  const context = { fillRect: t.mock.fn(), drawImage: t.mock.fn() }
  global.document = { createElement: () => ({ width: 300, height: 150, getContext: () => context }) }
  t.after(() => { delete global.document })
  const portrait = { width: 400, height: 600 }
  const canvas = drawGifFrame(portrait, 640)
  assert.deepEqual([canvas.width, canvas.height], [640, 960])
  assert.equal(context.fillStyle, '#fff')
  assert.deepEqual(context.fillRect.mock.calls[0].arguments, [0, 0, 640, 960])
  const landscape = { width: 800, height: 400 }
  assert.equal(drawGifFrame(landscape, 640, canvas), canvas)
  assert.deepEqual(context.drawImage.mock.calls[1].arguments, [landscape, 0, 320, 640, 320])
  assert.throws(() => drawGifFrame(portrait, 1000), /1200/)
})

test('drawGifFrame centers narrower frames horizontally and clamps minimum height and max boundary', async t => {
  const { drawGifFrame } = await import('../src/gif-frame.mjs')
  const context = { fillRect: t.mock.fn(), drawImage: t.mock.fn() }
  global.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) }
  t.after(() => { delete global.document })

  const wide = { width: 800, height: 400 }
  const canvas = drawGifFrame(wide, 400)
  assert.deepEqual([canvas.width, canvas.height], [400, 200])

  const tall = { width: 200, height: 400 }
  drawGifFrame(tall, 400, canvas)
  assert.deepEqual(context.drawImage.mock.calls[1].arguments, [tall, 150, 0, 100, 200])

  // Very thin strip clamps height to at least 1px.
  const thinCanvas = drawGifFrame({ width: 10000, height: 1 }, 100)
  assert.deepEqual([thinCanvas.width, thinCanvas.height], [100, 1])

  // Boundary: exact 1200px height succeeds, 1201px throws.
  const maxCanvas = drawGifFrame({ width: 400, height: 1200 }, 400)
  assert.deepEqual([maxCanvas.width, maxCanvas.height], [400, 1200])
  assert.throws(() => drawGifFrame({ width: 400, height: 1201 }, 400), /1200/)
})
