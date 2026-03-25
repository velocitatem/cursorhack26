import { mockScenes } from './mockScene'
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
  type EmailDraft,
  type EmailItem,
  type InboxPreviewResponse,
  type ResolveResponse,
  type SendResponse,
  type StartSceneRequest,
  type StartSceneResponse,
  type StoryScene,
  type TraceStep,
} from './schemas'

type StoryProvider = {
  readonly mode: 'stub'
  preview: (request?: StartSceneRequest) => Promise<InboxPreviewResponse>
  start: (request?: StartSceneRequest) => Promise<StartSceneResponse>
  advance: (sessionId: string, request: AdvanceSceneRequest) => Promise<AdvanceSceneResponse>
  resolve: (sessionId: string) => Promise<ResolveResponse>
  sendAll: (sessionId: string) => Promise<SendResponse>
  sendDraft: (sessionId: string, emailId: string) => Promise<DraftSendResult>
}

type StubSession = {
  sceneIndex: number
  emails: EmailItem[]
  trace: TraceStep[]
}

const stubDelay = (ms = 140) =>
  new Promise<void>(resolve => {
    window.setTimeout(resolve, ms)
  })

const toIntent = (value: string) => value.replace(/-/g, '_')
const toTransitions = (choices: { id: string }[], nextLocationId: string) =>
  Object.fromEntries(choices.map(choice => [choice.id, nextLocationId]))

const pickNpc = (sceneId: keyof typeof mockScenes) => mockScenes[sceneId].npcs[0]

const inboxNpc = pickNpc('inbox-arrival')
const followUpNpc = pickNpc('follow-up-row')
const victoryNpc = pickNpc('victory-lap')

const defaultInbox: EmailItem[] = [
  {
    id: inboxNpc.emailId,
    sender: 'rhea@ultiplate.dev',
    subject: 'Standup status before ten',
    snippet: 'Need a crisp progress update before the team sync.',
    body: 'Can you send a tight update before standup with shipped work, blockers, and the next step?',
  },
  {
    id: followUpNpc.emailId,
    sender: 'juno@ultiplate.dev',
    subject: 'Founder follow-up',
    snippet: 'Need a confident reply with a sharp next step.',
    body: 'Reply with the decision, why it is the right call, and what happens next without overpromising.',
  },
]

const storyScenes: StoryScene[] = [
  {
    scene_id: mockScenes['inbox-arrival'].sceneId,
    npc_id: inboxNpc.id,
    npc_name: inboxNpc.name,
    dialogue: inboxNpc.openingLine,
    tts: '',
    choices: inboxNpc.choices.map(choice => ({
      slug: choice.id,
      label: choice.label,
      intent: toIntent(choice.id),
    })),
    is_terminal: false,
    related_email_ids: [inboxNpc.emailId],
    environment: {
      theme: 'inboxPlaza',
      spawn: { x: 0, y: 0, z: 8 },
    },
    npcs: [],
    choice_transitions: toTransitions(inboxNpc.choices, 'follow-up-row'),
  },
  {
    scene_id: mockScenes['follow-up-row'].sceneId,
    npc_id: followUpNpc.id,
    npc_name: followUpNpc.name,
    dialogue: followUpNpc.openingLine,
    tts: '',
    choices: followUpNpc.choices.map(choice => ({
      slug: choice.id,
      label: choice.label,
      intent: toIntent(choice.id),
    })),
    is_terminal: false,
    related_email_ids: [followUpNpc.emailId],
    environment: {
      theme: 'cityBlock',
      spawn: { x: 0, y: 0, z: 9 },
    },
    npcs: [],
    choice_transitions: toTransitions(followUpNpc.choices, 'victory-lap'),
  },
  {
    scene_id: mockScenes['victory-lap'].sceneId,
    npc_id: victoryNpc.id,
    npc_name: victoryNpc.name,
    dialogue: victoryNpc.openingLine,
    tts: '',
    choices: [],
    is_terminal: true,
    related_email_ids: defaultInbox.map(email => email.id),
    environment: {
      theme: 'inboxPlaza',
      spawn: { x: 0, y: 0, z: 8 },
    },
    npcs: [],
    choice_transitions: {},
  },
]

const sessions = new Map<string, StubSession>()

