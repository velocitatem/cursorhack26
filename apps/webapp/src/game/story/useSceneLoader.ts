import { useCallback, useEffect, useState } from 'react'
import { createPlaceholderScene, toScenePayload } from './adapters'
import { createStoryProvider } from './provider'
import type {
  DraftSendResult,
  EmailDraft,
  EmailItem,
  InboxPreviewResponse,
  TraceStep,
} from './schemas'
import type { ChoiceSelection } from './types'

type RunStage = 'previewing' | 'ready' | 'generating' | 'playing' | 'review' | 'sending' | 'sent'
type DraftReviewStatus = 'pending' | 'skipped' | 'sent' | 'failed'

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong while talking to the story service.'

const isPreviewVisible = (stage: RunStage) =>
  stage === 'previewing' || stage === 'ready' || stage === 'generating'

export const useSceneLoader = ({ userId }: { userId?: string } = {}) => {
  const [provider] = useState(() => createStoryProvider())
  const [runStage, setRunStage] = useState<RunStage>('previewing')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [scene, setScene] = useState(() => createPlaceholderScene())
  const [trace, setTrace] = useState<TraceStep[]>([])
  const [drafts, setDrafts] = useState<EmailDraft[]>([])
  const [previewEmails, setPreviewEmails] = useState<EmailItem[]>([])
  const [previewSource, setPreviewSource] = useState<InboxPreviewResponse['source']>('mock')
  const [sendResults, setSendResults] = useState<DraftSendResult[]>([])
  const [draftReviewStatusById, setDraftReviewStatusById] = useState<Record<string, DraftReviewStatus>>({})
  const [sendingDraftIds, setSendingDraftIds] = useState<Set<string>>(() => new Set())
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(true)
  const [isAdvancing, setIsAdvancing] = useState(false)
  const [isResolving, setIsResolving] = useState(false)

  const applyScene = useCallback(
    (response: { scene: Parameters<typeof toScenePayload>[0]['scene']; trace: TraceStep[]; done: boolean }) => {
      const nextScene = toScenePayload(response)
      setScene(nextScene)
      setTrace(response.trace)
      setDone(response.done || response.scene.is_terminal)
      return nextScene
    },
    [],
  )

  const initPreview = useCallback(async () => {
    setIsStarting(true)
    setIsAdvancing(false)
    setIsResolving(false)
    setError(null)
    setDone(false)
    setRunStage('previewing')
    setSessionId(null)
    setTrace([])
    setDrafts([])
    setPreviewEmails([])
    setPreviewSource('mock')
    setSendResults([])
    setDraftReviewStatusById({})
    setSendingDraftIds(new Set())
    setScene(createPlaceholderScene())

    try {
      const preview = await provider.preview({ user_id: userId ?? 'demo-user' })
      const limitedEmails = preview.emails.slice(0, 5)
      setPreviewEmails(limitedEmails)
      setPreviewSource(preview.source)
      setRunStage('ready')

      if (!limitedEmails.length) {
        setError("No emails found for today's inbox.")
      }
    } catch (error) {
      setScene(
        createPlaceholderScene(
          'Story Route Offline',
          'Check the backend connection or retry the inbox run.',
        ),
      )
      setError(getErrorMessage(error))
      setRunStage('ready')
    } finally {
      setIsStarting(false)
    }
  }, [provider, userId])

  useEffect(() => {
    void initPreview()
  }, [initPreview])

  const beginRun = useCallback(async (emails: EmailItem[]) => {
    if (!emails.length) {
      setError('Choose at least one email to start the run.')
      return
    }

    setIsStarting(true)
    setError(null)
    setRunStage('generating')
    setPreviewEmails(emails)

    try {
      const response = await provider.start({
        user_id: userId ?? 'demo-user',
        inbox_override: emails,
      })
      setSessionId(response.session_id)
      applyScene(response)
      setRunStage('playing')
    } catch (error) {
      setError(getErrorMessage(error))
      setRunStage('ready')
    } finally {
      setIsStarting(false)
    }
  }, [applyScene, provider, userId])

  const chooseOption = useCallback(async (selection: ChoiceSelection) => {
    if (!sessionId) {
      return scene
    }

    setIsAdvancing(true)
    setError(null)
    try {
      const response = await provider.advance(sessionId, {
        choice_slug: selection.choiceId,
        choice_context: selection.choiceContext ?? '',
      })
      return applyScene(response)
    } catch (error) {
      setError(getErrorMessage(error))
      return scene
    } finally {
      setIsAdvancing(false)
    }
  }, [applyScene, provider, scene, sessionId])

  const resolveDrafts = useCallback(async () => {
    if (!sessionId || !done) {
      return null
    }

    setIsResolving(true)
    setError(null)
    try {
      const response = await provider.resolve(sessionId)
      setDrafts(response.drafts)
      setDraftReviewStatusById(
        Object.fromEntries(response.drafts.map(draft => [draft.email_id, 'pending' as const])),
      )
      setSendResults([])
      setRunStage('review')
      return response
    } catch (error) {
      setError(getErrorMessage(error))
      return null
    } finally {
      setIsResolving(false)
    }
  }, [done, provider, sessionId])

  useEffect(() => {
    if (!done || !sessionId || isResolving || drafts.length > 0 || runStage !== 'playing') {
      return
    }
    const resolve = async () => {
      await resolveDrafts()
    }

    void resolve()
  }, [done, drafts.length, isResolving, resolveDrafts, runStage, sessionId])

  const sendDraft = useCallback(async (emailId: string): Promise<DraftSendResult | null> => {
    if (!sessionId) return null

    setError(null)
    setSendingDraftIds(previous => new Set(previous).add(emailId))
    try {
      const result = await provider.sendDraft(sessionId, emailId)
      setSendResults(previous => {
        if (!previous.length) {
          return [result]
        }
        if (!previous.some(entry => entry.email_id === emailId)) {
          return [...previous, result]
        }
        return previous.map(entry => (entry.email_id === emailId ? result : entry))
      })
      setDraftReviewStatusById(previous => ({
        ...previous,
        [emailId]: result.status === 'sent' ? 'sent' : 'failed',
      }))
      return result
    } catch (error) {
      setError(getErrorMessage(error))
      setDraftReviewStatusById(previous => ({ ...previous, [emailId]: 'failed' }))
      return null
    } finally {
      setSendingDraftIds(previous => {
        const next = new Set(previous)
        next.delete(emailId)
        return next
      })
    }
  }, [provider, sessionId])

  const toggleSkipDraft = useCallback((emailId: string) => {
    setDraftReviewStatusById(previous => {
      const status = previous[emailId]
      if (status === 'sent') {
        return previous
      }
      return {
        ...previous,
        [emailId]: status === 'skipped' ? 'pending' : 'skipped',
      }
    })
  }, [])

  const finishReview = useCallback(() => {
    const hasPending = drafts.some(draft => (draftReviewStatusById[draft.email_id] ?? 'pending') === 'pending')
    if (hasPending) {
      setError('Review every draft before finishing. Send it or mark it as skipped.')
      return false
    }
    setError(null)
    setRunStage('sent')
    return true
  }, [draftReviewStatusById, drafts])

  const restart = useCallback(() => {
    void initPreview()
  }, [initPreview])

  return {
    mode: provider.mode,
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
    isPreviewVisible: isPreviewVisible(runStage),
    chooseOption,
    resolveDrafts,
    sendDraft,
    toggleSkipDraft,
    finishReview,
    beginRun,
    restart,
  }
}
