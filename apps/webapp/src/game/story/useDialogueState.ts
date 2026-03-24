import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ScenePayload } from './types'

type DialogueAudioProgress = {
  currentTime: number
  duration: number | null
}

export const useDialogueState = (scene: ScenePayload, audioProgress?: DialogueAudioProgress) => {
  const [activeNpcId, setActiveNpcId] = useState<string | null>(null)
  const [visibleChars, setVisibleChars] = useState(0)

  const activeNpc = useMemo(() => {
    if (!activeNpcId) {
      return null
    }

    return scene.npcs.find(npc => npc.id === activeNpcId) ?? null
  }, [activeNpcId, scene.npcs])

  useEffect(() => {
    if (!activeNpc) {
      return
    }

    const line = activeNpc.openingLine

    const interval = window.setInterval(() => {
      setVisibleChars(current => {
        if (current >= line.length) {
          window.clearInterval(interval)
          return current
        }

        return current + 1
      })
    }, 14)

    return () => {
      window.clearInterval(interval)
    }
  }, [activeNpc])

  const syncedChars =
    !activeNpc || !audioProgress?.duration || audioProgress.duration <= 0
      ? 0
      : Math.min(
          activeNpc.openingLine.length,
          Math.round(activeNpc.openingLine.length * Math.max(0, Math.min(audioProgress.currentTime / audioProgress.duration, 1))),
        )

  const openDialogue = useCallback((npcId: string) => {
    setVisibleChars(0)
    setActiveNpcId(npcId)
  }, [])

  const closeDialogue = useCallback(() => {
    setActiveNpcId(null)
  }, [])

  const visibleLine = activeNpc?.openingLine.slice(0, Math.max(visibleChars, syncedChars)) ?? ''

  return {
    activeNpcId,
    activeNpc,
    visibleLine,
    isOpen: activeNpc !== null,
    openDialogue,
    closeDialogue,
  }
}
