const test = require('node:test')
const assert = require('node:assert/strict')

test('moving a queue item changes the pending export order and preserves each job', async () => {
  const { moveJob } = await import('../src/queue.mjs')
  const first = { status: 'queued', crop: { x: 20 } }
  const second = { status: 'queued' }
  const done = { status: 'done' }
  const jobs = [first, second, done]
  assert.equal(moveJob(jobs, 0, -1), false)
  assert.equal(moveJob(jobs, 2, 1), false)
  assert.equal(moveJob(jobs, 1, -1), true)
  assert.deepEqual(jobs.filter(job => job.status === 'queued'), [second, first])
  assert.equal(jobs[1], first)
  assert.equal(moveJob(jobs, 0, 1), true)
  assert.deepEqual(jobs, [first, second, done])
})

test('moveJob rejects out-of-bounds indices and handles empty, single-item, and multi-step moves', async () => {
  const { moveJob } = await import('../src/queue.mjs')
  assert.equal(moveJob([], 0, 1), false)
  assert.equal(moveJob([{ id: 1 }], 0, 1), false)
  assert.equal(moveJob([{ id: 1 }], -1, 1), false)
  assert.equal(moveJob([{ id: 1 }], 1, -1), false)

  const a = { id: 'a' }
  const b = { id: 'b' }
  const c = { id: 'c' }
  const jobs = [a, b, c]
  assert.equal(moveJob(jobs, 0, 2), true)
  assert.deepEqual(jobs, [b, c, a])
  assert.equal(moveJob(jobs, 2, -2), true)
  assert.deepEqual(jobs, [a, b, c])
  assert.equal(moveJob(jobs, 1, 0), true)
  assert.deepEqual(jobs, [a, b, c])
})

test('enqueueJobs rejects 0-byte/oversized/unsupported files, deduplicates paths, and formats clear notices', async () => {
  const { enqueueJobs, formatEnqueueNotice } = await import('../src/queue.mjs')
  const maxBytes = 1024
  const jobs = []

  const first = enqueueJobs(jobs, [
    { name: 'a.png', path: '/tmp/a.png', format: 'png', size: 100 },
    { name: 'dup.png', path: '/tmp/a.png', format: 'png', size: 100 },
    { name: 'empty.png', path: '/tmp/empty.png', format: 'png', size: 0 },
    { name: 'huge.png', path: '/tmp/huge.png', format: 'png', size: 2048 },
    { name: 'bad.txt', path: '/tmp/bad.txt', format: null, size: 100 },
  ], maxBytes)
  assert.deepEqual(first, { added: 1, duplicates: 1, invalid: 3 })
  assert.equal(jobs.length, 1)
  assert.deepEqual(formatEnqueueNotice(first), {
    text: '已添加 1 张图片（跳过 1 张重复，忽略 3 张无效或超限图片）',
    error: false,
  })

  const allDups = enqueueJobs(jobs, [{ name: 'a.png', path: '/tmp/a.png', format: 'png', size: 100 }], maxBytes)
  assert.deepEqual(allDups, { added: 0, duplicates: 1, invalid: 0 })
  assert.deepEqual(formatEnqueueNotice(allDups), { text: '所选图片已在队列中', error: false })

  const allInvalid = enqueueJobs(jobs, [{ name: 'empty.png', format: 'png', size: 0 }], maxBytes)
  assert.equal(formatEnqueueNotice(allInvalid).error, true)
})
