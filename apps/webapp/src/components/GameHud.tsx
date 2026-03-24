import type { ChoiceTrace, ScenePayload } from '../game/story/types'

type GameHudProps = {
  scene: ScenePayload
  trace: ChoiceTrace[]
}

export const GameHud = ({ scene, trace }: GameHudProps) => {
  const interacted = new Set(
    trace.filter(t => t.sceneId === scene.sceneId).map(t => t.npcId),
  )
  const remaining = scene.npcs.filter(n => !interacted.has(n.id)).length

  return (
    <div className="game-hud">
      <div className="hud-scene">{scene.title}</div>
      <div className="hud-objective">{scene.objective}</div>
      {remaining > 0 && (
        <div className="hud-remaining">
          {remaining} message{remaining !== 1 ? 's' : ''} remaining
        </div>
      )}
      {remaining === 0 && scene.npcs.length > 0 && (
        <div className="hud-complete">All messages handled</div>
      )}
    </div>
  )
}
