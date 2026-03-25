import { z } from 'zod'

export const emailItemSchema = z.object({
  id: z.string(),
  sender: z.string(),
  subject: z.string(),
  snippet: z.string().default(''),
  body: z.string().default(''),
  thread_id: z.string().nullable().optional(),
})

export const sceneChoiceSchema = z.object({
  slug: z.string().min(1),
  label: z.string().min(1),
  intent: z.string().min(1).default('neutral'),
})

export const sceneSchema = z.object({
  scene_id: z.string().min(1),
  npc_id: z.string().min(1),
  npc_name: z.string().min(1),
  dialogue: z.string().min(1),
  tts: z.string().default(''),
  voice_id: z.string().nullable().optional(),
  choices: z.array(sceneChoiceSchema).default([]),
  is_terminal: z.boolean().default(false),
  related_email_ids: z.array(z.string()).default([]),
})

export const traceStepSchema = z.object({
  scene_id: z.string(),
  npc_id: z.string().default(''),
  choice_slug: z.string(),
  choice_intent: z.string().default('neutral'),
  related_email_ids: z.array(z.string()).default([]),
})

export const startSceneRequestSchema = z.object({
  user_id: z.string().default('demo-user'),
  inbox_override: z.array(emailItemSchema).nullable().optional(),
})

export const inboxPreviewResponseSchema = z.object({
  emails: z.array(emailItemSchema),
  source: z.enum(['gmail', 'mock', 'override']),
})

export const advanceSceneRequestSchema = z.object({
  choice_slug: z.string().min(1),
})

export const startSceneResponseSchema = z.object({
  session_id: z.string(),
  scene: sceneSchema,
  trace: z.array(traceStepSchema),
  done: z.boolean(),
})

export const advanceSceneResponseSchema = z.object({
  scene: sceneSchema,
  trace: z.array(traceStepSchema),
  done: z.boolean(),
})

export const emailDraftSchema = z.object({
  email_id: z.string(),
  to: z.string(),
  subject: z.string(),
  body: z.string(),
})

export const resolveResponseSchema = z.object({
  session_id: z.string(),
  drafts: z.array(emailDraftSchema),
})

export const draftSendResultSchema = z.object({
  email_id: z.string(),
  thread_id: z.string().nullable(),
  gmail_message_id: z.string().nullable(),
  status: z.enum(['sent', 'failed']),
  error: z.string().nullable().optional(),
})

export const sendResponseSchema = z.object({
  session_id: z.string(),
  results: z.array(draftSendResultSchema),
})

export type EmailItem = z.infer<typeof emailItemSchema>
export type SceneChoice = z.infer<typeof sceneChoiceSchema>
export type StoryScene = z.infer<typeof sceneSchema>
export type TraceStep = z.infer<typeof traceStepSchema>
export type StartSceneRequest = z.input<typeof startSceneRequestSchema>
export type InboxPreviewResponse = z.infer<typeof inboxPreviewResponseSchema>
export type AdvanceSceneRequest = z.input<typeof advanceSceneRequestSchema>
export type StartSceneResponse = z.infer<typeof startSceneResponseSchema>
export type AdvanceSceneResponse = z.infer<typeof advanceSceneResponseSchema>
export type EmailDraft = z.infer<typeof emailDraftSchema>
export type ResolveResponse = z.infer<typeof resolveResponseSchema>
export type DraftSendResult = z.infer<typeof draftSendResultSchema>
export type SendResponse = z.infer<typeof sendResponseSchema>
