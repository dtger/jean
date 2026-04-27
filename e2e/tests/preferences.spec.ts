import { test, expect } from '../fixtures/tauri-mock'

test.describe('Preferences', () => {
  const openDialog = async (
    mockPage: Parameters<typeof test>[0]['mockPage']
  ) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })
    await mockPage.keyboard.press('Meta+,')
    const dialog = mockPage.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 3000 })
    return dialog
  }

  const getDesktopHeaderSearchInput = (
    dialog: ReturnType<typeof openDialog> extends Promise<infer T> ? T : never
  ) => dialog.locator('header').getByPlaceholder('Search settings...')

  test('Cmd+, opens settings dialog', async ({ mockPage }) => {
    await openDialog(mockPage)
    await expect(
      mockPage.getByRole('dialog').filter({ hasText: 'Settings' })
    ).toBeVisible({ timeout: 3000 })
  })

  test('settings dialog shows navigation tabs', async ({ mockPage }) => {
    const dialog = await openDialog(mockPage)
    await expect(dialog.getByRole('button', { name: 'General' })).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: 'Appearance' })
    ).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: 'Keybindings' })
    ).toBeVisible()
  })

  test('searching jumps to matching pane', async ({ mockPage }) => {
    const dialog = await openDialog(mockPage)
    const searchInput = getDesktopHeaderSearchInput(dialog)
    await searchInput.fill('keybindings')
    const result = dialog.getByRole('option', {
      name: 'Keybindings',
      exact: true,
    })
    await expect(result).toBeVisible()
    await result.click()
    await expect(dialog.getByText('Focus chat input')).toBeVisible()
    const keybindingsTab = dialog.getByRole('button', { name: 'Keybindings' })
    await expect(keybindingsTab).toHaveAttribute('data-active', 'true')
  })

  test('keyboard navigation selects search result', async ({ mockPage }) => {
    const dialog = await openDialog(mockPage)
    const searchInput = getDesktopHeaderSearchInput(dialog)
    await searchInput.fill('appearance')
    await searchInput.press('ArrowDown')
    await searchInput.press('ArrowDown')
    await searchInput.press('Enter')
    await expect(dialog.getByText('Color theme')).toBeVisible()
    const appearanceTab = dialog.getByRole('button', { name: 'Appearance' })
    await expect(appearanceTab).toHaveAttribute('data-active', 'true')
  })

  test('desktop header close button still closes while search results are open', async ({
    mockPage,
  }) => {
    await mockPage.setViewportSize({ width: 1280, height: 720 })
    const dialog = await openDialog(mockPage)
    const searchInput = getDesktopHeaderSearchInput(dialog)
    const desktopHeaderActions = searchInput.locator(
      'xpath=ancestor::div[contains(@class, "ml-auto") and contains(@class, "md:flex")][1]'
    )

    await searchInput.fill('provider')
    await expect(
      dialog.getByRole('option', { name: /Provider/i }).first()
    ).toBeVisible()

    await desktopHeaderActions.getByRole('button', { name: 'Close' }).click()

    await expect(dialog).toBeHidden()
  })
})
