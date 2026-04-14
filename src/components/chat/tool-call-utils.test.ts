import { describe, expect, it } from 'vitest'
import {
  isDuplicatePlanTextBlock,
  resolvePlanContent,
  splitTextAroundPlan,
} from './tool-call-utils'
import type { ToolCall } from '@/types/chat'

describe('splitTextAroundPlan', () => {
  it('separates prose before a trailing plan block', () => {
    expect(
      splitTextAroundPlan(
        'Repo inspected.\n\nPlan:\n- Implement changes\n- Add tests'
      )
    ).toEqual({
      beforePlan: 'Repo inspected.',
      plan: 'Plan:\n- Implement changes\n- Add tests',
    })
  })

  it('returns the full text as non-plan content when no plan heading exists', () => {
    expect(splitTextAroundPlan('Repo inspected.')).toEqual({
      beforePlan: 'Repo inspected.',
      plan: null,
    })
  })
})

describe('resolvePlanContent', () => {
  it('extracts only the plan section from assistant text when tool only has explanation', () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'plan-1',
        name: 'CodexPlan',
        input: {
          explanation: 'Repo inspected. Native plan had no prose body.',
          steps: [{ step: 'Clarify scope', status: 'in_progress' }],
        },
      },
    ]

    expect(
      resolvePlanContent({
        toolCalls,
        messageContent:
          'Repo inspected.\n\nPlan:\n- Implement changes\n- Add tests',
      })
    ).toEqual({
      content: 'Plan:\n- Implement changes\n- Add tests',
      source: 'message_text',
    })
  })

  it('keeps tool-provided plan content ahead of assistant text', () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'plan-1',
        name: 'CodexPlan',
        input: {
          plan: 'Plan:\n- Tool plan wins',
          explanation: 'Fallback explanation',
        },
      },
    ]

    expect(
      resolvePlanContent({
        toolCalls,
        messageContent: 'Plan:\n- Message text loses',
      })
    ).toEqual({
      content: 'Plan:\n- Tool plan wins',
      source: 'plan',
    })
  })

  it('ignores non-string tool plan payloads and falls back to assistant text', () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'plan-1',
        name: 'CodexPlan',
        input: {
          plan: [{ step: 'Wrong runtime shape' }],
          explanation: 'Summary only',
          steps: [{ step: 'Clarify scope', status: 'in_progress' }],
        },
      },
    ]

    expect(
      resolvePlanContent({
        toolCalls,
        messageContent:
          'Repo inspected.\n\nPlan:\n- Remove auto-continue\n- Add tests',
      })
    ).toEqual({
      content: 'Plan:\n- Remove auto-continue\n- Add tests',
      source: 'message_text',
    })
  })

  it('extracts a plan section from fragmented text blocks before explanation fallback', () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'plan-1',
        name: 'CodexPlan',
        input: {
          explanation: 'Summary only',
          steps: [{ step: 'Clarify scope', status: 'in_progress' }],
        },
      },
    ]

    expect(
      resolvePlanContent({
        toolCalls,
        contentBlocks: [
          { type: 'text', text: 'Repo inspected.\n\n' },
          { type: 'text', text: 'Plan:\n- Remove auto-continue' },
          { type: 'text', text: '\n- Add tests' },
        ],
      })
    ).toEqual({
      content: 'Plan:\n- Remove auto-continue\n- Add tests',
      source: 'message_text',
    })
  })
})

describe('isDuplicatePlanTextBlock', () => {
  it('matches blocks whose extracted plan equals resolved plan content', () => {
    expect(
      isDuplicatePlanTextBlock(
        'Repo inspected.\n\nPlan:\n- Implement changes',
        'Plan:\n- Implement changes'
      )
    ).toBe(true)
  })

  it('does not hide different assistant text just because it contains a plan heading', () => {
    expect(
      isDuplicatePlanTextBlock(
        'Repo inspected.\n\nPlan:\n- Implement changes\n- Add tests',
        'Plan:\n- Implement changes'
      )
    ).toBe(false)
  })

  it('matches Cursor CLI plan text that has no "Plan:" prefix (direct equality)', () => {
    const planText =
      '1. Do you want me to switch out of plan mode and implement now?\n\n- a) Yes, proceed\n- b) No, stay in plan mode'
    expect(isDuplicatePlanTextBlock(planText, planText)).toBe(true)
  })

  it('does not suppress unrelated text even when a plan exists', () => {
    expect(
      isDuplicatePlanTextBlock(
        'Here is some intro text.',
        '1. Do you want me to switch out of plan mode?'
      )
    ).toBe(false)
  })
})
