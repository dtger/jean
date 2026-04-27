import { describe, expect, it } from 'vitest'
import { fuzzySearchFiles, fuzzySearchItems } from './fuzzy-search'
import type { WorktreeFile } from '@/types/chat'

describe('fuzzySearchItems', () => {
  const baseItems = [
    { name: 'Plan Session', description: 'Create a plan', keywords: ['plan'] },
    {
      name: 'Open Settings',
      description: 'Jump to preferences',
      keywords: ['settings'],
    },
    {
      name: 'Focus Chat',
      description: 'Focus on chat input',
      keywords: ['chat'],
    },
  ]

  it('ranks an exact name match ahead of description matches', () => {
    const results = fuzzySearchItems(baseItems, 'plan')
    const top = results[0]
    if (!top) throw new Error('expected at least one result for "plan"')
    expect(top.name).toBe('Plan Session')
  })

  it('returns the canonical list when query is empty', () => {
    const results = fuzzySearchItems(baseItems, '')
    expect(results).toHaveLength(3)
    const top = results[0]
    if (!top) throw new Error('expected first result to exist when query empty')
    expect(top.name).toBe('Plan Session')
  })

  it('falls back to description keywords when the name is not the best match', () => {
    const results = fuzzySearchItems(baseItems, 'preferences')
    const top = results[0]
    if (!top) throw new Error('expected matches for "preferences"')
    expect(top.name).toBe('Open Settings')
  })
})

describe('fuzzySearchFiles', () => {
  const files: WorktreeFile[] = [
    { relative_path: 'docs/guide.md', extension: 'md', is_dir: false },
    {
      relative_path: 'src/components/Search.tsx',
      extension: 'tsx',
      is_dir: false,
    },
    { relative_path: 'src/utils/fuzzy.ts', extension: 'ts', is_dir: false },
  ]

  it('returns the leading files when the query is empty', () => {
    const results = fuzzySearchFiles(files, '')
    expect(results).toHaveLength(3)
  })

  it('filters results by relative path', () => {
    const results = fuzzySearchFiles(files, 'search')
    expect(results).toHaveLength(1)
    const first = results[0]
    if (!first) throw new Error('expected search result')
    expect(first.relative_path).toBe('src/components/Search.tsx')
  })
})
