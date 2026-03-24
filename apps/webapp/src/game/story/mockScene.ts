import type { ScenePayload } from './types'

export const startSceneId = 'inbox-arrival'

export const mockScenes: Record<string, ScenePayload> = {
  'inbox-arrival': {
    sceneId: 'inbox-arrival',
    title: 'Inbox Arrival',
    objective: 'Talk to the loudest emails first and walk into the door matching your reply path.',
    environment: {
      theme: 'inboxPlaza',
      spawn: { x: 0, y: 0, z: 8 },
    },
    npcs: [
      {
        id: 'rhea-standup',
        name: 'Rhea',
        emailId: 'thread-standup',
        position: { x: -5, y: 0, z: 3 },
        openingLine:
          'Standup starts in ten minutes. I need a crisp status email, but you decide if we sound calm, bold, or delightfully proactive.',
        appearance: {
          shirtColor: 0x6c8cff,
          pantsColor: 0x1b2334,
          accentColor: 0xc5d4ff,
        },
        choices: [
          {
            id: 'calm-status',
            label: 'Calm update',
            previewReply:
              'Share what shipped, note what is blocked, and reassure them the next step is already underway.',
            nextSceneId: 'follow-up-row',
            doorPosition: { x: -8, y: 0, z: 6 },
          },
          {
            id: 'bold-status',
            label: 'Bold shipped',
            previewReply:
              'Lead with momentum, mention what landed, and frame the blocker as a fast follow instead of a crisis.',
            nextSceneId: 'follow-up-row',
            doorPosition: { x: -5, y: 0, z: 6 },
          },
          {
            id: 'proactive-status',
            label: 'Propose sync',
            previewReply:
              'Offer a short sync, summarize decisions in writing, and make the reply feel like progress instead of admin.',
            nextSceneId: 'follow-up-row',
            doorPosition: { x: -2, y: 0, z: 6 },
          },
        ],
      },
      {
        id: 'mika-customer',
        name: 'Mika',
        emailId: 'thread-refund',
        position: { x: 0, y: 0, z: -4 },
        openingLine:
          'A customer wants a refund and a timeline in the same breath. Choose whether we de-escalate, empathize, or steer them toward the win condition.',
        appearance: {
          shirtColor: 0x45c4a1,
          pantsColor: 0x18342e,
          accentColor: 0xaef6d7,
        },
        choices: [
          {
            id: 'refund-empathy',
            label: 'Empathy first',
            previewReply:
              'Acknowledge the frustration, confirm the refund path, and give a simple timeline without sounding robotic.',
            nextSceneId: 'follow-up-row',
            doorPosition: { x: -3, y: 0, z: -1 },
          },
          {
            id: 'refund-fix',
            label: 'Offer a save',
            previewReply:
              'Suggest the fastest fix, keep the refund option open, and ask for one clear piece of information to unblock support.',
            nextSceneId: 'follow-up-row',
            doorPosition: { x: 3, y: 0, z: -1 },
          },
        ],
      },
      {
        id: 'sol-finance',
        name: 'Sol',
        emailId: 'thread-invoice',
        position: { x: 5, y: 0, z: 3 },
        openingLine:
          'Finance is poking about an invoice that fell into a dimension of silence. Pick the version that nudges without turning the thread into a courtroom.',
        appearance: {
          shirtColor: 0xf2b84d,
          pantsColor: 0x3d2812,
          accentColor: 0xffedb0,
        },
        choices: [
          {
            id: 'invoice-direct',
            label: 'Direct nudge',
            previewReply:
              'Confirm the amount, restate the due date, and ask for a short acknowledgement so the thread is moving again.',
            nextSceneId: 'follow-up-row',
            doorPosition: { x: 3, y: 0, z: 6 },
          },
          {
            id: 'invoice-soft',
            label: 'Soft nudge',
            previewReply:
              'Keep it warm, assume good intent, and offer to resend the details so nobody has to search old attachments.',
            nextSceneId: 'follow-up-row',
            doorPosition: { x: 7, y: 0, z: 6 },
          },
        ],
      },
    ],
  },
  'follow-up-row': {
    sceneId: 'follow-up-row',
    title: 'Follow-Up Row',
    objective: 'Push the inbox forward with tighter choices before the final boss scene.',
    environment: {
      theme: 'cityBlock',
      spawn: { x: 0, y: 0, z: 9 },
    },
    npcs: [
      {
        id: 'juno-founder',
        name: 'Juno',
        emailId: 'thread-founder',
        position: { x: -6, y: 0, z: -1 },
        openingLine:
          'The founder wants a reply that sounds high agency without promising the moon. Decide how sharp we want the edges of this answer to be.',
        appearance: {
          shirtColor: 0xed6d5f,
          pantsColor: 0x342220,
          accentColor: 0xffc7bf,
        },
        choices: [
          {
            id: 'founder-brief',
            label: 'Short, decisive',
            previewReply:
              'Answer with three lines: the decision, the reason, and the exact next step that is already scheduled.',
            nextSceneId: 'victory-lap',
            doorPosition: { x: -9, y: 0, z: 2 },
          },
          {
            id: 'founder-context',
            label: 'Context-rich',
            previewReply:
              'Add one paragraph of context, one tradeoff, and one explicit confidence signal so the reply feels grounded.',
            nextSceneId: 'victory-lap',
            doorPosition: { x: -5, y: 0, z: 2 },
          },
        ],
      },
      {
        id: 'teo-design',
        name: 'Teo',
        emailId: 'thread-design',
        position: { x: 0, y: 0, z: 5 },
        openingLine:
          'Design needs a yes or no on a mockup pass. Do we respond with constraints, enthusiasm, or a fast lane compromise?',
        appearance: {
          shirtColor: 0x9d74ff,
          pantsColor: 0x251944,
          accentColor: 0xe6ddff,
        },
        choices: [
          {
            id: 'design-yes',
            label: 'Approve + limits',
            previewReply:
              'Say yes, keep the timeline protected, and pin the review to one narrow goal instead of a general polish round.',
            nextSceneId: 'victory-lap',
            doorPosition: { x: -2, y: 0, z: 3 },
          },
          {
            id: 'design-fastlane',
            label: 'Fast lane',
            previewReply:
              'Ask for the smallest revision that unblocks launch and promise a deeper pass only after the current milestone.',
            nextSceneId: 'victory-lap',
            doorPosition: { x: 2, y: 0, z: 3 },
          },
        ],
      },
      {
        id: 'niko-sales',
        name: 'Niko',
        emailId: 'thread-prospect',
        position: { x: 6, y: 0, z: -1 },
        openingLine:
          'Sales wants a reply that sounds custom, not templated. Pick the angle that will make this prospect feel seen in one pass.',
        appearance: {
          shirtColor: 0x5ea8ff,
          pantsColor: 0x17273f,
          accentColor: 0xcce6ff,
        },
        choices: [
          {
            id: 'sales-story',
            label: 'Their story',
            previewReply:
              'Mirror the prospect pain point, connect it to one clear product benefit, and suggest a single next action.',
            nextSceneId: 'victory-lap',
            doorPosition: { x: 5, y: 0, z: 2 },
          },
          {
            id: 'sales-proof',
            label: 'Lead with proof',
            previewReply:
              'Use one sharp example, keep the CTA light, and make the response feel personal rather than polished-for-everyone.',
            nextSceneId: 'victory-lap',
            doorPosition: { x: 9, y: 0, z: 2 },
          },
        ],
      },
    ],
  },
  'victory-lap': {
    sceneId: 'victory-lap',
    title: 'Victory Lap',
    objective: 'Wrap the run, bank the trace, and either loop again or send the final bundle.',
    completionMessage: 'Inbox route locked. You can now flatten this trace into the final email batch.',
    environment: {
      theme: 'inboxPlaza',
      spawn: { x: 0, y: 0, z: 7 },
    },
    npcs: [
      {
        id: 'beast-announcer',
        name: 'Inbox Beast',
        emailId: 'thread-summary',
        position: { x: 0, y: 0, z: 0 },
        openingLine:
          'You threaded the day into a clean route. Pick whether we celebrate, review the sent path, or jump back in for another speedrun.',
        appearance: {
          shirtColor: 0x58c47f,
          pantsColor: 0x162a21,
          accentColor: 0xd9ffe5,
          scale: 1.08,
        },
        choices: [
          {
            id: 'celebrate',
            label: 'Celebrate',
            previewReply:
              'Show the trace, flash the celebration banner, and make the user feel like they just combo-chained the hardest threads.',
            nextSceneId: 'victory-lap',
            doorPosition: { x: -3, y: 0, z: -3 },
          },
          {
            id: 'restart-run',
            label: 'Run again',
            previewReply:
              'Reset to the first plaza scene and let the player rehearse the flow before the real backend is wired in.',
            nextSceneId: 'inbox-arrival',
            doorPosition: { x: 3, y: 0, z: -3 },
          },
        ],
      },
    ],
  },
}
