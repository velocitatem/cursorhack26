import * as THREE from 'three'

export type CharacterAppearance = {
  name?: string
  scale?: number
  skinColor?: number
  shirtColor?: number
  pantsColor?: number
  shoeColor?: number
  accentColor?: number
}

export type VoxelCharacterRig = {
  group: THREE.Group
  update: (elapsed: number, movementStrength?: number) => void
  setHighlight: (active: boolean) => void
  dispose: () => void
}
