import { useQuery } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { logger } from '@/lib/logger'
import { hasBackend } from '@/lib/environment'
import type { PiCliStatus, PiLoginInfo, PiModelInfo } from '@/types/pi-cli'

const isTauri = hasBackend

export const piCliQueryKeys = {
  all: ['pi-cli'] as const,
  status: () => [...piCliQueryKeys.all, 'status'] as const,
  models: () => [...piCliQueryKeys.all, 'models'] as const,
  login: () => [...piCliQueryKeys.all, 'login'] as const,
}

export function usePiCliStatus(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: piCliQueryKeys.status(),
    queryFn: async (): Promise<PiCliStatus> => {
      if (!isTauri()) return { installed: false, version: null, path: null }
      try {
        return await invoke<PiCliStatus>('check_pi_cli_installed')
      } catch (error) {
        logger.error('Failed to check Pi CLI status', { error })
        return { installed: false, version: null, path: null }
      }
    },
    enabled: options?.enabled ?? true,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  })
}

export function useAvailablePiModels(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: piCliQueryKeys.models(),
    queryFn: async (): Promise<PiModelInfo[]> => {
      if (!isTauri()) return []
      try {
        return await invoke<PiModelInfo[]>('list_pi_models')
      } catch (error) {
        logger.error('Failed to list Pi models', { error })
        return []
      }
    },
    enabled: options?.enabled ?? true,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  })
}

export async function getPiLoginInfo(): Promise<PiLoginInfo> {
  return invoke<PiLoginInfo>('pi_login')
}
