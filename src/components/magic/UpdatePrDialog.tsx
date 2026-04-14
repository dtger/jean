import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@/lib/transport'
import {
  AlertCircle,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  GitPullRequest,
  Loader2,
  RefreshCw,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { openExternal } from '@/lib/platform'
import { copyToClipboard } from '@/lib/clipboard'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useUIStore } from '@/store/ui-store'
import { useProjectsStore } from '@/store/projects-store'
import { useWorktrees } from '@/services/projects'
import { usePreferences } from '@/services/preferences'
import { resolveMagicPromptProvider } from '@/types/preferences'
import { useChatStore } from '@/store/chat-store'

interface UpdatePrResponse {
  pr_number: number
  title: string
  body: string
}

interface DetectPrResponse {
  pr_number: number
  pr_url: string
  title: string
}

type Phase = 'select-pr' | 'generate' | 'result'

export function UpdatePrDialog() {
  const { updatePrModalOpen, setUpdatePrModalOpen } = useUIStore()
  const selectedProjectId = useProjectsStore(state => state.selectedProjectId)
  const { data: preferences } = usePreferences()

  const { data: worktrees } = useWorktrees(selectedProjectId)
  const selectedWorktreeId = useProjectsStore(state => state.selectedWorktreeId)
  const worktree = worktrees?.find(w => w.id === selectedWorktreeId) ?? null

  const linkedPrNumber = worktree?.pr_number ?? null
  const linkedPrUrl = worktree?.pr_url ?? null
  const worktreePath = worktree?.path

  const [phase, setPhase] = useState<Phase>('select-pr')
  const [selectedPrNumber, setSelectedPrNumber] = useState<number | null>(null)
  const [branchPr, setBranchPr] = useState<DetectPrResponse | null>(null)
  const [isDetectingBranchPr, setIsDetectingBranchPr] = useState(false)
  const [prNumberInput, setPrNumberInput] = useState('')
  const [generatedTitle, setGeneratedTitle] = useState('')
  const [generatedBody, setGeneratedBody] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!updatePrModalOpen) return

    setPhase('select-pr')
    setSelectedPrNumber(linkedPrNumber)
    setPrNumberInput(linkedPrNumber ? String(linkedPrNumber) : '')
    setGeneratedTitle('')
    setGeneratedBody('')
    setIsGenerating(false)
    setIsUpdating(false)
    setIsDetectingBranchPr(false)
    setCopied(false)
    setErrorMessage(null)
  }, [updatePrModalOpen, linkedPrNumber])

  useEffect(() => {
    if (!updatePrModalOpen || !worktreePath) return

    let cancelled = false
    setIsDetectingBranchPr(true)

    invoke<DetectPrResponse | null>('detect_open_pr_for_branch', {
      worktreePath,
    })
      .then(result => {
        if (!cancelled) {
          setBranchPr(result)
          setIsDetectingBranchPr(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBranchPr(null)
          setIsDetectingBranchPr(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [updatePrModalOpen, worktreePath])

  const generateContentForPr = useCallback(
    async (prNumberValue: number) => {
      if (!worktreePath) return

      const parsedPrNumber = Number(prNumberValue)
      if (!Number.isInteger(parsedPrNumber) || parsedPrNumber <= 0) {
        setErrorMessage('Enter a valid pull request number.')
        return
      }

      setErrorMessage(null)
      setPrNumberInput(String(parsedPrNumber))
      setPhase('generate')
      setIsGenerating(true)

      const activeSessionId = selectedWorktreeId
        ? useChatStore.getState().activeSessionIds[selectedWorktreeId]
        : undefined

      try {
        const result = await invoke<UpdatePrResponse>(
          'generate_pr_update_content',
          {
            worktreePath,
            prNumber: parsedPrNumber,
            sessionId: activeSessionId ?? null,
            customPrompt: preferences?.magic_prompts?.pr_content,
            model: preferences?.magic_prompt_models?.pr_content_model,
            customProfileName: resolveMagicPromptProvider(
              preferences?.magic_prompt_providers,
              'pr_content_provider',
              preferences?.default_provider
            ),
            reasoningEffort:
              preferences?.magic_prompt_efforts?.pr_content_effort ?? null,
          }
        )
        setSelectedPrNumber(result.pr_number)
        setGeneratedTitle(result.title)
        setGeneratedBody(result.body)
        setPhase('result')
      } catch (error) {
        setErrorMessage(String(error))
        setPhase('select-pr')
      } finally {
        setIsGenerating(false)
      }
    },
    [worktreePath, selectedWorktreeId, preferences]
  )

  const generateContent = useCallback(async () => {
    const parsedPrNumber = Number(prNumberInput.trim())
    await generateContentForPr(parsedPrNumber)
  }, [prNumberInput, generateContentForPr])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setPhase('select-pr')
        setSelectedPrNumber(null)
        setPrNumberInput('')
        setGeneratedTitle('')
        setGeneratedBody('')
        setIsGenerating(false)
        setIsUpdating(false)
        setIsDetectingBranchPr(false)
        setCopied(false)
        setErrorMessage(null)
      }
      setUpdatePrModalOpen(open)
    },
    [setUpdatePrModalOpen]
  )

  const handleCopy = useCallback(async () => {
    const text = `# ${generatedTitle}\n\n${generatedBody}`
    await copyToClipboard(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [generatedTitle, generatedBody])

  const handleUpdatePr = useCallback(async () => {
    if (!worktreePath || !selectedPrNumber) return

    setIsUpdating(true)
    try {
      await invoke('update_pr_description', {
        worktreePath,
        prNumber: selectedPrNumber,
        title: generatedTitle,
        body: generatedBody,
      })

      toast.success(`PR #${selectedPrNumber} updated`, {
        action:
          linkedPrUrl && linkedPrNumber === selectedPrNumber
            ? {
                label: 'Open',
                onClick: () => openExternal(linkedPrUrl),
              }
            : undefined,
      })
      setUpdatePrModalOpen(false)
    } catch (error) {
      toast.error(`Failed to update PR: ${error}`)
    } finally {
      setIsUpdating(false)
    }
  }, [
    worktreePath,
    selectedPrNumber,
    generatedTitle,
    generatedBody,
    linkedPrUrl,
    linkedPrNumber,
    setUpdatePrModalOpen,
  ])

  return (
    <Dialog open={updatePrModalOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="!max-w-3xl w-[min(92vw,56rem)] h-[min(80vh,720px)] p-0 flex flex-col">
        <DialogHeader className="px-4 pt-5 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <GitPullRequest className="h-4 w-4" />
            {phase === 'select-pr'
              ? 'Generate PR description'
              : phase === 'generate'
                ? 'Generating...'
                : `Update PR #${selectedPrNumber}`}
          </DialogTitle>
        </DialogHeader>

        {phase === 'select-pr' && (
          <div className="flex-1 px-4 pb-4 pt-2 flex flex-col gap-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground block">
                Pull request number
              </label>
              <Input
                value={prNumberInput}
                onChange={e => {
                  setPrNumberInput(e.target.value.replace(/[^\d]/g, ''))
                  if (errorMessage) setErrorMessage(null)
                }}
                placeholder="e.g. 9521"
                className="text-base md:text-sm"
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    generateContent()
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">
                Enter any PR number. Jean will inspect that PR&apos;s actual
                base branch and generate the description against that PR.
              </p>
            </div>

            {errorMessage && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="font-medium">Could not load PR</div>
                  <div className="text-destructive/90">{errorMessage}</div>
                </div>
              </div>
            )}

            {isDetectingBranchPr && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Checking for open PR on this branch...
              </div>
            )}

            {(linkedPrNumber || branchPr) && (
              <div className="flex flex-wrap items-center gap-2">
                {linkedPrNumber && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setPrNumberInput(String(linkedPrNumber))
                      void generateContentForPr(linkedPrNumber)
                    }}
                  >
                    Use linked PR #{linkedPrNumber}
                  </Button>
                )}
                {linkedPrUrl && linkedPrNumber && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => openExternal(linkedPrUrl)}
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                    Open linked PR
                  </Button>
                )}
                {branchPr && branchPr.pr_number !== linkedPrNumber && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setPrNumberInput(String(branchPr.pr_number))
                        void generateContentForPr(branchPr.pr_number)
                      }}
                    >
                      Use open branch PR #{branchPr.pr_number}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => openExternal(branchPr.pr_url)}
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                      Open branch PR
                    </Button>
                  </>
                )}
              </div>
            )}

            <div className="mt-auto flex justify-end">
              <Button
                onClick={generateContent}
                disabled={!prNumberInput.trim() || isGenerating}
              >
                <ArrowRight className="h-3.5 w-3.5 mr-1.5" />
                Generate
              </Button>
            </div>
          </div>
        )}

        {phase === 'generate' && (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                Generating PR description for{' '}
                <span className="font-medium text-foreground">
                  #{prNumberInput}
                </span>
                ...
              </span>
            </div>
          </div>
        )}

        {phase === 'result' && (
          <div className="flex flex-col flex-1 min-h-0 px-4 pb-4 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Title
              </label>
              <Input
                value={generatedTitle}
                onChange={e => setGeneratedTitle(e.target.value)}
                className="text-base md:text-sm"
              />
            </div>

            <div className="flex-1 flex flex-col min-h-0">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Body
              </label>
              <Textarea
                value={generatedBody}
                onChange={e => setGeneratedBody(e.target.value)}
                className="flex-1 min-h-0 text-base resize-none font-mono md:text-sm"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPhase('select-pr')}
              >
                Change PR
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={generateContent}
                disabled={isGenerating}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 mr-1.5 ${isGenerating ? 'animate-spin' : ''}`}
                />
                Regenerate
              </Button>
              <div className="flex-1" />
              <Button size="sm" variant="outline" onClick={handleCopy}>
                {copied ? (
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5 mr-1.5" />
                )}
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button
                size="sm"
                onClick={handleUpdatePr}
                disabled={
                  isUpdating || !generatedTitle.trim() || !selectedPrNumber
                }
                className="max-sm:w-full"
              >
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                {isUpdating ? 'Updating...' : `Update PR #${selectedPrNumber}`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
