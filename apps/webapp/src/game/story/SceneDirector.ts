import { mockScenes, startSceneId } from './mockScene'
import type {
  ChoiceSelection,
  ChoiceTrace,
  SceneChoice,
  SceneNpc,
  ScenePayload,
} from './types'

const resolveSceneNpc = (scene: ScenePayload, npcId: string): SceneNpc => {
  const npc = scene.npcs.find(entry => entry.id === npcId)

  if (!npc) {
    throw new Error(`NPC "${npcId}" was not found in scene "${scene.sceneId}".`)
  }

  return npc
}

const resolveChoice = (npc: SceneNpc, choiceId: string): SceneChoice => {
  const choice = npc.choices.find(entry => entry.id === choiceId)

  if (!choice) {
    throw new Error(`Choice "${choiceId}" was not found for NPC "${npc.id}".`)
  }

  return choice
}

export class SceneDirector {
  private currentSceneId = startSceneId
  private readonly trace: ChoiceTrace[] = []

  getCurrentScene() {
    return mockScenes[this.currentSceneId]
  }

  getTrace() {
    return [...this.trace]
  }

  restart() {
    this.currentSceneId = startSceneId
    this.trace.splice(0, this.trace.length)
    return this.getCurrentScene()
  }

  choose(selection: ChoiceSelection) {
    const currentScene = this.getCurrentScene()
    const npc = resolveSceneNpc(currentScene, selection.npcId)
    const choice = resolveChoice(npc, selection.choiceId)

    this.trace.push({
      sceneId: currentScene.sceneId,
      npcId: npc.id,
      npcName: npc.name,
      emailId: npc.emailId,
      choiceId: choice.id,
      label: choice.label,
      previewReply: choice.previewReply,
      nextSceneId: choice.nextSceneId,
    })

    this.currentSceneId = choice.nextSceneId ?? currentScene.sceneId

    return {
      scene: this.getCurrentScene(),
      trace: this.getTrace(),
    }
  }
}
