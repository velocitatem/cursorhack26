import type { CharacterAppearance } from '../characters/types'

export type SceneTheme = 'inboxPlaza' | 'cityBlock'

export type SceneVector = {
  x: number
  y: number
  z: number
}

export type SceneChoice = {
  id: string
  label: string
  previewReply: string
  nextSceneId?: string
}

export type SceneBounds = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export type SceneBlock = {
  x: number
  y: number
  z: number
  type: string
}

export type SceneNpc = {
  id: string
  name: string
  emailId: string
  position: SceneVector
  openingLine: string
  ttsUrl?: string
  voiceId?: string | null
  choices: SceneChoice[]
  appearance?: CharacterAppearance
}

export type ScenePayload = {
  sceneId: string
  title: string
  objective: string
  completionMessage?: string
  environment: {
    theme: SceneTheme
    spawn: SceneVector
    layout?: {
      seed: number
      bounds: SceneBounds
      blocks: SceneBlock[]
    }
  }
  world?: {
    worldId: string
    locationId: string
    visitedLocationIds: string[]
    plannerSource: string
    runSeed: number
  }
  npcs: SceneNpc[]
}

export type ChoiceSelection = {
  npcId: string
  choiceId: string
  choiceContext?: string
}

export type ChoiceTrace = {
  sceneId: string
  npcId: string
  npcName: string
  emailId: string
  choiceId: string
  label: string
  previewReply: string
  nextSceneId?: string
}
