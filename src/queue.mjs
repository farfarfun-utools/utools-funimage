export function moveJob(jobs, index, step) {
  const target = index + step
  if (index < 0 || index >= jobs.length || target < 0 || target >= jobs.length) return false
  const [job] = jobs.splice(index, 1)
  jobs.splice(target, 0, job)
  return true
}
