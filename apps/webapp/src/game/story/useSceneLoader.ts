import { useCallback, useEffect, useState } from 'react'
import { createPlaceholderScene, toScenePayload } from './adapters'
import { createStoryProvider } from './provider'
import type {
  DraftSendResult,
  EmailDraft,
  EmailItem,
  InboxPreviewResponse,
  SendResponse,
  TraceStep,
} from './schemas'
import type { ChoiceSelection } from './types'

type RunStage = 'previewing' | 'ready' | 'generating' | 'playing' | 'review' | 'sending' | 'sent'

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

    let cancelled = false

    const resolve = async () => {
      const response = await resolveDrafts()
      if (!cancelled && response?.drafts) {
        setRunStage('review')
      }
    }

    void resolve()

    return () => {
      cancelled = true
    }
  }, [done, drafts.length, isResolving, resolveDrafts, runStage, sessionId])

  const sendAllDrafts = useCallback(async (): Promise<SendResponse | null> => {
    if (!sessionId || !drafts.length) {
      return null
    }

    setRunStage('sending')
    setError(null)
    try {
      const response = await provider.sendAll(sessionId)
      setSendResults(response.results)
      setRunStage('sent')
      return response
    } catch (error) {
      setError(getErrorMessage(error))
      setRunStage('review')
      return null
    }
  }, [drafts.length, provider, sessionId])

  const sendDraft = useCallback(async (emailId: string): Promise<DraftSendResult | null> => {
    if (!sessionId) return null

    try {
      const result = await provider.sendDraft(sessionId, emailId)
      setSendResults(previous => {
        if (!previous.length) {
          return [result]
        }
        return previous.map(entry => (entry.email_id === emailId ? result : entry))
      })
      return result
    } catch (error) {
      setError(getErrorMessage(error))
      return null
    }
  }, [provider, sessionId])

  const sendSelectedDrafts = useCallback(async (emailIds: string[]): Promise<SendResponse | null> => {
    if (!sessionId || !emailIds.length) {
      return null
    }

    setRunStage('sending')
    setError(null)

    const settled = await Promise.allSettled(
      emailIds.map(async emailId => {
        try {
          return await provider.sendDraft(sessionId, emailId)
        } catch (error) {
          return {
            email_id: emailId,
            thread_id: null,
            gmail_message_id: null,
            status: 'failed' as const,
            error: getErrorMessage(error),
          }
        }
      }),
    )

    const results = settled.map((entry, index) =>
      entry.status === 'fulfilled'
        ? entry.value
        : {
          email_id: emailIds[index],
          thread_id: null,
          gmail_message_id: null,
          status: 'failed' as const,
          error: getErrorMessage(entry.reason),
        })

    const response = {
      session_id: sessionId,
      results,
    }
    setSendResults(results)
    setRunStage('sent')
    return response
  }, [provider, sessionId])

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
    done,
    error,
    isStarting,
    isAdvancing,
    isResolving,
    isPreviewVisible: isPreviewVisible(runStage),
    chooseOption,
    resolveDrafts,
    sendAllDrafts,
    sendDraft,
    sendSelectedDrafts,
    beginRun,
    restart,
  }
}
