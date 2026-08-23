// Renders the region react-easy-crop reports (in the *source* image's own
// pixel coordinates, already accounting for zoom/pan) onto a same-size
// canvas and reads it back out as a File — the only part of "crop in the
// browser" that isn't just UI, so it's kept separate and unit-testable.
export interface PixelCrop {
  x: number
  y: number
  width: number
  height: number
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', (e) => reject(e))
    image.crossOrigin = 'anonymous'
    image.src = src
  })
}

export async function cropImageToFile(imageSrc: string, crop: PixelCrop, filename = 'avatar.png'): Promise<File> {
  const image = await loadImage(imageSrc)
  const canvas = document.createElement('canvas')
  canvas.width = crop.width
  canvas.height = crop.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable.')

  ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not encode the cropped image.')
  return new File([blob], filename, { type: 'image/png' })
}
