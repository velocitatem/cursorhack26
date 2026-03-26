import { StoryApiClient, getDefaultStoryApiBaseUrl } from './api'
import type {
  AdvanceSceneRequest,
  AdvanceSceneResponse,
  DraftSendResult,
  InboxPreviewResponse,
  ResolveResponse,
  SendResponse,
  StartSceneRequest,
  StartSceneResponse,
} from './schemas'

export type StoryApiMode = 'backend'

export type StoryProvider = {
  readonly mode: StoryApiMode
  preview: (request: StartSceneRequest) => Promise<InboxPreviewResponse>
  start: (request: StartSceneRequest) => Promise<StartSceneResponse>
  advance: (sessionId: string, request: AdvanceSceneRequest) => Promise<AdvanceSceneResponse>
  resolve: (sessionId: string) => Promise<ResolveResponse>
  sendAll: (sessionId: string) => Promise<SendResponse>
  sendDraft: (sessionId: string, emailId: string) => Promise<DraftSendResult>
}

export const getStoryApiMode = (): StoryApiMode => 'backend'

export const createStoryProvider = (): StoryProvider => {
  const mode = getStoryApiMode()
  const client = new StoryApiClient(getDefaultStoryApiBaseUrl())
  return {
    mode,
    preview: request => client.preview(request),
    start: request => client.start(request),
    advance: (sessionId, request) => client.advance(sessionId, request),
    resolve: sessionId => client.resolve(sessionId),
    sendAll: sessionId => client.sendAll(sessionId),
    sendDraft: (sessionId, emailId) => client.sendDraft(sessionId, emailId),
  }
}
