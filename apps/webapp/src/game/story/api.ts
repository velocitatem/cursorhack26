import { ZodError } from 'zod'
import {
  advanceSceneRequestSchema,
  advanceSceneResponseSchema,
  resolveResponseSchema,
  startSceneRequestSchema,
  startSceneResponseSchema,
  type AdvanceSceneRequest,
  type AdvanceSceneResponse,
  type ResolveResponse,
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
      {
        method: 'POST',
      },
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
}

export const getDefaultStoryApiBaseUrl = () =>
  (() => {
    const configured = import.meta.env.VITE_STORY_API_BASE_URL?.trim()
    if (configured) {
      if (import.meta.env.DEV && absoluteUrlPattern.test(configured)) {
        return ''
      }
      return normalizeBaseUrl(configured)
    }
    if (import.meta.env.DEV) {
      return 'http://localhost:9812'
    }
    return ''
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
