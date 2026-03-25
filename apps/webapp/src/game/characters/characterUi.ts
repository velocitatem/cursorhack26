import * as THREE from 'three'

export const createCharacterNameplate = (
  label: string,
  positionY = 2.2,
) => {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128

  const context = canvas.getContext('2d')

  if (!context) {
    return null
  }

  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = 'rgba(9, 12, 18, 0.78)'
  context.fillRect(12, 20, canvas.width - 24, canvas.height - 40)
  context.strokeStyle = 'rgba(255, 255, 255, 0.16)'
  context.lineWidth = 4
  context.strokeRect(12, 20, canvas.width - 24, canvas.height - 40)
  context.font = '600 54px Inter, system-ui, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = '#f8fafc'
  context.fillText(label, canvas.width / 2, canvas.height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(2.8, 0.7, 1)
  sprite.position.set(0, positionY, 0)
  return sprite
}
