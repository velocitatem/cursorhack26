import { useGameRuntime } from '../game/runtime/useGameRuntime'
import type { SceneNpc, ScenePayload } from '../game/story/types'

type WorldCanvasProps = {
  scene: ScenePayload
  dialogueOpen: boolean
  activeNpcId: string | null
  onNpcInteract: (npc: SceneNpc) => void
}

export const WorldCanvas = ({
  scene,
  dialogueOpen,
  activeNpcId,
  onNpcInteract,
}: WorldCanvasProps) => {
  const mountRef = useGameRuntime({
    scene,
    dialogueOpen,
    activeNpcId,
    onNpcInteract,
  })

  return <div className="world-canvas" ref={mountRef} />
}
