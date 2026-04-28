import { useBrowserStore } from '@/store/browser-store'
import { useChatStore } from '@/store/chat-store'
import { isNativeApp } from '@/lib/environment'

const BASE = 52
const GUTTER = 12

export function useToasterOffset() {
  const activeWorktreeId = useChatStore(s => s.activeWorktreeId)
  const sidePaneOpen = useBrowserStore(s =>
    activeWorktreeId ? (s.sidePaneOpen[activeWorktreeId] ?? false) : false
  )
  const bottomPanelOpen = useBrowserStore(s =>
    activeWorktreeId ? (s.bottomPanelOpen[activeWorktreeId] ?? false) : false
  )
  const modalOpen = useBrowserStore(s =>
    activeWorktreeId ? (s.modalOpen[activeWorktreeId] ?? false) : false
  )
  const sidePaneWidth = useBrowserStore(s => s.sidePaneWidth)
  const bottomPanelHeight = useBrowserStore(s => s.bottomPanelHeight)
  const modalDockMode = useBrowserStore(s => s.modalDockMode)
  const modalWidth = useBrowserStore(s => s.modalWidth)
  const modalHeight = useBrowserStore(s => s.modalHeight)

  if (!isNativeApp()) return `${BASE}px`

  let right = BASE
  let bottom = BASE

  if (sidePaneOpen) right += sidePaneWidth + GUTTER
  if (bottomPanelOpen) bottom += bottomPanelHeight + GUTTER

  if (modalOpen) {
    if (modalDockMode === 'right' || modalDockMode === 'floating') {
      right += modalWidth + GUTTER
    } else if (modalDockMode === 'bottom') {
      bottom += modalHeight + GUTTER
    }
  }

  return { top: BASE, right, bottom, left: BASE }
}
