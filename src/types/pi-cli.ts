export interface PiCliStatus {
  installed: boolean
  version: string | null
  path: string | null
}

export interface PiModelInfo {
  id: string
  provider: string
  label: string
  value: string
  contextWindow?: number
  supportsThinking?: boolean
}

export interface PiLoginInfo {
  command: string
  message: string
}
