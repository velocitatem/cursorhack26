import { useEffect } from 'react'
import { useGameRuntime, type GameRuntimeControls } from '../game/runtime/useGameRuntime'
import type { SceneNpc, ScenePayload } from '../game/story/types'

type WorldCanvasProps = {
  scene: ScenePayload
  dialogueOpen: boolean
  activeNpcId: string | null
  onNpcInteract: (npc: SceneNpc) => void
  onInteractionTargetChange?: (npc: SceneNpc | null) => void
  onControlsReady?: (controls: GameRuntimeControls | null) => void
}

export const WorldCanvas = ({
  scene,
  dialogueOpen,
  activeNpcId,
  onNpcInteract,
  onInteractionTargetChange,
  onControlsReady,
}: WorldCanvasProps) => {
  const { mountRef, controls } = useGameRuntime({
    scene,
    dialogueOpen,
    activeNpcId,
    onNpcInteract,
    onInteractionTargetChange,
  })

  useEffect(() => {
    onControlsReady?.(controls)
    return () => onControlsReady?.(null)
  }, [controls, onControlsReady])

  useEffect(() => () => onInteractionTargetChange?.(null), [onInteractionTargetChange])

  return <div className="world-canvas" ref={mountRef} />
}
