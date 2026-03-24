import * as THREE from 'three'
import type { CharacterAppearance, VoxelCharacterRig } from './types'

const createPart = (
  size: THREE.Vector3Tuple,
  color: number,
  position: THREE.Vector3Tuple,
) => {
  const geometry = new THREE.BoxGeometry(...size)
  const material = new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: 0.95,
    metalness: 0.02,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(...position)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

const createNameplate = (label: string) => {
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
  sprite.position.set(0, 2.15, 0)
  return sprite
}

export const createVoxelCharacter = (
  appearance: CharacterAppearance = {},
): VoxelCharacterRig => {
  const {
    name,
    scale = 1,
    skinColor = 0xf2c9a5,
    shirtColor = 0x4f8df6,
    pantsColor = 0x24324a,
    shoeColor = 0x1b1b1f,
    accentColor = 0xd8e7ff,
  } = appearance

  const group = new THREE.Group()
  const rig = new THREE.Group()
  const label = name ? createNameplate(name) : null
  const highlightMaterials: THREE.MeshStandardMaterial[] = []
  const idleSeed = Math.random() * Math.PI * 2

  const register = (mesh: THREE.Mesh) => {
    const material = mesh.material

    if (material instanceof THREE.MeshStandardMaterial) {
      highlightMaterials.push(material)
    }
  }

  const head = createPart([0.7, 0.7, 0.7], skinColor, [0, 1.85, 0])
  const body = createPart([0.82, 0.95, 0.44], shirtColor, [0, 1.15, 0])
  const leftArm = createPart([0.26, 0.92, 0.26], accentColor, [-0.6, 1.1, 0])
  const rightArm = createPart([0.26, 0.92, 0.26], accentColor, [0.6, 1.1, 0])

  // legs use pivot groups so shoes rotate with the leg
  const legTopY = 0.95
  const leftLegPivot = new THREE.Group()
  leftLegPivot.position.set(-0.2, legTopY, 0)
  const leftLeg = createPart([0.3, 0.95, 0.3], pantsColor, [0, -0.475, 0])
  const leftShoe = createPart([0.32, 0.18, 0.4], shoeColor, [0, -0.86, 0.04])
  leftLegPivot.add(leftLeg, leftShoe)

  const rightLegPivot = new THREE.Group()
  rightLegPivot.position.set(0.2, legTopY, 0)
  const rightLeg = createPart([0.3, 0.95, 0.3], pantsColor, [0, -0.475, 0])
  const rightShoe = createPart([0.32, 0.18, 0.4], shoeColor, [0, -0.86, 0.04])
  rightLegPivot.add(rightLeg, rightShoe)

  for (const mesh of [head, body, leftArm, rightArm, leftLeg, rightLeg, leftShoe, rightShoe]) {
    register(mesh)
  }
  rig.add(head, body, leftArm, rightArm, leftLegPivot, rightLegPivot)

  if (label) {
    group.add(label)
  }

  group.add(rig)
  group.scale.setScalar(scale)

  return {
    group,
    update: (elapsed: number, movementStrength = 0) => {
      const walk = Math.min(Math.max(movementStrength, 0), 1)
      const swing = Math.sin(elapsed * 9 + idleSeed) * 0.65 * walk
      const idleBob = Math.sin(elapsed * 3 + idleSeed) * (walk > 0 ? 0.05 : 0.025)

      rig.position.y = -0.5 + idleBob
      head.rotation.y = Math.sin(elapsed * 0.75 + idleSeed) * 0.08
      leftArm.rotation.x = swing
      rightArm.rotation.x = -swing
      leftLegPivot.rotation.x = -swing
      rightLegPivot.rotation.x = swing
    },
    setHighlight: (active: boolean) => {
      for (const material of highlightMaterials) {
        material.emissive.setHex(active ? 0x2f5485 : 0x000000)
        material.emissiveIntensity = active ? 0.4 : 0
      }
    },
    dispose: () => {
      group.traverse((obj: THREE.Object3D) => {
        if (!(obj instanceof THREE.Mesh)) {
          return
        }

        obj.geometry.dispose()

        const material = obj.material
        if (material instanceof THREE.Material) {
          material.dispose()
        } else {
          for (const entry of material) {
            entry.dispose()
          }
        }
      })

      if (label?.material.map) {
        label.material.map.dispose()
      }
      label?.material.dispose()
    },
  }
}
