import { afterEach, describe, expect, it } from 'vitest'
import {
  getPreferenceSearchEntries,
  searchPreferenceEntries,
} from './preferences-search'

const nativeOnlyEntryIds = [
  'general-claude-cli',
  'general-github-cli',
  'general-codex-cli',
  'general-opencode-cli',
  'general-troubleshooting',
  'web-access-server',
  'web-access-authentication',
]

const setTauriInternals = (enabled: boolean) => {
  if (enabled) {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    })
  } else {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__
  }
}

describe('preferences search index', () => {
  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__
  })

  it('omits native-only sections in browser builds', () => {
    setTauriInternals(false)

    nativeOnlyEntryIds.forEach(id => {
      expect(getPreferenceSearchEntries().some(entry => entry.id === id)).toBe(
        false
      )
    })

    expect(
      searchPreferenceEntries('application logs').some(
        entry => entry.id === 'general-troubleshooting'
      )
    ).toBe(false)
  })

  it('includes native-only sections in the desktop app', () => {
    setTauriInternals(true)

    nativeOnlyEntryIds.forEach(id => {
      expect(getPreferenceSearchEntries().some(entry => entry.id === id)).toBe(
        true
      )
    })

    expect(
      searchPreferenceEntries('application logs').some(
        entry => entry.id === 'general-troubleshooting'
      )
    ).toBe(true)
  })

  it('returns relevant appearance hits for font queries', () => {
    setTauriInternals(false)
    const results = searchPreferenceEntries('appearance font')

    expect(results.some(entry => entry.id === 'appearance-fonts')).toBe(true)
  })
})
