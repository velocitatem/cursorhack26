import { useGameRuntime } from '../game/runtime/useGameRuntime'
import type { SceneNpc, ScenePayload } from '../game/story/types'

type WorldCanvasProps = {
  scene: ScenePayload
  dialogueOpen: boolean
  activeNpcId: string | null
  onNpcInteract: (npc: SceneNpc) => void
  onDoorChoose: (npcId: string, choiceId: string) => void
}

export const WorldCanvas = ({
  scene,
  dialogueOpen,
  activeNpcId,
  onNpcInteract,
  onDoorChoose,
}: WorldCanvasProps) => {
  const mountRef = useGameRuntime({
    scene,
    dialogueOpen,
    activeNpcId,
    onNpcInteract,
    onDoorChoose,
  })

  return <div className="world-canvas" ref={mountRef} />
}
