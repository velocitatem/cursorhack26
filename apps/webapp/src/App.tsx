import { useCallback, useEffect, useState } from 'react'
import './App.css'
import { AuthGate } from './auth/AuthGate'
import { useSession } from './auth/useSession'
import { DialogueOverlay } from './components/DialogueOverlay'
import { WorldCanvas } from './components/WorldCanvas'
import { useDialogueAudio } from './game/story/useDialogueAudio'
import { useDialogueState } from './game/story/useDialogueState'
import { useSceneLoader } from './game/story/useSceneLoader'
import type { DraftSendResult, EmailDraft, EmailItem, InboxPreviewResponse, TraceStep } from './game/story/schemas'
import type { SceneNpc } from './game/story/types'

const previewSourceLabels: Record<InboxPreviewResponse['source'], string> = {
  gmail: 'Live Gmail',
  mock: 'Demo Inbox',
  override: 'Loaded Inbox',
}

const toReadableLabel = (value: string) =>
  value
    .split(/[_-]+/)
    .filter(Boolean)
    .map(part => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')

function PreludeOverlay({
  userLabel,
  emails,
  source,
  mode,
  stage,
  error,
  onRetry,
  onBeginRun,
}: {
  userLabel: string
  emails: EmailItem[]
  source: InboxPreviewResponse['source']
  mode: string
  stage: 'previewing' | 'ready' | 'generating'
  error: string | null
  onRetry: () => void
  onBeginRun: (emails: EmailItem[]) => void
}) {
  const [selectedEmails, setSelectedEmails] = useState<EmailItem[]>(emails)
  useEffect(() => { if (stage === 'ready') setSelectedEmails(emails) }, [stage, emails])
  const removeEmail = (id: string) => setSelectedEmails(prev => prev.filter(e => e.id !== id))

  const statusTitle = error
    ? 'The route generator stalled.'
    : stage === 'generating'
      ? 'Forging the city from today\u2019s inbox.'
      : stage === 'ready'
        ? 'Your inbox is ready.'
        : 'Scanning today\u2019s threads.'

  const statusCopy = error
    ? 'Retry the run and the game will rebuild from the same inbox preview flow.'
    : stage === 'generating'
      ? 'Emails are being turned into characters, dialogue, and branching reply paths.'
      : stage === 'ready'
        ? 'Remove any threads you want to skip, then start the run.'
        : 'Pulling in today\u2019s most important threads before the world opens.'

  const metrics = [
    { label: 'Selected', value: selectedEmails.length.toString().padStart(2, '0') },
    { label: 'Source', value: previewSourceLabels[source] },
    { label: 'Mode', value: mode === 'stub' ? 'Demo' : 'Live' },
  ]
  const skeletonIds = Array.from({ length: 4 }, (_, index) => `skeleton-${index}`)

  return (
    <section className="prelude-overlay" data-stage={stage}>
      <div className="prelude-chrome" />
      <div className="prelude-grid">
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

        <div className="prelude-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Today&apos;s inbox</p>
              <h2>Threads entering the run</h2>
            </div>
            <span className="source-chip">{previewSourceLabels[source]}</span>
          </div>

          <div className="prelude-email-list">
            {stage === 'previewing'
              ? skeletonIds.map(id => (
                <article className="prelude-email-card prelude-email-skeleton" key={id}>
                  <span />
                  <span />
                  <span />
                </article>
              ))
              : selectedEmails.map((email, index) => (
                <article className="prelude-email-card" key={email.id} style={{ animationDelay: `${index * 90}ms` }}>
                  <div className="prelude-email-meta">
                    <span>{email.sender}</span>
                    <span>Today</span>
                    {stage === 'ready' ? (
                      <button className="prelude-email-remove" onClick={() => removeEmail(email.id)} type="button">
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <h3>{email.subject}</h3>
                  <p>{email.snippet || email.body || 'This thread will become part of the route.'}</p>
                </article>
              ))}
          </div>
        </div>

        <div className="prelude-status-card">
          <div className="status-ring" aria-hidden="true" />
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
            <div className="prelude-start-cta">
              <button
                className="hud-button hud-button-primary"
                disabled={!selectedEmails.length}
                onClick={() => onBeginRun(selectedEmails)}
                type="button"
              >
                Start the run
              </button>
            </div>
          ) : (
            <p className="story-note">The world opens automatically as soon as the first story scene is ready.</p>
          )}
        </div>
      </div>
    </section>
  )
}

function FinaleOverlay({
  drafts,
  trace,
  sendResults,
  runStage,
  isResolving,
  error,
  onSendSelected,
  onRetryDraft,
  onRestart,
}: {
  drafts: EmailDraft[]
  trace: TraceStep[]
  sendResults: DraftSendResult[]
  runStage: 'review' | 'sending' | 'sent'
  isResolving: boolean
  error: string | null
  onSendSelected: (emailIds: string[]) => void
  onRetryDraft: (emailId: string) => void
  onRestart: () => void
}) {
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(
    () => new Set(drafts.map(d => d.email_id))
  )
  const toggleDraft = (id: string) => setSelectedDraftIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const selectedCount = selectedDraftIds.size
  const routeSummary = trace.map(step => ({
    id: `${step.scene_id}:${step.choice_slug}`,
    title: toReadableLabel(step.choice_slug),
    subtitle: toReadableLabel(step.choice_intent || step.scene_id),
  }))

  const resultsByEmailId = new Map(sendResults.map(result => [result.email_id, result]))
  const sentCount = sendResults.filter(result => result.status === 'sent').length
  const failedCount = sendResults.filter(result => result.status === 'failed').length

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
                {sentCount} sent{failedCount ? `, ${failedCount} still need attention.` : '. Every routed reply made it out.'}
              </p>
            </div>
            <button className="hud-button" onClick={onRestart} type="button">
              New run
            </button>
          </div>

          <div className="finale-summary-strip">
            <span>{drafts.length} drafts reviewed</span>
            <span>{sentCount} sent</span>
            <span>{failedCount} failed</span>
          </div>

          <div className="finale-list">
            {drafts.map(draft => {
              const result = resultsByEmailId.get(draft.email_id)
              const status = result?.status ?? 'failed'
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
                    <span>{result?.gmail_message_id ? `Message ${result.gmail_message_id}` : 'Awaiting provider id'}</span>
                    <span>{result?.thread_id ? `Thread ${result.thread_id}` : 'Thread id pending'}</span>
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
            <p className="prelude-copy">Review the bundle, then send the full set through the agent in one action.</p>
          </div>
          <div className="finale-actions">
            <button className="hud-button" onClick={onRestart} type="button">
              Restart run
            </button>
            <button
              className="hud-button hud-button-primary"
              disabled={!selectedCount}
              onClick={() => onSendSelected(Array.from(selectedDraftIds))}
              type="button"
            >
              Send {selectedCount} {selectedCount === 1 ? 'reply' : 'replies'}
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
              <span className="source-chip">{selectedCount} of {drafts.length} selected</span>
            </div>

            <div className="finale-list">
              {drafts.map(draft => {
                const included = selectedDraftIds.has(draft.email_id)
                return (
                  <article
                    className={`finale-email-card${included ? '' : ' finale-email-card-excluded'}`}
                    key={draft.email_id}
                  >
                    <p className="draft-to">To: {draft.to}</p>
                    <h3>{draft.subject}</h3>
                    <p>{draft.body}</p>
                    <button
                      className={`email-toggle${included ? ' email-toggle-on' : ''}`}
                      onClick={() => toggleDraft(draft.email_id)}
                      type="button"
                    >
                      {included ? 'Include' : 'Skip'}
                    </button>
                  </article>
                )
              })}
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
    done,
    error,
    isStarting,
    isAdvancing,
    isResolving,
    isPreviewVisible,
    chooseOption,
    sendDraft,
    sendSelectedDrafts,
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

  const isBusy = isStarting || isAdvancing || isResolving || runStage === 'sending'
  const showWorld = !isPreviewVisible
  const showHud = runStage === 'playing'
  const showFinale = isResolving || runStage === 'review' || runStage === 'sending' || runStage === 'sent'
  const previewStage: 'previewing' | 'ready' | 'generating' =
    runStage === 'generating' ? 'generating' : runStage === 'ready' ? 'ready' : 'previewing'
  const finaleStage: 'review' | 'sending' | 'sent' =
    runStage === 'sending' || runStage === 'sent' ? runStage : 'review'

  useEffect(() => {
    stopDialogueAudio()
  }, [scene.sceneId, stopDialogueAudio])

  useEffect(() => {
    if (!activeNpc) {
      return
    }

    if (showFinale || activeNpc.choices.length === 0) {
      stopDialogueAudio()
      closeDialogue()
    }
  }, [activeNpc, closeDialogue, showFinale, stopDialogueAudio])

  const handleNpcInteract = useCallback(
    (npc: SceneNpc) => {
      if (!npc.choices.length) {
        return
      }
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

  const handleRestart = useCallback(() => {
    stopDialogueAudio()
    closeDialogue()
    restart()
  }, [closeDialogue, restart, stopDialogueAudio])

  const handleBeginRun = useCallback(
    (emails: EmailItem[]) => { void beginRun(emails) },
    [beginRun],
  )

  const handleSendSelected = useCallback(
    (emailIds: string[]) => { void sendSelectedDrafts(emailIds) },
    [sendSelectedDrafts],
  )

  const handleRetryDraft = useCallback(
    (emailId: string) => {
      void sendDraft(emailId)
    },
    [sendDraft],
  )

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

      {showWorld ? (
        <WorldCanvas
          scene={scene}
          dialogueOpen={isOpen || showFinale}
          activeNpcId={activeNpcId}
          onNpcInteract={handleNpcInteract}
        />
      ) : (
        <div className="world-placeholder" />
      )}

      {showHud ? (
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
            </div>

            {isAdvancing ? <p className="story-note">Locking in the next branch.</p> : null}
            {!done && !isAdvancing ? (
              <p className="story-note">Walk up to the active NPC and press `E` to lock in a route.</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {isPreviewVisible ? (
        <PreludeOverlay
          userLabel={userLabel}
          emails={previewEmails}
          source={previewSource}
          mode={mode}
          stage={previewStage}
          error={error}
          onRetry={handleRestart}
          onBeginRun={handleBeginRun}
        />
      ) : null}

      {showFinale ? (
        <FinaleOverlay
          drafts={drafts}
          trace={trace}
          sendResults={sendResults}
          runStage={finaleStage}
          isResolving={isResolving}
          error={error}
          onSendSelected={handleSendSelected}
          onRetryDraft={handleRetryDraft}
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
  const userId = session.user?.id ?? 'demo-user'

  return <GameShell userId={userId} userLabel={userLabel} onLogout={logout} />
}

export default App
