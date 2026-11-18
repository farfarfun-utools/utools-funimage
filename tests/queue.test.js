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
