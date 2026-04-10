import { Check, ChevronsUpDown, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { CustomCliProfile } from '@/types/preferences'
import { BACKEND_LABELS } from '@/services/mcp'
import { useAvailableOpencodeModels } from '@/services/opencode-cli'
import { cn } from '@/lib/utils'
import { formatOpencodeModelLabel } from '@/components/chat/toolbar/toolbar-utils'
import { useToolbarDerivedState } from '@/components/chat/toolbar/useToolbarDerivedState'
import { useToolbarDropdownShortcuts } from '@/components/chat/toolbar/useToolbarDropdownShortcuts'

interface DesktopBackendModelPickerProps {
  disabled?: boolean
  sessionHasMessages?: boolean
  triggerClassName?: string
  selectedBackend: 'claude' | 'codex' | 'opencode'
  selectedModel: string
  selectedProvider: string | null
  installedBackends: ('claude' | 'codex' | 'opencode')[]
  customCliProfiles: CustomCliProfile[]
  onModelChange: (model: string) => void
  onBackendModelChange: (
    backend: 'claude' | 'codex' | 'opencode',
    model: string
  ) => void
}

export function DesktopBackendModelPicker({
  disabled = false,
  sessionHasMessages,
  triggerClassName,
  selectedBackend,
  selectedModel,
  selectedProvider,
  installedBackends,
  customCliProfiles,
  onModelChange,
  onBackendModelChange,
}: DesktopBackendModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  useToolbarDropdownShortcuts({
    setModelDropdownOpen: setOpen,
  })

  const { data: availableOpencodeModels } = useAvailableOpencodeModels({
    enabled: installedBackends.includes('opencode'),
  })

  const opencodeModelOptions = useMemo(
    () =>
      availableOpencodeModels?.map(model => ({
        value: model,
        label: formatOpencodeModelLabel(model),
      })),
    [availableOpencodeModels]
  )

  const { backendModelSections, selectedModelLabel } = useToolbarDerivedState({
    selectedBackend,
    selectedProvider,
    selectedModel,
    opencodeModelOptions,
    customCliProfiles,
    installedBackends,
  })

  const visibleSections = useMemo(() => {
    const allowedBackends = sessionHasMessages
      ? new Set([selectedBackend])
      : new Set(installedBackends)
    return backendModelSections.filter(section =>
      allowedBackends.has(section.backend)
    )
  }, [
    backendModelSections,
    installedBackends,
    selectedBackend,
    sessionHasMessages,
  ])

  const filteredSections = useMemo(() => {
    const query = search.trim().toLowerCase()
    return visibleSections
      .map(section => ({
        ...section,
        options: section.options.filter(
          option =>
            !query ||
            `${section.label} ${option.label} ${option.value}`
              .toLowerCase()
              .includes(query)
        ),
      }))
      .filter(section => section.options.length > 0)
  }, [search, visibleSections])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setSearch('')
      window.dispatchEvent(new CustomEvent('focus-chat-input'))
    }
  }, [])

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
  }, [open])

  const handleSelect = useCallback(
    (backend: 'claude' | 'codex' | 'opencode', model: string) => {
      if (backend === selectedBackend) {
        onModelChange(model)
      } else {
        onBackendModelChange(backend, model)
      }
      handleOpenChange(false)
    },
    [handleOpenChange, onBackendModelChange, onModelChange, selectedBackend]
  )

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label="Choose backend and model"
              className={cn(
                'hidden xl:flex h-8 max-w-[22rem] shrink-0 items-center gap-2 rounded-md border border-border/70 bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
                triggerClassName
              )}
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {BACKEND_LABELS[selectedBackend] ?? selectedBackend} ·{' '}
                {selectedModelLabel}
              </span>
              {!sessionHasMessages && installedBackends.length > 1 && (
                <Kbd className="ml-1 hidden 2xl:inline-flex text-[10px]">
                  Tab
                </Kbd>
              )}
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {sessionHasMessages
            ? 'Model (⌘⇧M)'
            : 'Backend + model (⌘⇧M) · Tab cycles backend'}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        className="hidden xl:block w-[min(36rem,calc(100vw-4rem))] p-0"
      >
        <Command shouldFilter={false}>
          <div className="border-b p-2">
            <Input
              ref={searchInputRef}
              value={search}
              onChange={event => setSearch(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  handleOpenChange(false)
                }
              }}
              placeholder="Search backends and models..."
              className="h-9 text-base md:text-sm"
            />
          </div>
          <CommandList className="max-h-[24rem]">
            {filteredSections.length === 0 && (
              <CommandEmpty>No models found.</CommandEmpty>
            )}
            {filteredSections.map(section => (
              <CommandGroup
                key={section.backend}
                heading={section.label}
                className="[&_[cmdk-group-heading]]:sticky [&_[cmdk-group-heading]]:top-0 [&_[cmdk-group-heading]]:z-10 [&_[cmdk-group-heading]]:border-y [&_[cmdk-group-heading]]:bg-muted/95 [&_[cmdk-group-heading]]:backdrop-blur [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.18em] [&_[cmdk-group-heading]]:text-foreground/85"
              >
                {section.options.map(option => {
                  const isSelected =
                    selectedBackend === section.backend &&
                    selectedModel === option.value

                  return (
                    <CommandItem
                      key={`${section.backend}-${option.value}`}
                      value={`${section.label} ${option.label} ${option.value}`}
                      onSelect={() =>
                        handleSelect(section.backend, option.value)
                      }
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{option.label}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {option.value}
                        </div>
                      </div>
                      <Check
                        className={cn(
                          'ml-2 h-4 w-4 shrink-0',
                          isSelected ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
