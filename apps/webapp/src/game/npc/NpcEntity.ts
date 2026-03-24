import * as THREE from 'three'
import { createVoxelCharacter } from '../characters/createVoxelCharacter'
import type { VoxelCharacterRig } from '../characters/types'
import type { SceneNpc } from '../story/types'

const createInteractHint = () => {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 96

  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'rgba(7, 11, 19, 0.82)'
  ctx.beginPath()
  ctx.roundRect(24, 8, canvas.width - 48, canvas.height - 16, 20)
  ctx.fill()
  ctx.strokeStyle = 'rgba(128, 196, 255, 0.52)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.roundRect(24, 8, canvas.width - 48, canvas.height - 16, 20)
  ctx.stroke()
  ctx.font = '600 38px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#cce6ff'
  ctx.fillText('Press E to talk', canvas.width / 2, canvas.height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(3.2, 0.6, 1)
  sprite.position.set(0, 2.9, 0)
  sprite.visible = false
  return sprite
}

export class NpcEntity {
  readonly data: SceneNpc
  readonly rig: VoxelCharacterRig
  readonly group: THREE.Group
  private readonly facing = new THREE.Vector3()
  private readonly hintSprite: THREE.Sprite | null

  constructor(data: SceneNpc) {
    this.data = data
    this.rig = createVoxelCharacter({
      ...data.appearance,
      name: data.name,
    })
    this.group = this.rig.group
    this.group.position.set(data.position.x, data.position.y, data.position.z)
    this.hintSprite = createInteractHint()
    if (this.hintSprite) this.group.add(this.hintSprite)
  }

  distanceTo(target: THREE.Vector3) {
    return this.group.position.distanceTo(target)
  }

  update(elapsed: number, playerPosition: THREE.Vector3) {
    this.facing.subVectors(playerPosition, this.group.position)
    this.facing.y = 0

    if (this.facing.lengthSq() > 0.0001) {
      this.group.rotation.y = Math.atan2(this.facing.x, this.facing.z)
    }

    this.rig.update(elapsed, 0.12)
  }

  setHighlighted(active: boolean) {
    this.rig.setHighlight(active)
  }

  setInteractHint(visible: boolean) {
    if (this.hintSprite) this.hintSprite.visible = visible
  }

  dispose() {
    this.rig.dispose()
    if (this.hintSprite?.material.map) this.hintSprite.material.map.dispose()
    this.hintSprite?.material.dispose()
  }
}
