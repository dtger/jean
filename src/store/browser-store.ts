import { create } from 'zustand'
import { generateId } from '@/lib/uuid'
import type { BrowserTab, ModalBrowserDockMode } from '@/types/browser'
import { pickNonCollidingDock, type DockMode } from './dock-coordination'
import { useTerminalStore } from './terminal-store'

// Opaque white data: URL instead of about:blank — WKWebView renders about:blank
// as a transparent surface, so a previous tab's pixels can bleed through when
// switching tabs. data: URL forces a real opaque page.
export const DEFAULT_NEW_TAB_URL =
  'data:text/html;charset=utf-8,<!DOCTYPE html><html><head><title>New Tab</title></head><body style="margin:0;background:#fff"></body></html>'

// Treat any data: URL as blank — WebKit normalizes the placeholder URL
// (drops ;charset=utf-8, percent-encodes, splits the literal `#` as a fragment)
// and Tauri injects a CSP <meta>, so equality with DEFAULT_NEW_TAB_URL fails.
// Users cannot navigate to data: URLs in this app (normalizeUrl rejects them).
export const isBlankTabUrl = (u: string): boolean =>
  !u || u === 'about:blank' || u.startsWith('data:')
const DEFAULT_SIDE_PANE_WIDTH = 520
const DEFAULT_BOTTOM_PANEL_HEIGHT = 360
const DEFAULT_MODAL_WIDTH = 520
const DEFAULT_MODAL_HEIGHT = 400

interface BrowserState {
  // Per-worktree tab list
  tabs: Record<string, BrowserTab[]>
  // Active tab id per worktree
  activeTabIds: Record<string, string>

  // Side pane (Phase 1)
  sidePaneOpen: Record<string, boolean>
  sidePaneWidth: number

  // Modal drawer (Phase 2)
  modalOpen: Record<string, boolean>
  modalDockMode: ModalBrowserDockMode
  modalWidth: number
  modalHeight: number

  // Bottom panel (Phase 3)
  bottomPanelOpen: Record<string, boolean>
  bottomPanelHeight: number

  // Selectors
  getTabs: (worktreeId: string) => BrowserTab[]
  getActiveTab: (worktreeId: string) => BrowserTab | null
  isSidePaneOpen: (worktreeId: string) => boolean
  isModalOpen: (worktreeId: string) => boolean
  isBottomPanelOpen: (worktreeId: string) => boolean

  // Tab actions
  addTab: (worktreeId: string, url?: string) => string
  removeTab: (worktreeId: string, tabId: string) => void
  setActiveTab: (worktreeId: string, tabId: string) => void
  updateTab: (tabId: string, patch: Partial<Omit<BrowserTab, 'id'>>) => void
  setTabUrl: (tabId: string, url: string) => void
  setTabTitle: (tabId: string, title: string) => void
  setTabLoading: (tabId: string, loading: boolean) => void
  setTabError: (tabId: string, error: string | null) => void
  setRequestedUrl: (tabId: string, url: string | null) => void
  setLastLoadedUrl: (tabId: string, url: string | null) => void
  // Hydration (used by useUIStatePersistence on app load)
  hydrateTabs: (
    tabs: Record<string, BrowserTab[]>,
    activeTabIds: Record<string, string>
  ) => void

  // Side pane actions
  setSidePaneOpen: (worktreeId: string, open: boolean) => void
  toggleSidePane: (worktreeId: string) => void
  setSidePaneWidth: (width: number) => void

  // Modal actions
  setModalOpen: (worktreeId: string, open: boolean) => void
  toggleModal: (worktreeId: string) => void
  setModalDockMode: (mode: ModalBrowserDockMode) => void
  setModalWidth: (width: number) => void
  setModalHeight: (height: number) => void

  // Bottom panel actions
  setBottomPanelOpen: (worktreeId: string, open: boolean) => void
  toggleBottomPanel: (worktreeId: string) => void
  setBottomPanelHeight: (height: number) => void
}

function findWorktreeForTab(
  tabs: Record<string, BrowserTab[]>,
  tabId: string
): string | null {
  for (const [wid, list] of Object.entries(tabs)) {
    if (list.some(t => t.id === tabId)) return wid
  }
  return null
}

/** Pick a browser dock side that doesn't collide with the open terminal modal. */
function resolveBrowserDock(
  worktreeId: string,
  desired: ModalBrowserDockMode
): ModalBrowserDockMode {
  const terminal = useTerminalStore.getState()
  const otherOpen = terminal.modalTerminalOpen[worktreeId] ?? false
  return pickNonCollidingDock(
    desired as DockMode,
    otherOpen,
    terminal.modalTerminalDockMode as DockMode
  ) as ModalBrowserDockMode
}

