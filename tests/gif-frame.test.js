const test = require('node:test')
const assert = require('node:assert/strict')

test('merged GIF uses the selected width and fits later frames into the first frame', async t => {
  const { drawGifFrame } = await import('../src/gif-frame.mjs')
  const context = { fillRect() {}, drawImage: t.mock.fn() }
  global.document = { createElement: () => ({ width: 300, height: 150, getContext: () => context }) }
  t.after(() => { delete global.document })
  const portrait = { width: 400, height: 600 }
  const canvas = drawGifFrame(portrait, 640)
  assert.deepEqual([canvas.width, canvas.height], [640, 960])
  const landscape = { width: 800, height: 400 }
  assert.equal(drawGifFrame(landscape, 640, canvas), canvas)
  assert.deepEqual(context.drawImage.mock.calls[1].arguments, [landscape, 0, 320, 640, 320])
  assert.throws(() => drawGifFrame(portrait, 1000), /1200/)
})
