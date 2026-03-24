import { useCallback, useEffect } from 'react'
import './App.css'
import { AuthGate } from './auth/AuthGate'
import { useSession } from './auth/useSession'
import { DialogueOverlay } from './components/DialogueOverlay'
import { WorldCanvas } from './components/WorldCanvas'
import { useDialogueAudio } from './game/story/useDialogueAudio'
import { useDialogueState } from './game/story/useDialogueState'
import { useSceneLoader } from './game/story/useSceneLoader'
import type { SceneNpc } from './game/story/types'

function GameShell({
  userLabel,
  onLogout,
}: {
  userLabel: string
  onLogout: () => Promise<void>
}) {
  const {
    mode,
    sessionId,
    scene,
    trace,
    drafts,
    done,
    error,
    isStarting,
    isAdvancing,
    isResolving,
    chooseOption,
    resolveDrafts,
    restart,
  } = useSceneLoader()
  const {
    status: dialogueAudioStatus,
    error: dialogueAudioError,
    currentTime: dialogueAudioCurrentTime,
    duration: dialogueAudioDuration,
    playNpc,
    stop: stopDialogueAudio,
  } = useDialogueAudio()
  const { activeNpcId, activeNpc, visibleLine, isOpen, openDialogue, closeDialogue } =
    useDialogueState(scene, {
      currentTime: dialogueAudioCurrentTime,
      duration: dialogueAudioDuration,
    })
  const isBusy = isStarting || isAdvancing || isResolving

  useEffect(() => {
    stopDialogueAudio()
  }, [scene.sceneId, stopDialogueAudio])

  const handleNpcInteract = useCallback(
    (npc: SceneNpc) => {
      void playNpc(npc)
      openDialogue(npc.id)
    },
    [openDialogue, playNpc],
  )

  const handleCloseDialogue = useCallback(() => {
    stopDialogueAudio()
    closeDialogue()
  }, [closeDialogue, stopDialogueAudio])

  const handleChoice = useCallback(
    async (choiceId: string) => {
      if (!activeNpc) {
        return
      }

      stopDialogueAudio()
      await chooseOption({
        npcId: activeNpc.id,
        choiceId,
      })
      closeDialogue()
    },
    [activeNpc, chooseOption, closeDialogue, stopDialogueAudio],
  )

  const handleResolve = useCallback(() => {
    void resolveDrafts()
  }, [resolveDrafts])

  const handleRestart = useCallback(() => {
    stopDialogueAudio()
    closeDialogue()
    restart()
  }, [closeDialogue, restart, stopDialogueAudio])

  return (
    <main className="app-shell">
      <div className="session-pill">
        <span className="session-initial">{userLabel[0]}</span>
        <span className="session-details">
          <span className="session-user">{userLabel}</span>
          <button className="session-logout" type="button" onClick={() => void onLogout()}>
            Logout
          </button>
        </span>
      </div>

      <WorldCanvas
        scene={scene}
        dialogueOpen={isOpen}
        activeNpcId={activeNpcId}
        onNpcInteract={handleNpcInteract}
      />

      <section className="story-hud">
        <div className="story-status-card">
          <p className="eyebrow">Story route</p>
          <h1 className="story-title">{scene.title}</h1>
          <p className="story-objective">{scene.objective}</p>

          <div className="story-meta">
            <span>Mode: {mode}</span>
            <span>Choices locked: {trace.length}</span>
            <span>{sessionId ? 'Session live' : 'No session yet'}</span>
          </div>

          {scene.completionMessage ? (
            <p className="story-completion">{scene.completionMessage}</p>
          ) : null}

          {error ? <p className="story-error">{error}</p> : null}

          <div className="story-actions">
            <button className="hud-button" onClick={handleRestart} type="button" disabled={isBusy}>
              Restart run
            </button>
            <button
              className="hud-button hud-button-primary"
              onClick={handleResolve}
              type="button"
              disabled={!done || isBusy}
            >
              {isResolving ? 'Resolving drafts...' : drafts.length ? 'Refresh drafts' : 'Resolve drafts'}
            </button>
          </div>

          {isStarting ? <p className="story-note">Loading the first scene from the story service.</p> : null}
          {!done && !isStarting ? (
            <p className="story-note">Walk up to the active NPC and press `E` to lock in a route.</p>
          ) : null}
        </div>

        {done || drafts.length > 0 ? (
          <div className="drafts-card">
            <div className="drafts-header">
              <div>
                <p className="eyebrow">Resolve output</p>
                <h2>Draft bundle</h2>
              </div>
            </div>

            {drafts.length ? (
              <div className="draft-list">
                {drafts.map(draft => (
                  <article className="draft-item" key={draft.email_id}>
                    <p className="draft-to">To: {draft.to}</p>
                    <h3>{draft.subject}</h3>
                    <p>{draft.body}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="story-note">The route is complete. Resolve the bundle to preview the final drafts.</p>
            )}
          </div>
        ) : null}
      </section>

      <DialogueOverlay
        npc={activeNpc}
        visibleLine={visibleLine}
        isAdvancing={isAdvancing}
        audioStatus={dialogueAudioStatus}
        audioError={dialogueAudioError}
        onClose={handleCloseDialogue}
        onChoose={handleChoice}
      />
    </main>
  )
}

function App() {
  const { session, isLoading, authError, beginGoogleLogin, logout } = useSession()

  if (isLoading) {
    return (
      <main className="loading-shell">
        <p className="auth-kicker">Booting</p>
        <h1 className="auth-title">Checking your session.</h1>
        <p className="auth-copy">Validating login.</p>
      </main>
    )
  }

  if (!session.authenticated) {
    return <AuthGate authError={authError} onContinue={beginGoogleLogin} />
  }

  const userLabel = session.user?.name ?? session.user?.email ?? 'Player'

  return <GameShell userLabel={userLabel} onLogout={logout} />
}

export default App
