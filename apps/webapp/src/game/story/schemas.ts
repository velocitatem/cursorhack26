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

const sceneVectorSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
})

const sceneBoundsSchema = z.object({
  minX: z.number().int(),
  maxX: z.number().int(),
  minZ: z.number().int(),
  maxZ: z.number().int(),
})

const sceneBlockSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int(),
  type: z.string().min(1),
})

const sceneLayoutSchema = z.object({
  seed: z.number().int().default(0),
  bounds: sceneBoundsSchema,
  blocks: z.array(sceneBlockSchema).default([]),
})

const sceneEnvironmentSchema = z.object({
  theme: z.string().default('inboxPlaza'),
  spawn: sceneVectorSchema,
  layout: sceneLayoutSchema.nullable().optional(),
})

const sceneWorldSchema = z.object({
  world_id: z.string().min(1),
  location_id: z.string().min(1),
  visited_location_ids: z.array(z.string()).default([]),
  planner_source: z.string().default('fallback'),
  run_seed: z.number().int().default(0),
})

const sceneNpcSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email_id: z.string().min(1),
  position: sceneVectorSchema,
  opening_line: z.string().min(1),
  tts: z.string().default(''),
  voice_id: z.string().nullable().optional(),
  choices: z.array(sceneChoiceSchema).default([]),
  related_email_ids: z.array(z.string()).default([]),
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
  environment: sceneEnvironmentSchema.default({
    theme: 'inboxPlaza',
    spawn: { x: 0, y: 0, z: 8 },
  }),
  world: sceneWorldSchema.nullable().optional(),
  npcs: z.array(sceneNpcSchema).default([]),
  choice_transitions: z.record(z.string(), z.string()).default({}),
})

export const traceStepSchema = z.object({
  scene_id: z.string(),
  npc_id: z.string().default(''),
  choice_slug: z.string(),
  choice_intent: z.string().default('neutral'),
  choice_context: z.string().default(''),
  related_email_ids: z.array(z.string()).default([]),
  from_location_id: z.string().default(''),
  to_location_id: z.string().default(''),
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
  npc_id: z.string().default(''),
  choice_slug: z.string().min(1),
  choice_context: z.string().optional(),
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
