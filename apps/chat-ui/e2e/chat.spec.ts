import { test, expect, type Page } from '@playwright/test'

const MOCK_AGENTS = [
  {
    id: 'agent-alpha',
    name: 'Alpha',
    icon: '🤖',
    color: '#3b82f6',
    providerName: 'openai',
    model: 'gpt-4',
    costClass: 'premium',
    temperature: 0.7,
    maxTokens: 2048,
  },
  {
    id: 'agent-beta',
    name: 'Beta',
    icon: '🧠',
    color: '#10b981',
    providerName: 'lm-studio-a',
    model: 'local-model',
    costClass: 'free',
    temperature: 0.5,
    maxTokens: 1024,
  },
]

const MOCK_PROVIDER_STATUS = {
  providers: [
    { name: 'openai', status: 'ok', latencyMs: 120 },
    { name: 'lm-studio-a', status: 'unconfigured' },
  ],
}

async function setupMocks(page: Page) {
  await page.route('/api/agents', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ agents: MOCK_AGENTS }),
    }),
  )

  await page.route('/api/providers/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_PROVIDER_STATUS),
    }),
  )

  await page.route('/api/chat/stream', (route) => {
    const sse = [
      'data: {"type":"token","token":"Hello"}\n\n',
      'data: {"type":"token","token":" world"}\n\n',
      'data: {"type":"done","agentId":"agent-alpha","model":"gpt-4","usedProvider":"openai","latencyMs":150}\n\n',
    ].join('')

    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: sse,
    })
  })
}

test.describe('Chat App', () => {
  test('loading the app shows agent tabs', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/')

    await expect(page.getByText('Alpha')).toBeVisible()
    await expect(page.getByText('Beta')).toBeVisible()
  })

  test('selecting an agent updates the chat panel header', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/')

    // First agent (Alpha) should be active by default
    await expect(page.getByRole('heading', { name: 'Alpha' })).toBeVisible()

    // Click on Beta tab
    await page.getByRole('button', { name: /Beta/ }).click()

    await expect(page.getByRole('heading', { name: 'Beta' })).toBeVisible()
  })

  test('starting a new chat via sidebar clears the active thread', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/')

    // Send a message to create a thread
    const textarea = page.getByPlaceholder(/Message Alpha/)
    await textarea.fill('Hello there')
    await textarea.press('Enter')

    // Wait for assistant response to appear (streaming complete)
    await expect(page.locator('.bg-gray-800').filter({ hasText: 'Hello world' })).toBeVisible()

    // Click "New Chat" in the sidebar
    await page.getByRole('button', { name: /New Chat/ }).click()

    // Should show the empty state prompt
    await expect(page.getByText(/Start a conversation with Alpha/)).toBeVisible()
  })

  test('sidebar shows recent threads after sending a message', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/')

    const textarea = page.getByPlaceholder(/Message Alpha/)
    await textarea.fill('Test thread message')
    await textarea.press('Enter')

    // Wait for assistant response to appear (streaming complete)
    await expect(page.locator('.bg-gray-800').filter({ hasText: 'Hello world' })).toBeVisible()

    // Sidebar should show the thread with the message as title
    await expect(page.getByText('Test thread message')).toBeVisible()
  })

  test('thread navigation works — clicking a thread loads its messages', async ({ page }) => {
    await setupMocks(page)
    await page.goto('/')

    // Send a first message to create thread
    const textarea = page.getByPlaceholder(/Message Alpha/)
    await textarea.fill('First thread')
    await textarea.press('Enter')
    await expect(page.locator('.bg-gray-800').filter({ hasText: 'Hello world' })).toBeVisible()

    // Start a new chat
    await page.getByRole('button', { name: /New Chat/ }).click()

    // Send a second message in a new thread
    await textarea.fill('Second thread')
    await textarea.press('Enter')
    await expect(page.locator('.bg-gray-800').filter({ hasText: 'Hello world' })).toBeVisible({ timeout: 3000 })

    // Click the first thread in the sidebar
    await page.getByText('First thread').first().click()

    // Should show the first thread's message
    await expect(page.locator('.bg-blue-600').filter({ hasText: 'First thread' })).toBeVisible()
  })
})
