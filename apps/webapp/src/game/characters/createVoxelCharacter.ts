import * as THREE from 'three'
import type { CharacterAppearance, CharacterAnimationState, CharacterRig } from './types'

const walkLikeStates = new Set<CharacterAnimationState>([
  'moveStart',
  'moveLoop',
  'turnLeft',
  'turnRight',
  'turnAround',
])

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

export const createVoxelCharacter = (
  appearance: CharacterAppearance = {},
): CharacterRig => {
  const {
    scale = 1,
    skinColor = 0xf2c9a5,
    shirtColor = 0x4f8df6,
    pantsColor = 0x24324a,
    shoeColor = 0x1b1b1f,
    accentColor = 0xd8e7ff,
  } = appearance

  const group = new THREE.Group()
  const rig = new THREE.Group()
  const highlightMaterials: THREE.MeshStandardMaterial[] = []
  const idleSeed = Math.random() * Math.PI * 2
  let animationState: CharacterAnimationState = 'idle'

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
  group.add(rig)
  group.scale.setScalar(scale)

  return {
    group,
    update: (_delta: number, elapsed: number) => {
      const idleBob = Math.sin(elapsed * 3 + idleSeed) * 0.025
      const talkSwing = Math.sin(elapsed * 7 + idleSeed)
      const waveSwing = Math.sin(elapsed * 10 + idleSeed)
      const walkSwing = Math.sin(elapsed * 9 + idleSeed) * 0.65

      rig.position.y = -0.5 + idleBob
      head.rotation.set(0, Math.sin(elapsed * 0.75 + idleSeed) * 0.08, 0)
      leftArm.rotation.set(0, 0, 0)
      rightArm.rotation.set(0, 0, 0)
      leftLegPivot.rotation.set(0, 0, 0)
      rightLegPivot.rotation.set(0, 0, 0)

      if (walkLikeStates.has(animationState)) {
        leftArm.rotation.x = walkSwing
        rightArm.rotation.x = -walkSwing
        leftLegPivot.rotation.x = -walkSwing
        rightLegPivot.rotation.x = walkSwing

        if (animationState === 'turnLeft') {
          body.rotation.y = 0.12
        } else if (animationState === 'turnRight') {
          body.rotation.y = -0.12
        } else if (animationState === 'turnAround') {
          body.rotation.y = Math.sin(elapsed * 4 + idleSeed) * 0.18
        } else {
          body.rotation.y = 0
        }

        return
      }

      body.rotation.y = 0

      if (animationState === 'wave' || animationState === 'interact') {
        rightArm.rotation.z = -0.2
        rightArm.rotation.x = -1.1 + waveSwing * 0.38
        leftArm.rotation.x = Math.sin(elapsed * 4 + idleSeed) * 0.12
        head.rotation.y = Math.sin(elapsed * 1.6 + idleSeed) * 0.16
        return
      }

      if (animationState === 'dialogue') {
        leftArm.rotation.x = talkSwing * 0.24
        rightArm.rotation.x = -talkSwing * 0.24
        head.rotation.x = Math.sin(elapsed * 6 + idleSeed) * 0.04
        head.rotation.y = Math.sin(elapsed * 4 + idleSeed) * 0.1
      }
    },
    setHighlight: (active: boolean) => {
      for (const material of highlightMaterials) {
        material.emissive.setHex(active ? 0x2f5485 : 0x000000)
        material.emissiveIntensity = active ? 0.4 : 0
      }
    },
    setAnimationState: (state: CharacterAnimationState) => {
      animationState = state
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
    },
  }
}
