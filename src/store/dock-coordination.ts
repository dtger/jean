import type { ModalBrowserDockMode } from '@/types/browser'
import type { ModalTerminalDockMode } from '@/types/ui-state'

export type DockMode = ModalBrowserDockMode & ModalTerminalDockMode

/**
 * Pick a dock side that doesn't collide with the other open pane.
 *
 * Browser modal and terminal modal are independent surfaces but share the
 * same flex slots inside SessionChatModal. When both target the same dock
 * side (or both float at side="right"), they overlap and the native browser
 * webview paints over DOM, hiding the terminal.
 *
 * Resolution order on collision:
 *   left  → right
 *   right → left
 *   bottom → floating
 *   floating → right (docked)
 */
export function pickNonCollidingDock(
  desired: DockMode,
  otherOpen: boolean,
  otherDock: DockMode
): DockMode {
  if (!otherOpen) return desired
  if (desired !== otherDock) return desired
  if (desired === 'left') return 'right'
  if (desired === 'right') return 'left'
  if (desired === 'bottom') return 'floating'
  return 'right'
}
