import { StoryApiClient, getDefaultStoryApiBaseUrl } from './api'
import type {
  AdvanceSceneRequest,
  AdvanceSceneResponse,
  DraftSendResult,
  ResolveResponse,
  StartSceneRequest,
  StartSceneResponse,
} from './schemas'
import { createStubStoryProvider } from './stubData'

export type StoryApiMode = 'backend' | 'stub'

export type StoryProvider = {
  readonly mode: StoryApiMode
  start: (request?: StartSceneRequest) => Promise<StartSceneResponse>
  advance: (sessionId: string, request: AdvanceSceneRequest) => Promise<AdvanceSceneResponse>
  resolve: (sessionId: string) => Promise<ResolveResponse>
  sendDraft: (sessionId: string, emailId: string) => Promise<DraftSendResult>
}

export const getStoryApiMode = (): StoryApiMode =>
  import.meta.env.VITE_STORY_API_MODE === 'stub' ? 'stub' : 'backend'

export const createStoryProvider = (): StoryProvider => {
  const mode = getStoryApiMode()
  if (mode === 'backend') {
    const client = new StoryApiClient(getDefaultStoryApiBaseUrl())
    return {
      mode,
      start: request => client.start(request),
      advance: (sessionId, request) => client.advance(sessionId, request),
      resolve: sessionId => client.resolve(sessionId),
      sendDraft: (sessionId, emailId) => client.sendDraft(sessionId, emailId),
    }
  }
  return createStubStoryProvider()
}
