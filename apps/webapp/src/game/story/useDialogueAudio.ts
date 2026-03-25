import { useCallback, useEffect, useRef, useState } from 'react'
import { resolveStoryAssetUrl } from './api'
import type { SceneNpc } from './types'

export type DialogueAudioStatus = 'idle' | 'loading' | 'playing' | 'error'

const defaultRetryAfterMs = 1000

const getResponseDetail = async (response: Response) => {
  const text = await response.text()
  if (!text) {
    return response.statusText || 'Request failed.'
  }
  try {
    const payload = JSON.parse(text) as { detail?: unknown }
    if (payload.detail !== undefined) {
      return typeof payload.detail === 'string' ? payload.detail : JSON.stringify(payload.detail)
    }
  } catch {
    return text
  }
  return text
}

const parseRetryAfterMs = (value: string | null) => {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : defaultRetryAfterMs
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    const abort = () => {
      window.clearTimeout(timeout)
      reject(new DOMException('Request aborted.', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
  })

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === 'AbortError'

const fetchReadyAudioBlob = async (url: string, signal: AbortSignal) => {
  while (true) {
    const response = await fetch(url, { method: 'GET', signal })
    if (response.status === 202) {
      await wait(parseRetryAfterMs(response.headers.get('Retry-After')), signal)
      continue
    }
    if (!response.ok) {
      const detail = await getResponseDetail(response)
      throw new Error(`NPC voice request failed (${response.status}): ${detail}`)
    }
    return response.blob()
  }
}

const getAudioDuration = (audio: HTMLAudioElement) =>
  Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null

export const useDialogueAudio = () => {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const requestIdRef = useRef(0)
  const [status, setStatus] = useState<DialogueAudioStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState<number | null>(null)

  const clearObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }, [])

  const resetAudioElement = useCallback(() => {
    const audio = audioRef.current
    if (!audio) {
      return
    }
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    clearObjectUrl()
    setCurrentTime(0)
    setDuration(null)
  }, [clearObjectUrl])

  const cancelPending = useCallback(() => {
    requestIdRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const stop = useCallback(() => {
    cancelPending()
    resetAudioElement()
    setError(null)
    setStatus('idle')
  }, [cancelPending, resetAudioElement])

  const playNpc = useCallback(async (npc: SceneNpc | null) => {
    if (!npc?.ttsUrl) {
      stop()
      return false
    }

    cancelPending()
    resetAudioElement()

    const requestId = requestIdRef.current
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setStatus('loading')

    try {
      const blob = await fetchReadyAudioBlob(resolveStoryAssetUrl(npc.ttsUrl), controller.signal)
      if (controller.signal.aborted || requestId !== requestIdRef.current) {
        return false
      }

      const audio = audioRef.current
      if (!audio) {
        return false
      }

      clearObjectUrl()
      objectUrlRef.current = URL.createObjectURL(blob)
      audio.src = objectUrlRef.current
      audio.currentTime = 0
      audio.load()
      await audio.play()
      if (controller.signal.aborted || requestId !== requestIdRef.current) {
        return false
      }
      return true
    } catch (error) {
      if (isAbortError(error) || requestId !== requestIdRef.current) {
        return false
      }
      setError(error instanceof Error ? error.message : 'Unable to play NPC voice.')
      setStatus('error')
      return false
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
      }
    }
  }, [cancelPending, clearObjectUrl, resetAudioElement, stop])

  useEffect(() => {
    const audio = new Audio()
    audio.preload = 'auto'
    audioRef.current = audio

    const syncTime = () => setCurrentTime(audio.currentTime)
    const syncDuration = () => setDuration(getAudioDuration(audio))
    const handlePlaying = () => {
      syncDuration()
      setStatus('playing')
    }
    const handlePause = () => {
      syncTime()
      setStatus(current => (current === 'playing' ? 'idle' : current))
    }
    const handleEnded = () => {
      setCurrentTime(audio.duration || audio.currentTime)
      setStatus('idle')
    }
    const handleError = () => {
      setError('Unable to play NPC voice.')
      setStatus('error')
    }

    audio.addEventListener('timeupdate', syncTime)
    audio.addEventListener('loadedmetadata', syncDuration)
    audio.addEventListener('durationchange', syncDuration)
    audio.addEventListener('playing', handlePlaying)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('error', handleError)

    return () => {
      audio.removeEventListener('timeupdate', syncTime)
      audio.removeEventListener('loadedmetadata', syncDuration)
      audio.removeEventListener('durationchange', syncDuration)
      audio.removeEventListener('playing', handlePlaying)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('error', handleError)
      cancelPending()
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      clearObjectUrl()
      audioRef.current = null
    }
  }, [cancelPending, clearObjectUrl])

  return {
    status,
    error,
    currentTime,
    duration,
    playNpc,
    stop,
  }
}
