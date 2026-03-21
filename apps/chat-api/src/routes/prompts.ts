import type { FastifyInstance } from 'fastify'
import type { PromptItem } from '@gateway/shared'

const PROMPTS: PromptItem[] = [
  { id: 'p1', title: 'Summarize this text', category: 'Summarization', prompt: 'Please summarize the following text concisely, highlighting the key points:\n\n', tags: ['summary', 'tldr'] },
  { id: 'p2', title: 'Executive summary', category: 'Summarization', prompt: 'Write an executive summary of the following content in 3-5 bullet points:\n\n', tags: ['summary', 'bullets', 'executive'] },
  { id: 'p3', title: 'Bullet point summary', category: 'Summarization', prompt: 'Convert the following into a structured bullet-point summary:\n\n', tags: ['summary', 'bullets'] },
  { id: 'p4', title: 'Analyze pros and cons', category: 'Analysis', prompt: 'Analyze the following and list the pros and cons in a structured format:\n\n', tags: ['analysis', 'pros-cons'] },
  { id: 'p5', title: 'Root cause analysis', category: 'Analysis', prompt: 'Perform a root cause analysis of the following problem. Identify the primary cause, contributing factors, and recommended solutions:\n\n', tags: ['analysis', 'rca', 'debugging'] },
  { id: 'p6', title: 'SWOT analysis', category: 'Analysis', prompt: 'Conduct a SWOT analysis (Strengths, Weaknesses, Opportunities, Threats) for the following:\n\n', tags: ['analysis', 'swot', 'strategy'] },
  { id: 'p7', title: 'Write a blog post', category: 'Writing', prompt: 'Write an engaging blog post about the following topic. Include an introduction, 3-5 main sections with headers, and a conclusion:\n\n', tags: ['writing', 'blog', 'content'] },
  { id: 'p8', title: 'Improve writing style', category: 'Writing', prompt: 'Improve the clarity, tone, and style of the following text while preserving the original meaning:\n\n', tags: ['writing', 'editing', 'style'] },
  { id: 'p9', title: 'Write a professional email', category: 'Writing', prompt: 'Write a professional email about the following topic. Keep it concise and actionable:\n\n', tags: ['writing', 'email', 'professional'] },
  { id: 'p10', title: 'Code review', category: 'Code', prompt: 'Review the following code. Point out bugs, performance issues, and suggest improvements:\n\n```\n', tags: ['code', 'review', 'debugging'] },
  { id: 'p11', title: 'Explain this code', category: 'Code', prompt: 'Explain the following code in plain English. Describe what it does, how it works, and any notable patterns:\n\n```\n', tags: ['code', 'explain', 'documentation'] },
  { id: 'p12', title: 'Write unit tests', category: 'Code', prompt: 'Write comprehensive unit tests for the following code. Cover happy paths, edge cases, and error conditions:\n\n```\n', tags: ['code', 'testing', 'tdd'] },
]

export default async function promptsRoutes(app: FastifyInstance) {
  app.get(
    '/prompts',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (_req, reply) => {
      return reply.send({ prompts: PROMPTS })
    },
  )
}
