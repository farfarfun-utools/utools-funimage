export function drawGifFrame(bitmap, outputWidth, canvas) {
  if (!canvas) {
    const height = Math.max(1, Math.round(bitmap.height * outputWidth / bitmap.width))
    if (height > 1200) throw new Error('动图高度不能超过 1200 像素')
    canvas = document.createElement('canvas')
    canvas.width = outputWidth
    canvas.height = height
  }
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height)
  const width = bitmap.width * scale
  const height = bitmap.height * scale
  context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
  return canvas
}
