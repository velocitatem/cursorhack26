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
  emails: EmailItem[]
  trace: TraceStep[]
  resolvedEmailIds: string[]
}

const stubDelay = (ms = 140) =>
  new Promise<void>(resolve => {
    window.setTimeout(resolve, ms)
  })

const stubChoices = [
  { slug: 'reply_now', label: 'Reply now', intent: 'agree_immediately' },
  { slug: 'send_polished_reply', label: 'Send polished reply', intent: 'confident_response' },
  { slug: 'defer', label: 'Defer politely', intent: 'ask_for_more_time' },
]
const stubPositions = [
  { x: -7, y: 0, z: 1 },
  { x: -3, y: 0, z: -4 },
  { x: 1, y: 0, z: 3 },
  { x: 5, y: 0, z: -3 },
  { x: 8, y: 0, z: 2 },
]

const defaultInbox: EmailItem[] = [
  {
    id: 'email-1',
    sender: 'rhea@ultiplate.dev',
    subject: 'Standup status before ten',
    snippet: 'Need a crisp progress update before the team sync.',
    body: 'Can you send a tight update before standup with shipped work, blockers, and the next step?',
  },
  {
    id: 'email-2',
    sender: 'juno@ultiplate.dev',
    subject: 'Founder follow-up',
    snippet: 'Need a confident reply with a sharp next step.',
    body: 'Reply with the decision, why it is the right call, and what happens next without overpromising.',
  },
  {
    id: 'email-3',
    sender: 'ops@ultiplate.dev',
    subject: 'Approve vendor payment',
    snippet: 'Need a same-day answer on whether to release the payment.',
    body: 'Reply with a clear yes or no, mention the amount, and ask for any missing invoice details if needed.',
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

const buildStubScene = (emails: EmailItem[], resolvedEmailIds: string[]): StoryScene => {
  const unresolvedEmails = emails.filter(email => !resolvedEmailIds.includes(email.id))
  const npcs = unresolvedEmails.map((email, index) => ({
    id: email.id,
    name: email.sender.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase()),
    email_id: email.id,
    position: stubPositions[index % stubPositions.length],
    opening_line: `${email.subject}. ${email.snippet || email.body || 'This thread needs your answer today.'}`,
    tts: '',
    choices: stubChoices.map(choice => ({ ...choice })),
    related_email_ids: [email.id],
  }))
  const primaryNpc = npcs[0]

  return {
    scene_id: `stub-hub-${resolvedEmailIds.length}`,
    npc_id: primaryNpc?.id ?? 'narrator',
    npc_name: primaryNpc?.name ?? 'Inbox Narrator',
    dialogue: primaryNpc?.opening_line ?? 'Every inbox contact has been handled. Move to final review.',
    tts: '',
    choices: primaryNpc?.choices ?? [],
    is_terminal: unresolvedEmails.length === 0,
    related_email_ids: unresolvedEmails.map(email => email.id),
    environment: {
      theme: 'inboxPlaza',
      spawn: { x: 0, y: 0, z: 8 },
    },
    npcs,
    choice_transitions: {},
  }
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
    sessions.set(sessionId, { emails, trace: [], resolvedEmailIds: [] })
    return startSceneResponseSchema.parse({
      session_id: sessionId,
      scene: buildStubScene(emails, []),
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

    const currentScene = buildStubScene(session.emails, session.resolvedEmailIds)
    if (currentScene.is_terminal) {
      return advanceSceneResponseSchema.parse({
        scene: currentScene,
        trace: session.trace,
        done: true,
      })
    }

    const activeNpc = currentScene.npcs.find(npc => npc.id === payload.npc_id) ?? currentScene.npcs[0]
    const choice = activeNpc?.choices.find(entry => entry.slug === payload.choice_slug)
    if (!activeNpc || !choice) {
      throw new Error(`Stub story rejected unknown choice "${payload.choice_slug}" for npc "${payload.npc_id}".`)
    }
    const nextTrace = [
      ...session.trace,
      {
        scene_id: currentScene.scene_id,
        npc_id: activeNpc.id,
        choice_slug: choice.slug,
        choice_intent: choice.intent,
        choice_context: '',
        related_email_ids: activeNpc.related_email_ids,
        from_location_id: 'hub',
        to_location_id: 'hub',
      },
    ]
    const nextResolvedEmailIds = [...session.resolvedEmailIds, activeNpc.email_id]
    const nextScene = buildStubScene(session.emails, nextResolvedEmailIds)

    sessions.set(sessionId, {
      ...session,
      trace: nextTrace,
      resolvedEmailIds: nextResolvedEmailIds,
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
