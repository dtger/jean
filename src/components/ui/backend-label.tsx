import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { CliBackend } from '@/types/preferences'

export function getBackendLabel(backend: CliBackend): string {
  switch (backend) {
    case 'claude':
      return 'Claude'
    case 'codex':
      return 'Codex'
    case 'pi':
      return 'Pi'
    case 'opencode':
      return 'OpenCode'
    case 'cursor':
      return 'Cursor'
  }
}

export function getBackendPlainLabel(backend: CliBackend): string {
  return backend === 'cursor' ? 'Cursor (Beta)' : getBackendLabel(backend)
}

export function BackendLabel({
  backend,
  className,
  badgeClassName,
}: {
  backend: CliBackend
  className?: string
  badgeClassName?: string
}) {
  const label = getBackendLabel(backend)

  if (backend !== 'cursor') return <span className={className}>{label}</span>

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span>{label}</span>
      <Badge
        variant="outline"
        className={cn(
          'rounded-sm px-1.5 py-0 text-[10px] leading-4 text-muted-foreground uppercase tracking-wide',
          badgeClassName
        )}
      >
        Beta
      </Badge>
    </span>
  )
}
