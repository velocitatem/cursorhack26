import { ZodError } from 'zod'
import {
  advanceSceneRequestSchema,
  advanceSceneResponseSchema,
  draftSendResultSchema,
  inboxPreviewResponseSchema,
  resolveResponseSchema,
  sendResponseSchema,
  startSceneRequestSchema,
  startSceneResponseSchema,
  type AdvanceSceneRequest,
  type AdvanceSceneResponse,
  type DraftSendResult,
  type InboxPreviewResponse,
  type ResolveResponse,
  type SendResponse,
  type StartSceneRequest,
  type StartSceneResponse,
} from './schemas'

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '')
const absoluteUrlPattern = /^https?:\/\//i
const relativePathPattern = /^\//

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

const formatValidationError = (label: string, error: ZodError) =>
  `Invalid ${label} payload from story API: ${error.issues.map(issue => issue.message).join(', ')}`

export class StoryApiClient {
  readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = normalizeBaseUrl(baseUrl)
  }

  private async request<TResponse>(
    path: string,
    init: RequestInit,
    parse: (value: unknown) => TResponse,
  ): Promise<TResponse> {
    const response = await fetch(`${this.baseUrl}${path}`, init)

    if (!response.ok) {
      const detail = await getResponseDetail(response)
      throw new Error(`Story API ${path} failed (${response.status}): ${detail}`)
    }

    const payload = (await response.json()) as unknown
    return parse(payload)
  }

  async start(request: StartSceneRequest = {}): Promise<StartSceneResponse> {
    const body = startSceneRequestSchema.parse(request)
    return this.request(
      '/story/scene/start',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      payload => {
        try {
          return startSceneResponseSchema.parse(payload)
        } catch (error) {
          if (error instanceof ZodError) {
            throw new Error(formatValidationError('/story/scene/start', error))
          }
          throw error
        }
      },
    )
  }

  async preview(request: StartSceneRequest = {}): Promise<InboxPreviewResponse> {
    const body = startSceneRequestSchema.parse(request)
    return this.request(
      '/story/scene/preview',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      payload => {
        try {
          return inboxPreviewResponseSchema.parse(payload)
        } catch (error) {
          if (error instanceof ZodError) {
            throw new Error(formatValidationError('/story/scene/preview', error))
          }
          throw error
        }
      },
    )
  }

  async advance(sessionId: string, request: AdvanceSceneRequest): Promise<AdvanceSceneResponse> {
    const body = advanceSceneRequestSchema.parse(request)
    return this.request(
      `/story/scene/${sessionId}/advance`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      payload => {
        try {
          return advanceSceneResponseSchema.parse(payload)
        } catch (error) {
          if (error instanceof ZodError) {
            throw new Error(formatValidationError('/story/scene/:session_id/advance', error))
          }
          throw error
        }
      },
    )
  }

  async resolve(sessionId: string): Promise<ResolveResponse> {
    return this.request(
      `/story/scene/${sessionId}/resolve`,
      { method: 'POST' },
      payload => {
        try {
          return resolveResponseSchema.parse(payload)
        } catch (error) {
          if (error instanceof ZodError) {
            throw new Error(formatValidationError('/story/scene/:session_id/resolve', error))
          }
          throw error
        }
      },
    )
  }

  async sendDraft(sessionId: string, emailId: string): Promise<DraftSendResult> {
    return this.request(
      `/story/scene/${sessionId}/send/${emailId}`,
      { method: 'POST' },
      payload => {
        try {
          return draftSendResultSchema.parse(payload)
        } catch (error) {
          if (error instanceof ZodError) {
            throw new Error(formatValidationError('/story/scene/:session_id/send/:email_id', error))
          }
          throw error
        }
      },
    )
  }

  async sendAll(sessionId: string): Promise<SendResponse> {
    return this.request(
      `/story/scene/${sessionId}/send`,
      { method: 'POST' },
      payload => {
        try {
          return sendResponseSchema.parse(payload)
        } catch (error) {
          if (error instanceof ZodError) {
            throw new Error(formatValidationError('/story/scene/:session_id/send', error))
          }
          throw error
        }
      },
    )
  }
}

export const getDefaultStoryApiBaseUrl = () =>
  (() => {
    const configured = import.meta.env.VITE_STORY_API_BASE_URL?.trim()
    if (configured) {
      if (absoluteUrlPattern.test(configured)) {
        return '/api'
      }
      return normalizeBaseUrl(configured)
    }
    return '/api'
  })()

export const resolveStoryAssetUrl = (path: string) => {
  if (!path) {
    return ''
  }
  if (absoluteUrlPattern.test(path)) {
    return path
  }
  const normalizedPath = relativePathPattern.test(path) ? path : `/${path}`
  const baseUrl = getDefaultStoryApiBaseUrl()
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath
}
