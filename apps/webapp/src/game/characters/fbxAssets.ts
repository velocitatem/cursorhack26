import type { CharacterAnimationState, CharacterRigKind } from './types'

type CharacterClipState = Exclude<CharacterAnimationState, 'idle'>

type CharacterAssetConfig = {
  modelUrl: string
  targetHeight: number
  nameplateY: number
  animationUrls: Partial<Record<CharacterClipState, string>>
}

const assetUrl = (relativePath: string) => new URL(relativePath, import.meta.url).href

const animationUrls = {
  leftTurn: assetUrl('../../../../../asset_game/animations/Left Turn.fbx'),
  startWalking: assetUrl('../../../../../asset_game/animations/Start Walking.fbx'),
  talking: assetUrl('../../../../../asset_game/animations/Talking.fbx'),
  rightTurn: assetUrl('../../../../../asset_game/animations/Turning Right from Mixamo.fbx'),
  walking: assetUrl('../../../../../asset_game/animations/Walking Animation (1).fbx'),
  turnAround: assetUrl('../../../../../asset_game/animations/Walking Turn 180.fbx'),
  waving: assetUrl('../../../../../asset_game/animations/Waving Animation.fbx'),
} as const

export const characterAssetConfigs: Record<CharacterRigKind, CharacterAssetConfig> = {
  player: {
    modelUrl: assetUrl('../../../../../asset_game/character/main_character.fbx'),
    targetHeight: 1.9,
    nameplateY: 2.35,
    animationUrls: {
      moveStart: animationUrls.startWalking,
      moveLoop: animationUrls.walking,
      turnLeft: animationUrls.leftTurn,
      turnRight: animationUrls.rightTurn,
      turnAround: animationUrls.turnAround,
      interact: animationUrls.waving,
      dialogue: animationUrls.talking,
      wave: animationUrls.waving,
    },
  },
  villager: {
    modelUrl: assetUrl('../../../../../asset_game/character/villager.fbx'),
    targetHeight: 2.05,
    nameplateY: 2.55,
    animationUrls: {
      wave: animationUrls.waving,
      dialogue: animationUrls.talking,
    },
  },
}
