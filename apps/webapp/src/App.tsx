import { useCallback } from 'react'
import './App.css'
import { DialogueOverlay } from './components/DialogueOverlay'
import { WorldCanvas } from './components/WorldCanvas'
import { useDialogueState } from './game/story/useDialogueState'
import { useSceneLoader } from './game/story/useSceneLoader'
import type { SceneNpc } from './game/story/types'

function App() {
  const { scene, isAdvancing, chooseOption } = useSceneLoader()
  const { activeNpcId, activeNpc, visibleLine, isOpen, openDialogue, closeDialogue } =
    useDialogueState(scene)

  const handleNpcInteract = useCallback(
    (npc: SceneNpc) => {
      openDialogue(npc.id)
    },
    [openDialogue],
  )

  const handleChoice = useCallback(
    async (choiceId: string) => {
      if (!activeNpc) {
        return
      }

      await chooseOption({
        npcId: activeNpc.id,
        choiceId,
      })
      closeDialogue()
    },
    [activeNpc, chooseOption, closeDialogue],
  )

  return (
    <main className="app-shell">
      <WorldCanvas
        scene={scene}
        dialogueOpen={isOpen}
        activeNpcId={activeNpcId}
        onNpcInteract={handleNpcInteract}
      />

      <DialogueOverlay
        npc={activeNpc}
        visibleLine={visibleLine}
        isAdvancing={isAdvancing}
        onClose={closeDialogue}
        onChoose={handleChoice}
      />
    </main>
  )
}

export default App
