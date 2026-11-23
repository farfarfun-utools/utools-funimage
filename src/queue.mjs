export function moveJob(jobs, index, step) {
  const target = index + step
  if (index < 0 || index >= jobs.length || target < 0 || target >= jobs.length) return false
  const [job] = jobs.splice(index, 1)
  jobs.splice(target, 0, job)
  return true
}

export function enqueueJobs(jobs, files, maxBytes) {
  let added = 0
  let duplicates = 0
  let invalid = 0
  for (const file of files) {
    if (!file || !file.format || !Number.isFinite(file.size) || file.size <= 0 || file.size > maxBytes) {
      invalid++
      continue
    }
    if (file.path && jobs.some(job => job.path === file.path)) {
      duplicates++
      continue
    }
    jobs.push({ ...file, status: 'queued', output: '', error: '', thumbUrl: '', thumbLoading: false })
    added++
  }
  return { added, duplicates, invalid }
}

export function formatEnqueueNotice({ added, duplicates, invalid }) {
  if (added) {
    const notes = []
    if (duplicates) notes.push(`跳过 ${duplicates} 张重复`)
    if (invalid) notes.push(`忽略 ${invalid} 张无效或超限图片`)
    return { text: `已添加 ${added} 张图片${notes.length ? `（${notes.join('，')}）` : ''}`, error: false }
  }
  if (duplicates && !invalid) {
    return { text: '所选图片已在队列中', error: false }
  }
  return { text: '没有可添加的图片，请确认文件格式及大小（非空且单张不超过 32 MB）', error: true }
}
