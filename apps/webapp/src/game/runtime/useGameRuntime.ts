import { useEffect, useRef } from 'react'
import { GameRuntime, type GameRuntimeCallbacks } from './GameRuntime'
import type { ScenePayload } from '../story/types'

type UseGameRuntimeOptions = GameRuntimeCallbacks & {
  scene: ScenePayload
  dialogueOpen: boolean
  activeNpcId: string | null
}

export const useGameRuntime = ({
  scene,
  dialogueOpen,
  activeNpcId,
  onNpcInteract,
  onDoorChoose,
}: UseGameRuntimeOptions) => {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const runtimeRef = useRef<GameRuntime | null>(null)

  useEffect(() => {
    if (!mountRef.current) return
    const runtime = new GameRuntime(mountRef.current, { onNpcInteract, onDoorChoose })
    runtimeRef.current = runtime
    return () => {
      runtime.destroy()
      runtimeRef.current = null
    }
  }, [onNpcInteract, onDoorChoose])

  useEffect(() => {
    runtimeRef.current?.setCallbacks({ onNpcInteract, onDoorChoose })
  }, [onNpcInteract, onDoorChoose])

  useEffect(() => {
    runtimeRef.current?.setScene(scene)
  }, [scene])

  useEffect(() => {
    runtimeRef.current?.setDialogueOpen(dialogueOpen)
  }, [dialogueOpen])

  useEffect(() => {
    runtimeRef.current?.setActiveNpc(activeNpcId)
  }, [activeNpcId])

  return mountRef
}
