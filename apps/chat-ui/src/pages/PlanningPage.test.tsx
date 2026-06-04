// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import PlanningPage from './PlanningPage'

const mockUsePlans = vi.fn()

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../hooks/usePlans', () => ({
  usePlans: () => mockUsePlans(),
}))

function createPlansState() {
  return {
    plans: [],
    loading: false,
    error: null,
    refresh: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue(undefined),
    importDocument: vi.fn().mockResolvedValue(undefined),
    exportDocument: vi.fn(),
    patchPlan: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    addMilestone: vi.fn().mockResolvedValue(undefined),
    updateMilestoneStatus: vi.fn().mockResolvedValue(undefined),
    removeMilestone: vi.fn().mockResolvedValue(undefined),
    addTask: vi.fn().mockResolvedValue(undefined),
    updateTaskStatus: vi.fn().mockResolvedValue(undefined),
    patchTask: vi.fn().mockResolvedValue(undefined),
    removeTask: vi.fn().mockResolvedValue(undefined),
  }
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === label)
}

describe('PlanningPage', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    mockUsePlans.mockReset()
  })

  it('loads the planning workspace and refreshes durable plans on entry', async () => {
    const plans = createPlansState()
    mockUsePlans.mockReturnValue(plans)

    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={['/planning']}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <PlanningPage />
        </MemoryRouter>,
      )
    })

    expect(container.textContent).toContain('Planning workspace')
    expect(container.textContent).toContain('No plans yet.')
    expect(plans.refresh).toHaveBeenCalledTimes(1)
  })

  it('keeps chat available as a separate workspace from planning', async () => {
    mockUsePlans.mockReturnValue(createPlansState())

    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={['/planning']}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <Routes>
            <Route path="/" element={<div>Chat workspace</div>} />
            <Route path="/planning" element={<PlanningPage />} />
          </Routes>
        </MemoryRouter>,
      )
    })

    const openChatButton = findButton(container, 'Open chat')
    expect(openChatButton).toBeDefined()

    await act(async () => {
      openChatButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.textContent).toContain('Chat workspace')
  })

  it('registers the dedicated planning route in the app router', async () => {
    mockUsePlans.mockReturnValue(createPlansState())

    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={['/planning']}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <App />
        </MemoryRouter>,
      )
    })

    expect(container.textContent).toContain('Planning workspace')
  })
})
