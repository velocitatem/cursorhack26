import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import { AuthGate } from './auth/AuthGate'
import { useSession } from './auth/useSession'
import { DialogueOverlay } from './components/DialogueOverlay'
import { MobileControls } from './components/MobileControls'
import { WorldCanvas } from './components/WorldCanvas'
import type { GameRuntimeControls } from './game/runtime/useGameRuntime'
import type { DraftSendResult, EmailDraft, EmailItem, InboxPreviewResponse, TraceStep } from './game/story/schemas'
import type { SceneNpc } from './game/story/types'
import { useDialogueAudio } from './game/story/useDialogueAudio'
import { useDialogueState } from './game/story/useDialogueState'
import { useSceneLoader } from './game/story/useSceneLoader'

const previewSourceLabels: Record<InboxPreviewResponse['source'], string> = {
  gmail: 'Live Gmail',
  override: 'Loaded Inbox',
}

const toReadableLabel = (value: string) =>
  value
    .split(/[_-]+/)
    .filter(Boolean)
    .map(part => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')

function useCoarsePointer() {
  const [isCoarsePointer, setIsCoarsePointer] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(pointer: coarse)').matches : false,
  )

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const query = window.matchMedia('(pointer: coarse)')
    const update = () => setIsCoarsePointer(query.matches)

    update()
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', update)
      return () => query.removeEventListener('change', update)
    }

    query.addListener(update)
    return () => query.removeListener(update)
  }, [])

  return isCoarsePointer
}

