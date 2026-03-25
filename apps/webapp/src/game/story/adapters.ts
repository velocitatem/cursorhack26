import type { CharacterAppearance } from '../characters/types'
import type { AdvanceSceneResponse, StartSceneResponse, StoryScene } from './schemas'
import type { ScenePayload, SceneTheme, SceneVector } from './types'

const spawnByTheme: Record<SceneTheme, SceneVector> = {
  inboxPlaza: { x: 0, y: 0, z: 8 },
  cityBlock: { x: 0, y: 0, z: 9 },
}

const npcPositions: SceneVector[] = [
  { x: -5, y: 0, z: 3 },
  { x: 0, y: 0, z: -4 },
  { x: 5, y: 0, z: 3 },
  { x: -6, y: 0, z: -1 },
  { x: 0, y: 0, z: 5 },
  { x: 6, y: 0, z: -1 },
]

const appearancePalette: CharacterAppearance[] = [
  { shirtColor: 0x6c8cff, pantsColor: 0x1b2334, accentColor: 0xc5d4ff },
  { shirtColor: 0x45c4a1, pantsColor: 0x18342e, accentColor: 0xaef6d7 },
  { shirtColor: 0xf2b84d, pantsColor: 0x3d2812, accentColor: 0xffedb0 },
  { shirtColor: 0xed6d5f, pantsColor: 0x342220, accentColor: 0xffc7bf },
  { shirtColor: 0x9d74ff, pantsColor: 0x251944, accentColor: 0xe6ddff },
  { shirtColor: 0x5ea8ff, pantsColor: 0x17273f, accentColor: 0xcce6ff },
]

const hash = (value: string) =>
  value.split('').reduce((sum, char) => (sum * 33 + char.charCodeAt(0)) >>> 0, 5381)

const toTitleCase = (value: string) =>
  value
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')

const toIntentPreview = (intent: string) => {
  const copy = intent.replace(/[_-]+/g, ' ').trim()
  if (!copy) {
    return 'Take the next reply step in the route.'
  }
  return `Reply direction: ${copy[0].toUpperCase()}${copy.slice(1)}.`
}

const getTheme = (depth: number, isTerminal: boolean): SceneTheme => {
  if (isTerminal) {
    return 'inboxPlaza'
  }
  return depth % 2 === 0 ? 'inboxPlaza' : 'cityBlock'
}

const normalizeTheme = (value: string): SceneTheme =>
  value === 'cityBlock' ? 'cityBlock' : 'inboxPlaza'

const getAppearance = (scene: StoryScene): CharacterAppearance => {
  const index = hash(`${scene.npc_id}:${scene.npc_name}`) % appearancePalette.length
  return appearancePalette[index]
}

const getPosition = (scene: StoryScene): SceneVector => {
  const index = hash(scene.scene_id) % npcPositions.length
  return npcPositions[index]
}

const getObjective = (scene: StoryScene, done: boolean) => {
  if (done || scene.is_terminal) {
    return 'Resolve the route and review the final draft bundle.'
  }
  const locationLabel = scene.world?.location_id ? ` at ${toTitleCase(scene.world.location_id)}` : ''
  return `Talk to ${scene.npc_name}${locationLabel} and lock in the next reply path.`
}

type StorySceneEnvelope = Pick<StartSceneResponse, 'scene' | 'trace' | 'done'> | Pick<AdvanceSceneResponse, 'scene' | 'trace' | 'done'>

export const toScenePayload = ({ scene, trace, done }: StorySceneEnvelope): ScenePayload => {
  const isTerminal = done || scene.is_terminal
  const theme = scene.environment?.theme
    ? normalizeTheme(scene.environment.theme)
    : getTheme(trace.length, isTerminal)
  const sourceNpcs = scene.npcs.length
    ? scene.npcs
    : [
        {
          id: scene.npc_id,
          name: scene.npc_name,
          email_id: scene.related_email_ids[0] || scene.npc_id,
          position: getPosition(scene),
          opening_line: scene.dialogue,
          tts: scene.tts,
          voice_id: scene.voice_id,
          choices: scene.choices,
          related_email_ids: scene.related_email_ids,
        },
      ]

  return {
    sceneId: scene.scene_id,
    title: isTerminal ? 'Victory Lap' : toTitleCase(scene.scene_id),
    objective: getObjective(scene, isTerminal),
    completionMessage: isTerminal
      ? 'Inbox route locked. Resolve the drafted emails to review the final bundle.'
      : undefined,
    environment: {
      theme,
      spawn: scene.environment?.spawn ?? spawnByTheme[theme],
      layout: scene.environment?.layout
        ? {
            seed: scene.environment.layout.seed,
            bounds: scene.environment.layout.bounds,
            blocks: scene.environment.layout.blocks,
          }
        : undefined,
    },
    world: scene.world
      ? {
          worldId: scene.world.world_id,
          locationId: scene.world.location_id,
          visitedLocationIds: scene.world.visited_location_ids,
          plannerSource: scene.world.planner_source,
          runSeed: scene.world.run_seed,
        }
      : undefined,
    npcs: sourceNpcs.map(npc => ({
      id: npc.id,
      name: npc.name,
      emailId:
        npc.related_email_ids.length > 1
          ? `${npc.related_email_ids.length} inbox threads`
          : npc.related_email_ids[0] || npc.email_id,
      position: npc.position,
      openingLine: npc.opening_line,
      ttsUrl: npc.tts || scene.tts || undefined,
      voiceId: npc.voice_id ?? scene.voice_id ?? undefined,
      choices: npc.choices.map(choice => ({
        id: choice.slug,
        label: choice.label,
        previewReply: toIntentPreview(choice.intent),
        nextSceneId: scene.choice_transitions?.[choice.slug],
      })),
      appearance: getAppearance(scene),
    })),
  }
}

export const createPlaceholderScene = (
  title = 'Booting Story Route',
  objective = 'Connect the inbox route and wait for the first scene.',
): ScenePayload => ({
  sceneId: 'story-loading',
  title,
  objective,
  environment: {
    theme: 'inboxPlaza',
    spawn: spawnByTheme.inboxPlaza,
  },
  npcs: [],
})
