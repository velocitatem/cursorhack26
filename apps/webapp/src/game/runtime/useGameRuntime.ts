import { useEffect, useMemo, useRef } from 'react'
import { GameRuntime, type GameRuntimeCallbacks } from './GameRuntime'
import type { ScenePayload } from '../story/types'

type UseGameRuntimeOptions = GameRuntimeCallbacks & {
  scene: ScenePayload
  dialogueOpen: boolean
  activeNpcId: string | null
}

export type GameRuntimeControls = {
  setMoveInput: (x: number, y: number) => void
  clearMoveInput: () => void
  interact: () => void
}

export const useGameRuntime = ({
  scene,
  dialogueOpen,
  activeNpcId,
  onNpcInteract,
  onInteractionTargetChange,
}: UseGameRuntimeOptions) => {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const runtimeRef = useRef<GameRuntime | null>(null)
  const controls = useMemo<GameRuntimeControls>(
    () => ({
      setMoveInput: (x, y) => runtimeRef.current?.setMoveInput(x, y),
      clearMoveInput: () => runtimeRef.current?.clearMoveInput(),
      interact: () => runtimeRef.current?.interact(),
    }),
    [],
  )

  useEffect(() => {
    if (!mountRef.current) {
      return
    }

    const runtime = new GameRuntime(mountRef.current, {
      onNpcInteract,
      onInteractionTargetChange,
    })

    runtimeRef.current = runtime

    return () => {
      runtime.destroy()
      runtimeRef.current = null
    }
  }, [onInteractionTargetChange, onNpcInteract])

  useEffect(() => {
    runtimeRef.current?.setCallbacks({
      onNpcInteract,
      onInteractionTargetChange,
    })
  }, [onInteractionTargetChange, onNpcInteract])

  useEffect(() => {
    runtimeRef.current?.setScene(scene)
  }, [scene])

  useEffect(() => {
    runtimeRef.current?.setDialogueOpen(dialogueOpen)
  }, [dialogueOpen])

  useEffect(() => {
    runtimeRef.current?.setActiveNpc(activeNpcId)
  }, [activeNpcId])

  return { mountRef, controls }
}
