import { useCallback } from 'react'
import './App.css'
import { DialogueOverlay } from './components/DialogueOverlay'
import { GameHud } from './components/GameHud'
import { SceneTitle } from './components/SceneTitle'
import { WorldCanvas } from './components/WorldCanvas'
import { useDialogueState } from './game/story/useDialogueState'
import { useSceneLoader } from './game/story/useSceneLoader'
import type { SceneNpc } from './game/story/types'

function App() {
  const { scene, trace, isAdvancing, chooseOption } = useSceneLoader()
  const { activeNpcId, activeNpc, visibleLine, isOpen, openDialogue, closeDialogue } =
    useDialogueState(scene)

  const handleNpcInteract = useCallback(
    (npc: SceneNpc) => openDialogue(npc.id),
    [openDialogue],
  )

  const handleDoorChoose = useCallback(
    async (npcId: string, choiceId: string) => {
      await chooseOption({ npcId, choiceId })
    },
    [chooseOption],
  )

  return (
    <main className="app-shell">
      <WorldCanvas
        scene={scene}
        dialogueOpen={isOpen}
        activeNpcId={activeNpcId}
        onNpcInteract={handleNpcInteract}
        onDoorChoose={handleDoorChoose}
      />

      <GameHud scene={scene} trace={trace} />

      <SceneTitle scene={scene} />

      <DialogueOverlay
        npc={activeNpc}
        visibleLine={visibleLine}
        isAdvancing={isAdvancing}
        onClose={closeDialogue}
      />
    </main>
  )
}

export default App