const buildDrafts = (emails: EmailItem[], trace: TraceStep[]): EmailDraft[] =>
  emails.map(email => {
    const intents = trace
      .filter(step => step.related_email_ids.includes(email.id))
      .map(step => step.choice_intent.replace(/_/g, ' '))
    const routeTone = intents.length ? intents.join(', ') : 'steady follow-up'

    return {
      email_id: email.id,
      to: email.sender,
      subject: `Re: ${email.subject}`,
      body: `Thanks for the note. I am following up with a ${routeTone} reply path so this thread keeps moving today.`,
    }
  })

const getSceneForIndex = (index: number) => storyScenes[Math.min(index, storyScenes.length - 1)]

const assertChoice = (scene: StoryScene, choiceSlug: string) => {
  const choice = scene.choices.find(entry => entry.slug === choiceSlug)
  if (!choice) {
    throw new Error(`Stub story rejected unknown choice "${choiceSlug}".`)
  }
  return choice
}

export const createStubStoryProvider = (): StoryProvider => ({
  mode: 'stub',

  async preview(request = {}) {
    await stubDelay()
    const payload = startSceneRequestSchema.parse(request)
    return inboxPreviewResponseSchema.parse({
      emails: payload.inbox_override ?? defaultInbox,
      source: payload.inbox_override ? 'override' : 'mock',
    })
  },

  async start(request = {}) {
    await stubDelay()
    const payload = startSceneRequestSchema.parse(request)
    const sessionId = `stub-session-${crypto.randomUUID()}`
    const emails = payload.inbox_override ?? defaultInbox
    sessions.set(sessionId, { sceneIndex: 0, emails, trace: [] })
    return startSceneResponseSchema.parse({
      session_id: sessionId,
      scene: getSceneForIndex(0),
      trace: [],
      done: false,
    })
  },

  async advance(sessionId, request) {
    await stubDelay()
    const payload = advanceSceneRequestSchema.parse(request)
    const session = sessions.get(sessionId)
    if (!session) {
      throw new Error(`Stub story session "${sessionId}" was not found.`)
    }

    const currentScene = getSceneForIndex(session.sceneIndex)
    if (currentScene.is_terminal) {
      return advanceSceneResponseSchema.parse({
        scene: currentScene,
        trace: session.trace,
        done: true,
      })
    }

    const choice = assertChoice(currentScene, payload.choice_slug)
    const nextTrace = [
      ...session.trace,
      {
        scene_id: currentScene.scene_id,
        npc_id: currentScene.npc_id,
        choice_slug: choice.slug,
        choice_intent: choice.intent,
        choice_context: '',
        related_email_ids: currentScene.related_email_ids,
        from_location_id: '',
        to_location_id: '',
      },
    ]
    const nextSceneIndex = Math.min(session.sceneIndex + 1, storyScenes.length - 1)
    const nextScene = getSceneForIndex(nextSceneIndex)

    sessions.set(sessionId, {
      ...session,
      sceneIndex: nextSceneIndex,
      trace: nextTrace,
    })

    return advanceSceneResponseSchema.parse({
      scene: nextScene,
      trace: nextTrace,
      done: nextScene.is_terminal,
    })
  },

  async resolve(sessionId) {
    await stubDelay()
    const session = sessions.get(sessionId)
    if (!session) {
      throw new Error(`Stub story session "${sessionId}" was not found.`)
    }
    if (!session.trace.length) {
      throw new Error('Play through at least one choice before resolving drafts.')
    }

    return resolveResponseSchema.parse({
      session_id: sessionId,
      drafts: buildDrafts(session.emails, session.trace),
    })
  },

  async sendAll(sessionId) {
    await stubDelay(520)
    const session = sessions.get(sessionId)
    if (!session) {
      throw new Error(`Stub story session "${sessionId}" was not found.`)
    }

    return sendResponseSchema.parse({
      session_id: sessionId,
      results: buildDrafts(session.emails, session.trace).map(draft => ({
        email_id: draft.email_id,
        thread_id: null,
        gmail_message_id: `stub-msg-${crypto.randomUUID()}`,
        status: 'sent',
        error: null,
      })),
    })
  },

  async sendDraft(_sessionId, emailId) {
    await stubDelay(400)
    return draftSendResultSchema.parse({
      email_id: emailId,
      thread_id: null,
      gmail_message_id: `stub-msg-${crypto.randomUUID()}`,
      status: 'sent',
    })
  },
})
