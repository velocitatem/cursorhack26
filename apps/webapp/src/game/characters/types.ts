import * as THREE from 'three'

export type CharacterRigKind = 'player' | 'villager'

export type CharacterAnimationState =
  | 'idle'
  | 'moveStart'
  | 'moveLoop'
  | 'turnLeft'
  | 'turnRight'
  | 'turnAround'
  | 'interact'
  | 'dialogue'
  | 'wave'

export type CharacterAppearance = {
  name?: string
  scale?: number
  skinColor?: number
  shirtColor?: number
  pantsColor?: number
  shoeColor?: number
  accentColor?: number
}

export type CharacterRig = {
  group: THREE.Group
  update: (delta: number, elapsed: number) => void
  setHighlight: (active: boolean) => void
  setAnimationState: (state: CharacterAnimationState) => void
  dispose: () => void
}
