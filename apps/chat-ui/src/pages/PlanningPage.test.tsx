// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanGoal } from '@gateway/shared'
import App from '../App'
import PlanningPage from './PlanningPage'

const mockUsePlans = vi.fn()

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../hooks/usePlans', () => ({
  usePlans: () => mockUsePlans(),
}))

function makePlan(overrides: Partial<PlanGoal> = {}): PlanGoal {
  return {
    id: 'plan-1',
    userId: 'user-1',
    title: 'Test plan',
    status: 'on_track',
    progressPercent: 0,
    objectives: [],
    principles: [],
    tags: [],
    sourceSystems: [],
    metrics: [],
    trackedMetrics: [],
    baselineFacts: [],
    successCriteria: [],
    cadence: [],
    supportingSections: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    milestones: [],
    ...overrides,
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function createPlansState(plans: PlanGoal[] = []) {
  return {
    plans,
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

  describe('date-based planning views', () => {
    it('shows Calendar view toggle button alongside List and Timeline', async () => {
      mockUsePlans.mockReturnValue(createPlansState())

      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={['/planning']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <PlanningPage />
          </MemoryRouter>,
        )
      })

      expect(findButton(container, 'List')).toBeDefined()
      expect(findButton(container, 'Timeline')).toBeDefined()
      expect(findButton(container, 'Calendar')).toBeDefined()
    })

    it('switches to Calendar view and shows horizon tabs', async () => {
      mockUsePlans.mockReturnValue(createPlansState([makePlan()]))

      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={['/planning']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <PlanningPage />
          </MemoryRouter>,
        )
      })

      await act(async () => {
        findButton(container, 'Calendar')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      expect(container.textContent).toContain('Today')
      expect(container.textContent).toContain('Week')
      expect(container.textContent).toContain('Month')
      expect(container.textContent).toContain('Year')
    })

    it('shows "Nothing scheduled" when no tasks or milestones have backend date fields', async () => {
      const plan = makePlan({
        milestones: [
          {
            id: 'ms-1',
            planId: 'plan-1',
            title: 'Milestone without date',
            status: 'on_track',
            progressPercent: 0,
            orderIndex: 0,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            tasks: [
              {
                id: 'task-1',
                milestoneId: 'ms-1',
                title: 'Task without dueAt',
                status: 'todo',
                progressPercent: 0,
                orderIndex: 0,
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
              },
            ],
          },
        ],
      })
      mockUsePlans.mockReturnValue(createPlansState([plan]))

      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={['/planning']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <PlanningPage />
          </MemoryRouter>,
        )
      })

      await act(async () => {
        findButton(container, 'Calendar')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      expect(container.textContent).toContain('Nothing scheduled for this period.')
      expect(container.textContent).toContain('Unscheduled')
      expect(container.textContent).toContain('no backend date set')
    })

    it('shows a task with a matching dueAt in the Today calendar view', async () => {
      const plan = makePlan({
        milestones: [
          {
            id: 'ms-1',
            planId: 'plan-1',
            title: 'Sprint milestone',
            status: 'on_track',
            progressPercent: 0,
            orderIndex: 0,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            tasks: [
              {
                id: 'task-scheduled',
                milestoneId: 'ms-1',
                title: 'Deploy feature',
                status: 'in_progress',
                progressPercent: 50,
                orderIndex: 0,
                dueAt: today(),
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
              },
            ],
          },
        ],
      })
      mockUsePlans.mockReturnValue(createPlansState([plan]))

      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={['/planning']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <PlanningPage />
          </MemoryRouter>,
        )
      })

      await act(async () => {
        findButton(container, 'Calendar')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      expect(container.textContent).toContain('Deploy feature')
      expect(container.textContent).toContain('Scheduled')
    })

    it('shows a milestone with a matching targetDate in the Today calendar view', async () => {
      const plan = makePlan({
        milestones: [
          {
            id: 'ms-2',
            planId: 'plan-1',
            title: 'Launch milestone',
            status: 'on_track',
            progressPercent: 0,
            orderIndex: 0,
            targetDate: today(),
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            tasks: [],
          },
        ],
      })
      mockUsePlans.mockReturnValue(createPlansState([plan]))

      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={['/planning']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <PlanningPage />
          </MemoryRouter>,
        )
      })

      await act(async () => {
        findButton(container, 'Calendar')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      expect(container.textContent).toContain('Launch milestone')
      expect(container.textContent).toContain('Scheduled')
    })

    it('navigates to the next period and back', async () => {
      mockUsePlans.mockReturnValue(createPlansState([makePlan()]))

      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={['/planning']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <PlanningPage />
          </MemoryRouter>,
        )
      })

      await act(async () => {
        findButton(container, 'Calendar')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      const initialLabel = container.querySelector('[aria-label="Previous period"]')?.parentElement?.textContent ?? ''

      const nextButton = container.querySelector('[aria-label="Next period"]') as HTMLButtonElement | null
      await act(async () => {
        nextButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      const afterNextLabel = container.querySelector('[aria-label="Previous period"]')?.parentElement?.textContent ?? ''
      expect(afterNextLabel).not.toBe(initialLabel)

      const prevButton = container.querySelector('[aria-label="Previous period"]') as HTMLButtonElement | null
      await act(async () => {
        prevButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      const afterBackLabel = container.querySelector('[aria-label="Previous period"]')?.parentElement?.textContent ?? ''
      expect(afterBackLabel).toBe(initialLabel)
    })

    it('switches between week, month, and year horizons and resets to today', async () => {
      mockUsePlans.mockReturnValue(createPlansState([makePlan()]))

      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={['/planning']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <PlanningPage />
          </MemoryRouter>,
        )
      })

      await act(async () => {
        findButton(container, 'Calendar')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      await act(async () => {
        findButton(container, 'Month')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(container.textContent).toMatch(/January|February|March|April|May|June|July|August|September|October|November|December/)

      await act(async () => {
        findButton(container, 'Year')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(container.textContent).toContain(String(new Date().getFullYear()))

      await act(async () => {
        findButton(container, 'Week')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(container.textContent).toMatch(/–/)
    })
  })
})
