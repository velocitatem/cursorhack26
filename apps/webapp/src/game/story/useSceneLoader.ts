import { useCallback, useEffect, useState } from 'react'
import { createPlaceholderScene, toScenePayload } from './adapters'
import { createStoryProvider } from './provider'
import type { EmailDraft, TraceStep } from './schemas'
import type { ChoiceSelection } from './types'

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong while talking to the story service.'

export const useSceneLoader = () => {
  const [provider] = useState(() => createStoryProvider())
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [scene, setScene] = useState(() => createPlaceholderScene())
  const [trace, setTrace] = useState<TraceStep[]>([])
  const [drafts, setDrafts] = useState<EmailDraft[]>([])
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

  const start = useCallback(async () => {
    setIsStarting(true)
    setIsAdvancing(false)
    setIsResolving(false)
    setError(null)
    setDone(false)
    setSessionId(null)
    setTrace([])
    setDrafts([])
    setScene(createPlaceholderScene())

    try {
      const response = await provider.start({ user_id: 'demo-user' })
      setSessionId(response.session_id)
      applyScene(response)
    } catch (error) {
      setScene(
        createPlaceholderScene(
          'Story Route Offline',
          'Check the backend connection or flip to stub mode and restart the run.',
        ),
      )
      setError(getErrorMessage(error))
    } finally {
      setIsStarting(false)
    }
  }, [applyScene, provider])

  useEffect(() => {
    void start()
  }, [start])

  const chooseOption = useCallback(async (selection: ChoiceSelection) => {
    if (!sessionId) {
      return scene
    }

    setIsAdvancing(true)
    setError(null)
    try {
      const response = await provider.advance(sessionId, { choice_slug: selection.choiceId })
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

  const restart = useCallback(() => {
    void start()
  }, [start])

  return {
    mode: provider.mode,
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
  }
}
