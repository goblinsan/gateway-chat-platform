import { execFile as execFileCallback } from 'node:child_process'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { promisify } from 'node:util'
import type { AgentConfig } from '@gateway/shared'

const execFile = promisify(execFileCallback)

interface NotesSyncConfig {
  repoPath: string
  relativePath?: string
  timeZone?: string
  sectionTitle?: string
  commit?: boolean
  push?: boolean
}

interface NotesSyncPayload {
  threadId?: string
  source: 'chat' | 'automation'
  userMessage: string
  assistantMessage: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getNotesSyncConfig(agent: AgentConfig): NotesSyncConfig | null {
  const raw = agent.endpointConfig?.modelParams?.notesSync
  if (!isRecord(raw) || typeof raw.repoPath !== 'string' || !raw.repoPath.trim()) {
    return null
  }

  return {
    repoPath: raw.repoPath.trim(),
    relativePath: typeof raw.relativePath === 'string' && raw.relativePath.trim() ? raw.relativePath.trim() : undefined,
    timeZone: typeof raw.timeZone === 'string' && raw.timeZone.trim() ? raw.timeZone.trim() : 'America/New_York',
    sectionTitle: typeof raw.sectionTitle === 'string' && raw.sectionTitle.trim() ? raw.sectionTitle.trim() : `${agent.name} Chat`,
    commit: raw.commit === false ? false : true,
    push: raw.push === false ? false : true,
  }
}

function currentDateStamp(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const record = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `${record.year}-${record.month}-${record.day}`
}

function currentTimestamp(timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date())
}

function buildTargetFilePath(config: NotesSyncConfig): string {
  const timeZone = config.timeZone || 'America/New_York'
  const date = currentDateStamp(timeZone)
  const relativePath = config.relativePath
    ? config.relativePath.replaceAll('{{date}}', date)
    : join('daily', `${date}.md`)
  return join(config.repoPath, relativePath)
}

async function appendSection(filePath: string, sectionText: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  let prefix = ''
  try {
    const existing = await readFile(filePath, 'utf8')
    prefix = existing.endsWith('\n') ? '\n' : '\n\n'
  } catch {
    prefix = ''
  }
  await appendFile(filePath, `${prefix}${sectionText.trim()}\n`, 'utf8')
}

async function commitAndPush(repoPath: string, filePath: string, commit: boolean, push: boolean, commitMessage: string) {
  if (!commit) {
    return
  }

  const relativeFilePath = relative(repoPath, filePath)
  await execFile('git', ['-C', repoPath, 'add', '--', relativeFilePath])

  try {
    await execFile('git', ['-C', repoPath, 'commit', '-m', commitMessage])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('nothing to commit')) {
      throw error
    }
    return
  }

  if (push) {
    await execFile('git', ['-C', repoPath, 'push'])
  }
}

export async function syncAgentConversationToNotes(agent: AgentConfig, payload: NotesSyncPayload): Promise<{ filePath: string } | null> {
  const config = getNotesSyncConfig(agent)
  if (!config) {
    return null
  }

  const timestamp = currentTimestamp(config.timeZone || 'America/New_York')
  const filePath = buildTargetFilePath(config)
  const section = [
    `## ${config.sectionTitle} (${timestamp})`,
    '',
    `Source: ${payload.source}`,
    ...(payload.threadId ? [`Thread: ${payload.threadId}`, ''] : []),
    'User:',
    payload.userMessage.trim() || '(empty)',
    '',
    'Coach:',
    payload.assistantMessage.trim() || '(empty)',
  ].join('\n')

  await appendSection(filePath, section)
  await commitAndPush(
    config.repoPath,
    filePath,
    config.commit !== false,
    config.push !== false,
    `notes: sync ${agent.id} ${currentDateStamp(config.timeZone || 'America/New_York')}`,
  )

  return { filePath }
}