export const useBrowserStore = create<BrowserState>((set, get) => ({
  tabs: {},
  activeTabIds: {},
  sidePaneOpen: {},
  sidePaneWidth: DEFAULT_SIDE_PANE_WIDTH,
  modalOpen: {},
  modalDockMode: 'floating',
  modalWidth: DEFAULT_MODAL_WIDTH,
  modalHeight: DEFAULT_MODAL_HEIGHT,
  bottomPanelOpen: {},
  bottomPanelHeight: DEFAULT_BOTTOM_PANEL_HEIGHT,

  getTabs: worktreeId => get().tabs[worktreeId] ?? [],

  getActiveTab: worktreeId => {
    const tabs = get().tabs[worktreeId] ?? []
    const activeId = get().activeTabIds[worktreeId]
    return tabs.find(t => t.id === activeId) ?? null
  },

  isSidePaneOpen: worktreeId => get().sidePaneOpen[worktreeId] ?? false,
  isModalOpen: worktreeId => get().modalOpen[worktreeId] ?? false,
  isBottomPanelOpen: worktreeId => get().bottomPanelOpen[worktreeId] ?? false,

  addTab: (worktreeId, url = DEFAULT_NEW_TAB_URL) => {
    const id = generateId()
    // about:blank loads instantly with no `browser:loaded` event — skip
    // the spinner state entirely so the tab pill doesn't stay loading.
    const tab: BrowserTab = {
      id,
      worktreeId,
      url,
      title: '',
      isLoading: !isBlankTabUrl(url),
      error: null,
    }
    set(state => ({
      tabs: {
        ...state.tabs,
        [worktreeId]: [...(state.tabs[worktreeId] ?? []), tab],
      },
      activeTabIds: { ...state.activeTabIds, [worktreeId]: id },
    }))
    return id
  },

  removeTab: (worktreeId, tabId) =>
    set(state => {
      const existing = state.tabs[worktreeId] ?? []
      if (!existing.some(t => t.id === tabId)) return state
      const filtered = existing.filter(t => t.id !== tabId)
      const currentActive = state.activeTabIds[worktreeId] ?? ''
      const newActive =
        currentActive === tabId
          ? (filtered[filtered.length - 1]?.id ?? '')
          : currentActive
      // Closing the last tab also closes every open browser surface for
      // this worktree — mirrors how closing the last terminal tab dismisses
      // the terminal panel.
      const closedAll = filtered.length === 0
      return {
        tabs: { ...state.tabs, [worktreeId]: filtered },
        activeTabIds: { ...state.activeTabIds, [worktreeId]: newActive },
        sidePaneOpen: closedAll
          ? { ...state.sidePaneOpen, [worktreeId]: false }
          : state.sidePaneOpen,
        modalOpen: closedAll
          ? { ...state.modalOpen, [worktreeId]: false }
          : state.modalOpen,
        bottomPanelOpen: closedAll
          ? { ...state.bottomPanelOpen, [worktreeId]: false }
          : state.bottomPanelOpen,
      }
    }),

  setActiveTab: (worktreeId, tabId) =>
    set(state => {
      if (state.activeTabIds[worktreeId] === tabId) return state
      return {
        activeTabIds: { ...state.activeTabIds, [worktreeId]: tabId },
      }
    }),

  updateTab: (tabId, patch) =>
    set(state => {
      const wid = findWorktreeForTab(state.tabs, tabId)
      if (!wid) return state
      const list = state.tabs[wid] ?? []
      const idx = list.findIndex(t => t.id === tabId)
      if (idx === -1) return state
      const existing = list[idx]
      if (!existing) return state
      // No-op guard: skip update if every patched field is unchanged
      let changed = false
      for (const k of Object.keys(patch) as (keyof typeof patch)[]) {
        if (existing[k] !== patch[k]) {
          changed = true
          break
        }
      }
      if (!changed) return state
      const next = [...list]
      next[idx] = { ...existing, ...patch }
      return { tabs: { ...state.tabs, [wid]: next } }
    }),

  setTabUrl: (tabId, url) => get().updateTab(tabId, { url }),
  setTabTitle: (tabId, title) => get().updateTab(tabId, { title }),
  setTabLoading: (tabId, loading) =>
    get().updateTab(tabId, { isLoading: loading }),
  setTabError: (tabId, error) => get().updateTab(tabId, { error }),
  setRequestedUrl: (tabId, url) => get().updateTab(tabId, { requestedUrl: url }),
  setLastLoadedUrl: (tabId, url) =>
    get().updateTab(tabId, { lastLoadedUrl: url }),

  hydrateTabs: (tabs, activeTabIds) => set({ tabs, activeTabIds }),

  setSidePaneOpen: (worktreeId, open) =>
    set(state => {
      if ((state.sidePaneOpen[worktreeId] ?? false) === open) return state
      // Surfaces are mutually exclusive (one tab → one webview → one position).
      const closeOthers = open
      return {
        sidePaneOpen: { ...state.sidePaneOpen, [worktreeId]: open },
        modalOpen: closeOthers
          ? { ...state.modalOpen, [worktreeId]: false }
          : state.modalOpen,
        bottomPanelOpen: closeOthers
          ? { ...state.bottomPanelOpen, [worktreeId]: false }
          : state.bottomPanelOpen,
      }
    }),

  toggleSidePane: worktreeId =>
    set(state => {
      const next = !(state.sidePaneOpen[worktreeId] ?? false)
      return {
        sidePaneOpen: { ...state.sidePaneOpen, [worktreeId]: next },
        modalOpen: next
          ? { ...state.modalOpen, [worktreeId]: false }
          : state.modalOpen,
        bottomPanelOpen: next
          ? { ...state.bottomPanelOpen, [worktreeId]: false }
          : state.bottomPanelOpen,
      }
    }),

  setSidePaneWidth: width =>
    set(state =>
      state.sidePaneWidth === width ? state : { sidePaneWidth: width }
    ),

  setModalOpen: (worktreeId, open) =>
    set(state => {
      if ((state.modalOpen[worktreeId] ?? false) === open) return state
      const closeOthers = open
      const dockMode = open
        ? resolveBrowserDock(worktreeId, state.modalDockMode)
        : state.modalDockMode
      return {
        modalOpen: { ...state.modalOpen, [worktreeId]: open },
        modalDockMode: dockMode,
        sidePaneOpen: closeOthers
          ? { ...state.sidePaneOpen, [worktreeId]: false }
          : state.sidePaneOpen,
        bottomPanelOpen: closeOthers
          ? { ...state.bottomPanelOpen, [worktreeId]: false }
          : state.bottomPanelOpen,
      }
    }),

  toggleModal: worktreeId =>
    set(state => {
      const next = !(state.modalOpen[worktreeId] ?? false)
      const dockMode = next
        ? resolveBrowserDock(worktreeId, state.modalDockMode)
        : state.modalDockMode
      return {
        modalOpen: { ...state.modalOpen, [worktreeId]: next },
        modalDockMode: dockMode,
        sidePaneOpen: next
          ? { ...state.sidePaneOpen, [worktreeId]: false }
          : state.sidePaneOpen,
        bottomPanelOpen: next
          ? { ...state.bottomPanelOpen, [worktreeId]: false }
          : state.bottomPanelOpen,
      }
    }),

  setModalDockMode: mode =>
    set(state =>
      state.modalDockMode === mode ? state : { modalDockMode: mode }
    ),

  setModalWidth: width =>
    set(state => (state.modalWidth === width ? state : { modalWidth: width })),

  setModalHeight: height =>
    set(state =>
      state.modalHeight === height ? state : { modalHeight: height }
    ),

  setBottomPanelOpen: (worktreeId, open) =>
    set(state => {
      if ((state.bottomPanelOpen[worktreeId] ?? false) === open) return state
      const closeOthers = open
      return {
        bottomPanelOpen: { ...state.bottomPanelOpen, [worktreeId]: open },
        sidePaneOpen: closeOthers
          ? { ...state.sidePaneOpen, [worktreeId]: false }
          : state.sidePaneOpen,
        modalOpen: closeOthers
          ? { ...state.modalOpen, [worktreeId]: false }
          : state.modalOpen,
      }
    }),

  toggleBottomPanel: worktreeId =>
    set(state => {
      const next = !(state.bottomPanelOpen[worktreeId] ?? false)
      return {
        bottomPanelOpen: { ...state.bottomPanelOpen, [worktreeId]: next },
        sidePaneOpen: next
          ? { ...state.sidePaneOpen, [worktreeId]: false }
          : state.sidePaneOpen,
        modalOpen: next
          ? { ...state.modalOpen, [worktreeId]: false }
          : state.modalOpen,
      }
    }),

  setBottomPanelHeight: height =>
    set(state =>
      state.bottomPanelHeight === height ? state : { bottomPanelHeight: height }
    ),
}))
