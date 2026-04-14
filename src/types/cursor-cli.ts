/**
 * Types for Cursor CLI management.
 */

export interface CursorCliStatus {
  installed: boolean
  version: string | null
  path: string | null
}

export interface CursorAuthStatus {
  authenticated: boolean
  error: string | null
  timed_out?: boolean
}

export interface CursorModelInfo {
  id: string
  label: string
  is_default?: boolean
  is_current?: boolean
}

export interface CursorInstallCommand {
  command: string
  args: string[]
  description: string
}