function PreludeOverlay({
  userLabel,
  emails,
  source,
  stage,
  error,
  onRetry,
  onBeginRun,
}: {
  userLabel: string
  emails: EmailItem[]
  source: InboxPreviewResponse['source']
  stage: 'previewing' | 'ready' | 'generating'
  error: string | null
  onRetry: () => void
  onBeginRun: (emails: EmailItem[]) => void
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(emails.map(email => email.id)))

  const toggleEmail = (emailId: string) => {
    setSelectedIds(previous => {
      const next = new Set(previous)
      if (next.has(emailId)) {
        next.delete(emailId)
      } else {
        next.add(emailId)
      }
      return next
    })
  }

  const selectedEmails = emails.filter(email => selectedIds.has(email.id))
  const statusTitle = error
    ? 'The route generator stalled.'
    : stage === 'generating'
      ? 'Forging the city from today’s inbox.'
      : stage === 'ready'
        ? 'Choose the threads for this run.'
        : 'Scanning today’s threads.'

  const statusCopy = error
    ? 'Retry the run and the game will rebuild from the same inbox preview flow.'
    : stage === 'generating'
      ? 'Emails are being turned into characters, dialogue, and branching reply paths.'
      : stage === 'ready'
        ? 'Keep only the emails you want to turn into scenes, then launch the run.'
        : 'Pulling in today’s most important threads before the world opens.'

  const metrics = [
    { label: 'Selected', value: selectedEmails.length.toString().padStart(2, '0') },
    { label: 'Source', value: previewSourceLabels[source] },
    { label: 'Mode', value: 'Live API' },
  ]
  const skeletonIds = Array.from({ length: 4 }, (_, index) => `skeleton-${index}`)

  return (
    <section className="prelude-overlay" data-stage={stage}>
      <div className="prelude-chrome" />
      <div className="prelude-grid">
        <div className="prelude-rail">
          <div className="prelude-hero">
            <p className="screen-kicker">Inbox Quest</p>
            <h1 className="prelude-title">Your next replies are about to become a city.</h1>
            <p className="prelude-copy">
              {userLabel} is entering a short run through today&apos;s inbox. Every thread below becomes a scene once the
              route is ready.
            </p>

            <div className="prelude-metrics">
              {metrics.map(metric => (
                <article className="metric-card" key={metric.label}>
                  <p>{metric.label}</p>
                  <strong>{metric.value}</strong>
                </article>
              ))}
            </div>
          </div>

          <div className="prelude-status-card">
            <div>
              <p className="eyebrow">Story build</p>
              <h2>{statusTitle}</h2>
              <p className="status-copy">{statusCopy}</p>
            </div>

            <div className="status-rail" aria-hidden="true">
              <span className="status-rail-fill" />
            </div>

            <div className="status-list">
              <p>{stage === 'generating' ? 'Composing NPC dialogue and route choices.' : 'Checking inbox availability.'}</p>
              <p>{stage === 'generating' ? 'Preloading the first playable scene.' : 'Preparing the game shell.'}</p>
            </div>

            {error ? (
              <div className="status-actions">
                <p className="story-error">{error}</p>
                <button className="hud-button hud-button-primary" onClick={onRetry} type="button">
                  Retry run
                </button>
              </div>
            ) : stage === 'ready' ? (
              <div className="status-actions">
                <button
                  className="hud-button hud-button-primary"
                  disabled={!selectedEmails.length}
                  onClick={() => onBeginRun(selectedEmails)}
                  type="button"
                >
                  Start run with {selectedEmails.length}
                </button>
              </div>
            ) : (
              <p className="story-note">The world opens automatically as soon as the first story scene is ready.</p>
            )}
          </div>
        </div>

        <div className="prelude-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Today&apos;s inbox</p>
              <h2>Threads entering the run</h2>
            </div>
            <span className="source-chip">{previewSourceLabels[source]}</span>
          </div>

          <div className="prelude-email-list">
            {emails.length
              ? emails.map((email, index) => (
                <article className="prelude-email-card" key={email.id} style={{ animationDelay: `${index * 90}ms` }}>
                  <div className="prelude-email-meta">
                    <span>{email.sender}</span>
                    <span>Today</span>
                    {stage === 'ready' ? (
                      <label className="email-select-pill">
                        <input
                          checked={selectedIds.has(email.id)}
                          onChange={() => toggleEmail(email.id)}
                          type="checkbox"
                        />
                        <span>{selectedIds.has(email.id) ? 'Keep' : 'Skip'}</span>
                      </label>
                    ) : null}
                  </div>
                  <h3>{email.subject}</h3>
                  <p>{email.snippet || email.body || 'This thread will become part of the route.'}</p>
                </article>
              ))
              : skeletonIds.map(id => (
                <article className="prelude-email-card prelude-email-skeleton" key={id}>
                  <span />
                  <span />
                  <span />
                </article>
              ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function FinaleOverlay({
  drafts,
  trace,
  sendResults,
  draftReviewStatusById,
  sendingDraftIds,
  runStage,
  isResolving,
  error,
  onSendDraft,
  onToggleSkipDraft,
  onFinishReview,
  onRetryDraft,
  onRestart,
}: {
  drafts: EmailDraft[]
  trace: TraceStep[]
  sendResults: DraftSendResult[]
  draftReviewStatusById: Record<string, 'pending' | 'skipped' | 'sent' | 'failed'>
  sendingDraftIds: Set<string>
  runStage: 'review' | 'sending' | 'sent'
  isResolving: boolean
  error: string | null
  onSendDraft: (emailId: string) => void
  onToggleSkipDraft: (emailId: string) => void
  onFinishReview: () => void
  onRetryDraft: (emailId: string) => void
  onRestart: () => void
}) {
  const routeSummary = trace.map(step => ({
    id: `${step.scene_id}:${step.choice_slug}`,
    title: toReadableLabel(step.choice_slug),
    subtitle: toReadableLabel(step.choice_intent || step.scene_id),
  }))

  const resultsByEmailId = new Map(sendResults.map(result => [result.email_id, result]))
  const recapRows = drafts.map(draft => {
    const result = resultsByEmailId.get(draft.email_id)
    const status = draftReviewStatusById[draft.email_id] ?? 'pending'
    return { draft, result, status }
  })
  const sentCount = recapRows.filter(row => row.status === 'sent').length
  const failedCount = recapRows.filter(row => row.status === 'failed').length
  const skippedCount = recapRows.filter(row => row.status === 'skipped').length
  const pendingCount = recapRows.filter(row => row.status === 'pending').length

  if (isResolving) {
    return (
      <section className="finale-overlay">
        <div className="finale-card finale-card-centered">
          <p className="screen-kicker">Agent Resolve</p>
          <h2>Flattening your route into real replies.</h2>
          <p className="prelude-copy">
            The selected choices are being compressed into final email drafts before the send screen opens.
          </p>
          <div className="status-rail" aria-hidden="true">
            <span className="status-rail-fill" />
          </div>
        </div>
      </section>
    )
  }

  if (runStage === 'sending') {
    return (
      <section className="finale-overlay">
        <div className="finale-card finale-card-centered">
          <p className="screen-kicker">Agent Dispatch</p>
          <h2>Sending the entire bundle.</h2>
          <p className="prelude-copy">
            The agent is delivering every drafted reply and collecting the outcome of each thread.
          </p>
          <div className="status-rail" aria-hidden="true">
            <span className="status-rail-fill" />
          </div>
        </div>
      </section>
    )
  }

  if (runStage === 'sent') {
    return (
      <section className="finale-overlay">
        <div className="finale-card">
          <div className="finale-header">
            <div>
              <p className="screen-kicker">Run Complete</p>
              <h2>Agent recap</h2>
              <p className="prelude-copy">
                {sentCount} sent
                {failedCount ? `, ${failedCount} still need attention` : ''}
                {skippedCount ? `, ${skippedCount} held back.` : '. Every selected reply made it out.'}
              </p>
            </div>
            <button className="hud-button" onClick={onRestart} type="button">
              New run
            </button>
          </div>

          <div className="finale-summary-strip">
            <span>{drafts.length} drafts reviewed</span>
            <span>{sentCount} sent</span>
            <span>{skippedCount} skipped</span>
            <span>{failedCount} failed</span>
          </div>

          <div className="finale-list">
            {recapRows.map(({ draft, result, status }) => {
              return (
                <article className="finale-email-card" key={draft.email_id}>
                  <div className="finale-email-header">
                    <div>
                      <p className="draft-to">To: {draft.to}</p>
                      <h3>{draft.subject}</h3>
                    </div>
                    <span className={`result-badge result-badge-${status}`}>{status}</span>
                  </div>

                  <p>{draft.body}</p>

                  <div className="result-meta">
                    {status === 'skipped' ? (
                      <span>Held back during final review</span>
                    ) : status === 'sent' || status === 'failed' ? (
                      <>
                        <span>{result?.gmail_message_id ? `Message ${result.gmail_message_id}` : 'Awaiting provider id'}</span>
                        <span>{result?.thread_id ? `Thread ${result.thread_id}` : 'Thread id pending'}</span>
                      </>
                    ) : (
                      <span>Awaiting final action</span>
                    )}
                  </div>

                  {status === 'failed' ? (
                    <button
                      className="hud-button hud-button-primary"
                      onClick={() => onRetryDraft(draft.email_id)}
                      type="button"
                    >
                      Retry send
                    </button>
                  ) : null}
                </article>
              )
            })}
          </div>

          {error ? <p className="story-error">{error}</p> : null}
        </div>
      </section>
    )
  }

  return (
    <section className="finale-overlay">
      <div className="finale-card">
        <div className="finale-header">
          <div>
            <p className="screen-kicker">Final Review</p>
            <h2>The route is locked.</h2>
            <p className="prelude-copy">Review each drafted email and decide if you want to send or skip it.</p>
          </div>
          <div className="finale-actions">
            <button className="hud-button" onClick={onRestart} type="button">
              Restart run
            </button>
            <button
              className="hud-button hud-button-primary"
              disabled={pendingCount > 0}
              onClick={onFinishReview}
              type="button"
            >
              Finish review
            </button>
          </div>
        </div>

        <div className="finale-grid">
          <div className="finale-column">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Draft bundle</p>
                <h3>Replies ready to go</h3>
              </div>
              <span className="source-chip">{pendingCount} pending</span>
            </div>

            <div className="finale-list">
              {drafts.map(draft => (
                <article className="finale-email-card" key={draft.email_id}>
                  <div className="finale-email-header">
                    <p className="draft-to">To: {draft.to}</p>
                    <span className={`result-badge result-badge-${draftReviewStatusById[draft.email_id] ?? 'pending'}`}>
                      {draftReviewStatusById[draft.email_id] ?? 'pending'}
                    </span>
                  </div>
                  <h3>{draft.subject}</h3>
                  <p>{draft.body}</p>
                  <div className="story-actions">
                    <button
                      className="hud-button hud-button-primary"
                      disabled={
                        (draftReviewStatusById[draft.email_id] ?? 'pending') === 'sent' ||
                        sendingDraftIds.has(draft.email_id)
                      }
                      onClick={() => onSendDraft(draft.email_id)}
                      type="button"
                    >
                      {sendingDraftIds.has(draft.email_id) ? 'Sending...' : 'Send'}
                    </button>
                    <button
                      className="hud-button"
                      disabled={(draftReviewStatusById[draft.email_id] ?? 'pending') === 'sent'}
                      onClick={() => onToggleSkipDraft(draft.email_id)}
                      type="button"
                    >
                      {(draftReviewStatusById[draft.email_id] ?? 'pending') === 'skipped' ? 'Unskip' : 'Skip'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="finale-column finale-column-compact">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Route trace</p>
                <h3>Choices that shaped the send</h3>
              </div>
              <span className="source-chip">{routeSummary.length} locks</span>
            </div>

            <div className="route-list">
              {routeSummary.map(step => (
                <article className="route-card" key={step.id}>
                  <strong>{step.title}</strong>
                  <p>{step.subtitle}</p>
                </article>
              ))}
            </div>
          </div>
        </div>

        {error ? <p className="story-error">{error}</p> : null}
      </div>
    </section>
  )
}

function GameShell({
  userId,
  userLabel,
  onLogout,
}: {
  userId: string
  userLabel: string
  onLogout: () => Promise<void>
}) {
  const {
    mode,
    runStage,
    sessionId,
    scene,
    trace,
    drafts,
    previewEmails,
    previewSource,
    sendResults,
    draftReviewStatusById,
    sendingDraftIds,
    done,
    error,
    isStarting,
    isAdvancing,
    isResolving,
    isPreviewVisible,
    chooseOption,
    sendDraft,
    toggleSkipDraft,
    finishReview,
    beginRun,
    restart,
  } = useSceneLoader({ userId })
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
  const [runtimeControls, setRuntimeControls] = useState<GameRuntimeControls | null>(null)
  const [interactionTarget, setInteractionTarget] = useState<SceneNpc | null>(null)
  const [hudCollapsed, setHudCollapsed] = useState(true)
  const isCoarsePointer = useCoarsePointer()

  const isBusy = isStarting || isAdvancing || isResolving || runStage === 'sending'
  const showWorld = !isPreviewVisible
  const showHud = runStage === 'playing'
  const showFinale = isResolving || runStage === 'review' || runStage === 'sending' || runStage === 'sent'
  const showMobileControls = showWorld && showHud && !isOpen && !isBusy && isCoarsePointer
  const remainingNpcCount = useMemo(() => {
    if (!previewEmails.length) {
      return scene.npcs.length
    }

    const selectedEmailIds = new Set(previewEmails.map(email => email.id))
    const completedEmailIds = new Set(
      trace.flatMap(step => step.related_email_ids).filter(emailId => selectedEmailIds.has(emailId)),
    )

    return Math.max(0, previewEmails.length - completedEmailIds.size)
  }, [previewEmails, scene.npcs.length, trace])
  const canInteract = Boolean(interactionTarget) && !isBusy && !isOpen
  const previewStage =
    runStage === 'generating'
      ? 'generating'
      : runStage === 'ready'
        ? 'ready'
        : 'previewing'
  const previewSelectionKey = previewEmails.map(email => email.id).join('|') || 'empty'
  const finaleStage: 'review' | 'sending' | 'sent' =
    runStage === 'sending' || runStage === 'sent' ? runStage : 'review'

  useEffect(() => {
    stopDialogueAudio()
  }, [scene.sceneId, stopDialogueAudio])

  useEffect(() => {
    if (!showMobileControls) {
      runtimeControls?.clearMoveInput()
    }
  }, [runtimeControls, showMobileControls])

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
      const selected = activeNpc.choices.find(choice => choice.id === choiceId)
      await chooseOption({
        npcId: activeNpc.id,
        choiceId,
        choiceContext: selected?.nextSceneId ? `next_location:${selected.nextSceneId}` : '',
      })
      closeDialogue()
    },
    [activeNpc, chooseOption, closeDialogue, stopDialogueAudio],
  )

  const handleRestart = useCallback(() => {
    stopDialogueAudio()
    closeDialogue()
    restart()
  }, [closeDialogue, restart, stopDialogueAudio])

  const handleSendDraft = useCallback(
    (emailId: string) => {
      void sendDraft(emailId)
    },
    [sendDraft],
  )
  const handleToggleSkipDraft = useCallback((emailId: string) => {
    toggleSkipDraft(emailId)
  }, [toggleSkipDraft])
  const handleFinishReview = useCallback(() => {
    finishReview()
  }, [finishReview])
  const handleRuntimeReady = useCallback((controls: GameRuntimeControls | null) => {
    setRuntimeControls(controls)
  }, [])
  const handleInteractionTargetChange = useCallback((npc: SceneNpc | null) => {
    setInteractionTarget(npc)
  }, [])
  const handleMobileMove = useCallback(
    (x: number, y: number) => {
      runtimeControls?.setMoveInput(x, y)
    },
    [runtimeControls],
  )
  const handleMobileMoveEnd = useCallback(() => {
    runtimeControls?.clearMoveInput()
  }, [runtimeControls])
  const handleMobileInteract = useCallback(() => {
    runtimeControls?.interact()
  }, [runtimeControls])
  const interactionHint = isCoarsePointer
    ? 'Walk up to the active NPC and tap Talk to lock in a route.'
    : 'Walk up to the active NPC and press `E` to lock in a route.'
  const interactionLabel = interactionTarget ? `Talk to ${interactionTarget.name}` : 'Move closer'

  return (
    <main className={`app-shell app-shell-${runStage}`}>
      <div className="session-pill">
        <span className="session-initial">{userLabel[0]}</span>
        <span className="session-details">
          <span className="session-user">{userLabel}</span>
          <button className="session-logout" type="button" onClick={() => void onLogout()}>
            Logout
          </button>
        </span>
      </div>

      {showHud ? (
        <div className="run-progress-pill">
          <span className="run-progress-label">Emails left</span>
          <strong>{remainingNpcCount}</strong>
        </div>
      ) : null}

      {showWorld ? (
        <WorldCanvas
          scene={scene}
          dialogueOpen={isOpen || showFinale}
          activeNpcId={activeNpcId}
          onControlsReady={handleRuntimeReady}
          onInteractionTargetChange={handleInteractionTargetChange}
          onNpcInteract={handleNpcInteract}
        />
      ) : (
        <div className="world-placeholder" />
      )}

      {showHud ? (
        <section className={`story-hud ${hudCollapsed && isCoarsePointer ? 'story-hud--collapsed' : ''}`}>
          <div
            className="story-status-card"
            onClick={isCoarsePointer ? () => setHudCollapsed(c => !c) : undefined}
          >
            <p className="eyebrow">Story route</p>
            {!(hudCollapsed && isCoarsePointer) ? (
              <>
                <h1 className="story-title">{scene.title}</h1>
                <p className="story-objective">{scene.objective}</p>

                <div className="story-meta">
                  <span>Mode: {mode}</span>
                  <span>Choices locked: {trace.length}</span>
                  <span>Emails left: {remainingNpcCount}</span>
                  <span>
                    {scene.world
                      ? `Location: ${scene.world.locationId} (${scene.world.visitedLocationIds.length} visited)`
                      : 'Location: bootstrap'}
                  </span>
                  <span>{scene.world ? `Planner: ${scene.world.plannerSource}` : 'Planner: pending'}</span>
                  <span>{scene.world ? `Seed: ${scene.world.runSeed}` : 'Seed: -'}</span>
                  <span>{sessionId ? 'Session live' : 'No session yet'}</span>
                </div>

                {scene.completionMessage ? (
                  <p className="story-completion">{scene.completionMessage}</p>
                ) : null}

                {error ? <p className="story-error">{error}</p> : null}

                <div className="story-actions">
                  <button className="hud-button" onClick={(e) => { e.stopPropagation(); handleRestart(); }} type="button" disabled={isBusy}>
                    Restart run
                  </button>
                </div>

                {isAdvancing ? <p className="story-note">Locking in the next branch.</p> : null}
                {!done && !isAdvancing ? (
                  <p className="story-note">{interactionHint}</p>
                ) : null}
              </>
            ) : (
              <p className="story-collapsed-hint">Tap to expand</p>
            )}
          </div>
        </section>
      ) : null}

      {showMobileControls ? (
        <MobileControls
          canInteract={canInteract}
          disabled={!runtimeControls}
          interactLabel={interactionLabel}
          onInteract={handleMobileInteract}
          onMoveEnd={handleMobileMoveEnd}
          onMoveInput={handleMobileMove}
        />
      ) : null}

      {isPreviewVisible ? (
        <PreludeOverlay
          key={`${previewStage}:${previewSelectionKey}`}
          userLabel={userLabel}
          emails={previewEmails}
          source={previewSource}
          stage={previewStage}
          error={error}
          onRetry={handleRestart}
          onBeginRun={beginRun}
        />
      ) : null}

      {showFinale ? (
        <FinaleOverlay
          drafts={drafts}
          trace={trace}
          sendResults={sendResults}
          draftReviewStatusById={draftReviewStatusById}
          sendingDraftIds={sendingDraftIds}
          runStage={finaleStage}
          isResolving={isResolving}
          error={error}
          onSendDraft={handleSendDraft}
          onToggleSkipDraft={handleToggleSkipDraft}
          onFinishReview={handleFinishReview}
          onRetryDraft={handleSendDraft}
          onRestart={handleRestart}
        />
      ) : null}

      {showWorld && runStage === 'playing' ? (
        <DialogueOverlay
          npc={activeNpc}
          visibleLine={visibleLine}
          isAdvancing={isAdvancing}
          audioStatus={dialogueAudioStatus}
          audioError={dialogueAudioError}
          onClose={handleCloseDialogue}
          onChoose={handleChoice}
        />
      ) : null}
    </main>
  )
}

function App() {
  const { session, isLoading, authError, beginGoogleLogin, logout } = useSession()

  if (isLoading) {
    return (
      <main className="loading-shell">
        <p className="auth-brand">Inbox Quest</p>
        <p className="auth-kicker">Loading</p>
        <h1 className="auth-title">Getting your session ready.</h1>
        <p className="auth-copy">This only takes a moment.</p>
      </main>
    )
  }

  if (!session.authenticated) {
    return <AuthGate authError={authError} onContinue={beginGoogleLogin} />
  }

  if (!session.user?.id) {
    return <AuthGate authError="Session is missing user identity. Sign in again." onContinue={beginGoogleLogin} />
  }

  const userLabel = session.user?.name ?? session.user?.email ?? 'Player'
  const userId = session.user.id

  return <GameShell userId={userId} userLabel={userLabel} onLogout={logout} />
}

export default App
