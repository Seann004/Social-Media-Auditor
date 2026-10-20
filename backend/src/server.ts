import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import * as db from './services/dbService.js'
import * as mapping from './services/mappingService.js'
import { supabase } from './config/supabase.js'
import { requireAuth, requireRole, optionalAuth, signToken } from './middleware/auth.js'
import { requireProjectAccess, requireProjectOwner, requireChecklistItemProjectAccess, filterAccessibleProjectIds, isProjectMember } from './middleware/projectAccess.js'

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Refusing to start because every request would silently fail auth.')
  process.exit(1)
}

const app = express()
const port = process.env.PORT || 3000

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

class CorsRejectedError extends Error {}

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
    callback(new CorsRejectedError('Not allowed by CORS'))
  },
}))
app.use(express.json({ limit: '20mb' }))
app.use(express.urlencoded({ limit: '20mb', extended: true }))

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
})
app.use('/api', generalLimiter)

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
})

function sendError(res: express.Response, error: unknown) {
  if (error instanceof db.EditLockedError) {
    return res.status(403).json({ error: error.message })
  }
  if (error instanceof db.IncompleteCoverageError) {
    return res.status(409).json({ error: error.message })
  }
  if (error instanceof db.AlreadySubmittedError) {
    return res.status(409).json({ error: error.message })
  }
  if (error instanceof db.GuidelineHasAnswersError) {
    return res.status(409).json({ error: error.message })
  }
  if (error instanceof db.ResultNotFoundError || error instanceof mapping.SuggestionNotFoundError || error instanceof mapping.MappingNotFoundError) {
    return res.status(404).json({ error: error.message })
  }
  if (error instanceof mapping.MappingFailedError) {
    return res.status(502).json({ error: error.message })
  }
  console.error(error)
  if (error && typeof error === 'object' && 'code' in error && 'details' in error) {
    return res.status(500).json({ error: 'Something went wrong while saving. Please try again.' })
  }
  res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() })
})

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' })
    }
    const { data, error } = await supabase.rpc('verify_user_login', {
      p_email: String(email).trim().toLowerCase(),
      p_password: password,
    })
    if (error || !data || data.length === 0) {
      return res.status(401).json({ error: 'Incorrect email or password.' })
    }
    const user = data[0]
    const authUser = { userId: user.userId, userName: user.userName, role: user.role }
    const token = signToken(authUser)
    res.json({ token, user: authUser })
  } catch (error) {
    sendError(res, error)
  }
})

app.get('/api/users', requireAuth, async (req, res) => {
  try {
    const users = await db.fetchAllUsers()
    const isAdmin = req.user!.role === 'admin'
    const shaped = isAdmin ? users : users.map(({ userEmail, ...rest }) => rest)
    res.json(shaped)
  } catch (error) {
    sendError(res, error)
  }
})

app.post('/api/users', optionalAuth, async (req, res) => {
  try {
    const { userId, userName, userEmail, role, userPassword } = req.body
    if (!userId || !userName || !userEmail || !userPassword) {
      return res.status(400).json({ error: 'userId, userName, userEmail and userPassword are required.' })
    }
    if (typeof userId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      return res.status(400).json({ error: 'userId must be a UUID.' })
    }
    if (!['admin', 'head_auditor', 'auditor'].includes(role)) {
      return res.status(400).json({ error: 'role must be one of admin, head_auditor, auditor.' })
    }
    const isCallerAdmin = req.user?.role === 'admin'
    if (role === 'admin' && !isCallerAdmin) {
      return res.status(403).json({ error: 'That role cannot be self-registered.' })
    }
    await db.createUser({ userId, userName, userEmail, role, userPassword })
    const token = signToken({ userId, userName, role })
    res.status(201).json({ success: true, token })
  } catch (error) {
    sendError(res, error)
  }
})

app.get('/api/projects', requireAuth, async (req, res) => {
  try {
    const projects = await db.fetchUserProjects(req.user!.userId)
    res.json(projects)
  } catch (error) {
    sendError(res, error)
  }
})

app.get('/api/projects/compliance-summary', requireAuth, async (req, res) => {
  try {
    const idsString = req.query.ids as string
    if (!idsString) {
      return res.json({})
    }
    const requestedIds = idsString.split(',')
    const ids = await filterAccessibleProjectIds(req.user!.userId, requestedIds)
    const summary = await db.fetchProjectComplianceSummary(ids)
    res.json(summary)
  } catch (error) {
    sendError(res, error)
  }
})

app.get('/api/projects/:id', requireAuth, requireProjectAccess('id'), async (req, res) => {
  try {
    const details = await db.fetchProjectDetails(req.params.id)
    res.json(details)
  } catch (error) {
    sendError(res, error)
  }
})

app.post('/api/projects', requireAuth, requireRole('head_auditor'), async (req, res) => {
  try {
    const { title, platform } = req.body
    if (!title || typeof title !== 'string' || !platform || typeof platform !== 'string') {
      return res.status(400).json({ error: 'title and platform are required.' })
    }
    const projectId = await db.createProject({ ...req.body, headAuditorId: req.user!.userId })
    res.status(201).json({ projectId })
  } catch (error) {
    sendError(res, error)
  }
})

app.patch('/api/projects/:id', requireAuth, requireRole('head_auditor'), requireProjectOwner('id'), async (req, res) => {
  try {
    await db.updateProject(req.params.id, req.body)
    res.json({ success: true })
  } catch (error) {
    sendError(res, error)
  }
})

app.post('/api/projects/:id/activate', requireAuth, requireProjectAccess('id'), async (req, res) => {
  try {
    await db.activateProject(req.params.id)
    res.json({ success: true })
  } catch (error) {
    sendError(res, error)
  }
})

app.delete('/api/projects/:id', requireAuth, requireRole('head_auditor'), requireProjectOwner('id'), async (req, res) => {
  try {
    await db.deleteProject(req.params.id)
    res.json({ success: true })
  } catch (error) {
    sendError(res, error)
  }
})

app.post('/api/projects/:id/members', requireAuth, requireRole('head_auditor'), requireProjectOwner('id'), async (req, res) => {
  try {
    const projectId = req.params.id
    const userIds = req.body.userIds
    if (!Array.isArray(userIds) || !userIds.every((u) => typeof u === 'string')) {
      return res.status(400).json({ error: 'userIds must be an array of strings.' })
    }

    const details = await db.fetchProjectDetails(projectId)
    const existingUserIds = (details?.members || []).map((m: any) => m.userId) as string[]

    await db.syncProjectMembers(projectId, userIds)

    const newUserIds = userIds.filter((id: string) => !existingUserIds.includes(id))

    for (const userId of newUserIds) {
      db.sendAssignmentEmail(projectId, userId).catch((err) => {
        console.error('Error in sendAssignmentEmail async chain:', err)
      })
    }

    res.json({ success: true })
  } catch (error) {
    sendError(res, error)
  }
})

app.post('/api/projects/:id/members/add', requireAuth, requireRole('head_auditor'), requireProjectOwner('id'), async (req, res) => {
  try {
    const projectId = req.params.id
    const userId = req.body.userId as string
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId is required.' })
    }

    await db.addProjectMember(projectId, userId)

    db.sendAssignmentEmail(projectId, userId).catch((err) => {
      console.error('Error in sendAssignmentEmail async chain:', err)
    })

    res.json({ success: true })
  } catch (error) {
    sendError(res, error)
  }
})

app.delete('/api/projects/:id/members/:userId', requireAuth, requireRole('head_auditor'), requireProjectOwner('id'), async (req, res) => {
  try {
    await db.removeProjectMember(req.params.id, req.params.userId)
    res.json({ success: true })
  } catch (error) {
    sendError(res, error)
  }
})

app.post('/api/projects/:id/guidelines', requireAuth, requireRole('head_auditor'), requireProjectAccess('id'), async (req, res) => {
  try {
    const { guidelineIds } = req.body
    if (!Array.isArray(guidelineIds) || !guidelineIds.every((g) => typeof g === 'string')) {
      return res.status(400).json({ error: 'guidelineIds must be an array of strings.' })
    }
    await db.syncProjectGuidelines(req.params.id, guidelineIds)
    res.json({ success: true })
  } catch (error) {
    sendError(res, error)
  }
})

app.post('/api/projects/:id/scope', requireAuth, requireRole('head_auditor'), requireProjectAccess('id'), async (req, res) => {
  try {
    const { features } = req.body
    if (!Array.isArray(features) || !features.every((f) => typeof f === 'string')) {
      return res.status(400).json({ error: 'features must be an array of strings.' })
    }
    await db.syncProjectScope(req.params.id, features)
    res.json({ success: true })
  } catch (error) {
    sendError(res, error)
  }
})

app.post('/api/guidelines', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { guideline, items } = req.body
    if (!guideline || typeof guideline !== 'object' || !guideline.guidelineId || !guideline.guidelineName) {
      return res.status(400).json({ error: 'guideline (with guidelineId and guidelineName) is required.' })
    }
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'items must be an array.' })
    }
    await db.createGuideline({ guideline, items })
    res.status(201).json({ success: true })
    mapping.generateMappingsForGuideline(guideline.guidelineId, askGroq)
      .then((r) => console.log(`Mapped ${guideline.guidelineName}: ${r.suggested} suggested links`))
      .catch((err) => console.error('Auto mapping failed:', err))
  } catch (error) {
    sendError(res, error)
  }
})

app.get('/api/guidelines', requireAuth, async (req, res) => {
  try {
    const guidelines = await db.fetchGuidelines()
    res.json(guidelines)
  } catch (error) {
    sendError(res, error)
  }
})

app.delete('/api/guidelines/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await db.deleteGuideline(req.params.id)
    res.json({ success: true })
  } catch (error) {
    sendError(res, error)
  }
})

app.get('/api/guidelines/:id/items', requireAuth, async (req, res) => {
  try {
    const items = await db.fetchGuidelineItems(req.params.id)
    res.json(items)
  } catch (error) {
    sendError(res, error)
  }
})

app.get('/api/projects/:id/checklist', requireAuth, requireProjectAccess('id'), async (req, res) => {
  try {
    const items = await db.fetchProjectChecklistItems(req.params.id)
    res.json(items)
  } catch (error) {
    sendError(res, error)
  }
})

const VALID_SEVERITIES = ['critical', 'major', 'minor']

app.post('/api/projects/:id/checklist/items', requireAuth, requireRole('head_auditor'), requireProjectAccess('id'), async (req, res) => {
  try {
    const { category, text, severity, reference, guidelineId, itemName, itemCode, helpText, verbatimClauseText, answerOptions } = req.body
    if (!category || !text || !guidelineId) {
      return res.status(400).json({ error: 'category, text and guidelineId are required.' })
    }
    if (!VALID_SEVERITIES.includes(severity)) {
      return res.status(400).json({ error: `severity must be one of ${VALID_SEVERITIES.join(', ')}.` })
    }
    const projectId = req.params.id
    const itemId = await db.addProjectChecklistItem(projectId, guidelineId, {
      category, text, severity, reference, itemName, itemCode, helpText, verbatimClauseText, answerOptions,
    })
    res.status(201).json({ itemId })
  } catch (error) {
    sendError(res, error)
  }
})

app.patch('/api/projects/:projectId/results/:itemId/findings', requireAuth, requireProjectAccess('projectId'), async (req, res) => {
  try {
    const { findings } = req.body
    if (findings !== undefined && typeof findings !== 'string') {
      return res.status(400).json({ error: 'findings must be a string.' })
    }
    await db.saveAuditFindings(req.params.projectId, req.params.itemId, req.user!.userId, findings ?? '')
    res.json({ success: true })
  } catch (error) {
    sendError(res, error)
  }
})

app.patch('/api/projects/:projectId/results/:itemId/evidence', requireAuth, requireProjectAccess('projectId'), async (req, res) => {
  try {
    const { images } = req.body
    if (images !== undefined && (!Array.isArray(images) || !images.every((i) => i && typeof i.url === 'string' && typeof i.name === 'string'))) {
      return res.status(400).json({ error: 'images must be an array of { url, name }.' })
    }
    await db.saveEvidenceImages(req.params.projectId, req.params.itemId, req.user!.userId, images ?? [])
    res.json({ success: true })
  } catch (error) {
    sendError(res, error)
  }
})

app.post('/api/projects/:id/checklist/categories/toggle', requireAuth, requireRole('head_auditor'), requireProjectAccess('id'), async (req, res) => {
  try {
    const { category, enabled, guidelineId } = req.body
    if (!category || typeof category !== 'string' || !guidelineId || typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'category, guidelineId and enabled (boolean) are required.' })
    }
    const projectId = req.params.id
    await db.toggleProjectChecklistCategory(projectId, guidelineId, category, enabled)
    res.json({ success: true })
  } catch (error) {
    sendError(res, error)
  }
})

app.patch('/api/checklist/items/:id', requireAuth, requireRole('head_auditor'), requireChecklistItemProjectAccess('id'), async (req, res) => {
  try {
    const { severity } = req.body
    if (severity !== undefined && !VALID_SEVERITIES.includes(severity)) {
      return res.status(400).json({ error: `severity must be one of ${VALID_SEVERITIES.join(', ')}.` })
    }
    await db.updateChecklistItem(req.params.id, req.body)
    res.json({ success: true })
  } catch (error) {
    sendError(res, error)
  }
})

app.delete('/api/checklist/items/:id', requireAuth, requireRole('head_auditor'), requireChecklistItemProjectAccess('id'), async (req, res) => {
  try {
    await db.deleteChecklistItem(req.params.id)
    res.json({ success: true })
  } catch (error) {
    sendError(res, error)
  }
})

app.get('/api/projects/:id/results', requireAuth, requireProjectAccess('id'), async (req, res) => {
  try {
    const results = await db.fetchAuditResults(req.params.id)
    res.json(results)
  } catch (error) {
    sendError(res, error)
  }
})

app.get('/api/projects/:id/evidence', requireAuth, requireProjectAccess('id'), async (req, res) => {
  try {
    const itemIdsParam = req.query.itemIds
    if (typeof itemIdsParam !== 'string' || !itemIdsParam) {
      return res.status(400).json({ error: 'itemIds query parameter is required.' })
    }
    const itemIds = itemIdsParam.split(',').filter(Boolean)
    const evidence = await db.fetchEvidenceForItems(req.params.id, itemIds)
    res.json(evidence)
  } catch (error) {
    sendError(res, error)
  }
})

app.get('/api/projects/:id/reliability', requireAuth, requireProjectAccess('id'), async (req, res) => {
  try {
    const reliability = await db.computeInterRaterReliability(req.params.id)
    res.json(reliability)
  } catch (error) {
    sendError(res, error)
  }
})

app.get('/api/projects/:id/resolutions', requireAuth, requireProjectAccess('id'), async (req, res) => {
  try {
    const resolutions = await db.fetchResolutions(req.params.id)
    res.json(resolutions)
  } catch (error) {
    sendError(res, error)
  }
})

const VALID_RESOLUTION_STATUSES = ['compliant', 'non_compliant', 'partially', 'not_applicable']

app.post('/api/projects/:id/results/:itemId/resolve', requireAuth, requireRole('head_auditor'), requireProjectAccess('id'), async (req, res) => {
  try {
    const { status, notes } = req.body
    if (!VALID_RESOLUTION_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${VALID_RESOLUTION_STATUSES.join(', ')}.` })
    }
    await db.resolveDisagreement(req.params.id, req.params.itemId, req.user!.userId, status, notes ?? '')
    res.json({ success: true })
  } catch (error) {
    sendError(res, error)
  }
})

const VALID_RESULT_STATUSES = ['compliant', 'non_compliant', 'partially', 'not_applicable', 'needs_review']

app.post('/api/projects/:id/results', requireAuth, requireProjectAccess('id'), async (req, res) => {
  try {
    const { itemId, guidelineId, result, notes } = req.body
    if (!itemId || !guidelineId || !VALID_RESULT_STATUSES.includes(result)) {
      return res.status(400).json({ error: `itemId, guidelineId are required and result must be one of ${VALID_RESULT_STATUSES.join(', ')}.` })
    }
    await db.upsertAuditResult(
      req.params.id,
      itemId,
      req.user!.userId,
      guidelineId,
      result,
      notes
    )
    res.json({ success: true })
  } catch (error) {
    sendError(res, error)
  }
})

app.post('/api/projects/:id/submit', requireAuth, requireRole('auditor'), requireProjectAccess('id'), async (req, res) => {
  try {
    await db.submitForReview(req.params.id)
    res.json({ success: true })
  } catch (error) {
    sendError(res, error)
  }
})

app.post('/api/projects/:id/review', requireAuth, requireRole('head_auditor'), requireProjectOwner('id'), async (req, res) => {
  try {
    const { approved, remarks } = req.body
    if (typeof approved !== 'boolean') {
      return res.status(400).json({ error: 'approved (boolean) is required.' })
    }
    await db.reviewSubmission(req.params.id, approved, remarks)
    res.json({ success: true })
  } catch (error) {
    sendError(res, error)
  }
})

app.get('/api/projects/:id/compliance-scores', requireAuth, requireProjectAccess('id'), async (req, res) => {
  try {
    const scores = await db.fetchComplianceScores(req.params.id)
    res.json(scores)
  } catch (error) {
    sendError(res, error)
  }
})

app.get('/api/reports', requireAuth, async (req, res) => {
  try {
    const filters = {
      projectStatusFilter: req.query.projectStatusFilter as any,
      search: req.query.search as string,
      dateFrom: req.query.dateFrom as string,
      dateTo: req.query.dateTo as string,
    }
    const reports = await db.fetchAuditReports(req.user!.userId, filters)
    res.json(reports)
  } catch (error) {
    sendError(res, error)
  }
})

app.post('/api/reports', requireAuth, async (req, res) => {
  try {
    const { projectId } = req.body
    if (!projectId || !(await isProjectMember(projectId, req.user!.userId))) {
      return res.status(403).json({ error: 'You do not have access to this project.' })
    }
    const reportId = await db.createAuditReport(projectId, req.user!.userId)
    res.status(201).json({ reportId })
  } catch (error) {
    sendError(res, error)
  }
})


const GROQ_TIMEOUT_MS = 30000

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer))
}

async function groqFetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetchWithTimeout(url, options, GROQ_TIMEOUT_MS)
    if (res.status !== 429) return res
    const retryAfter = Number(res.headers.get('retry-after') || 0) || 15
    console.warn(`[GROQ] 429 rate limit, waiting ${retryAfter}s before retry ${attempt + 1}/${retries}`)
    await new Promise((r) => setTimeout(r, retryAfter * 1000))
  }
  return fetchWithTimeout(url, options, GROQ_TIMEOUT_MS)
}

app.post('/api/generator/process-chunk', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { textChunk, platform } = req.body
    if (!textChunk || typeof textChunk !== 'string') {
      return res.status(400).json({ error: 'textChunk is required' })
    }
    if (platform !== undefined && typeof platform !== 'string') {
      return res.status(400).json({ error: 'platform must be a string' })
    }

    const apiKey = process.env.GROQ_API_KEY
    const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'

    if (!apiKey) {
      return res.status(500).json({ error: 'GROQ_API_KEY is not configured on the backend server' })
    }

    const systemPrompt = `You are a compliance assistant specializing in child safety regulation and social media platform audits.
Analyze the provided text snippet from a regulatory guideline document and extract child safety compliance check items.
Focus on identifying concrete, auditable items suitable for checking a platform like ${platform || 'social media platforms'}.

BEFORE extracting any items, identify valid clauses using these rules:

A valid clause MUST impose a concrete obligation, standard, or requirement on the reader.
Valid clause patterns include: numbered sections (e.g. "1.", "Article 5", "Section 3.2"),
titled requirement blocks, or named standards.

IGNORE the following and do NOT extract checklist items from them or use them as references:
- Page headers, footers, or version/date stamps (e.g. "2.1.87 | 17 October 2022", "v1.3 | 2024")
- Standalone page numbers
- Document furniture: "Executive Summary", "Foreword", "Preface", "Table of Contents",
  "Glossary", "Annex", "Appendix", "Index", "About this document", "Enforcement"
- Sub-headings that are questions or navigation aids within a clause, such as:
  "What do you mean by...?", "Why is this important?", "How can we...?",
  "At a glance", "In more detail", "Background", "Overview"
- Introductory sections that describe the document itself rather than impose requirements

For the "reference" field: use the nearest valid clause number or section title as it
appears in the document. If the text does not belong to a clearly numbered clause,
group it under the closest parent section heading. Never use page numbers,
question sub-headings, or document metadata as a reference value.

For each checklist item, you must determine:
1. "category": A relevant category (e.g. Age Gate, Consent, Direct Messaging, Data Safety, Content Filtering, Dark Patterns).
2. "text": The auditable question. It must be specific, actionable, and state exactly what to check.
3. "severity": One of "critical", "major", or "minor".
4. "reference": The specific clause number, paragraph number, or section reference from the text (e.g., "Clause 1.2.4").

You MUST return your output in JSON format matching this EXACT schema:
{
  "items": [
    {
      "id": "A unique string ID based on reference, e.g. ci_1_24_1",
      "category": "Category Name",
      "text": "Detailed check question...",
      "severity": "critical|major|minor",
      "reference": "Clause number",
      "helpText": "A detailed explanation, example, or guidance on what evidence to inspect to check this requirement."
    }
  ]
}`

    const response = await groqFetchWithRetry('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Analyze this text chunk:\n\n${textChunk}` }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1
      })
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Groq API error: ${err}`)
    }

    const data = await response.json() as any
    const content = data.choices?.[0]?.message?.content

    const parsed = JSON.parse(content || '{}')
    res.json({ items: parsed.items || [], _aiUsed: true })

  } catch (error) {
    console.error('[AI_ENGINE_ERROR] Groq LLM connection failed during chunk processing:', {
      timestamp: new Date().toISOString(),
      error: String(error),
      fallback: 'heuristic_parser',
    })

    const sentences = (req.body.textChunk || '').split(/[.!?\n]+/)
    const items: any[] = []
    let idx = 1

    const keywords = [
      { term: 'shall', sev: 'critical' },
      { term: 'must', sev: 'critical' },
      { term: 'should', sev: 'major' },
      { term: 'ensure', sev: 'major' },
      { term: 'restrict', sev: 'major' },
      { term: 'prevent', sev: 'major' },
      { term: 'prohibit', sev: 'critical' },
      { term: 'require', sev: 'major' },
      { term: 'privacy', sev: 'minor' },
      { term: 'consent', sev: 'major' },
      { term: 'age', sev: 'major' }
    ]

    for (let s of sentences) {
      s = s.trim()
      if (s.length < 35 || s.length > 250) continue

      const matchedKeyword = keywords.find(k => new RegExp('\\b' + k.term + '\\b', 'i').test(s))
      if (matchedKeyword) {
        let category = 'General Safety'
        if (/age/i.test(s)) category = 'Age Gate'
        else if (/consent/i.test(s)) category = 'Consent'
        else if (/message|chat|dm/i.test(s)) category = 'Direct Messaging'
        else if (/data|privacy|collect/i.test(s)) category = 'Data Safety'
        else if (/filter|content|screen/i.test(s)) category = 'Content Filtering'
        else if (/nudge|dark|pattern/i.test(s)) category = 'Dark Patterns'

        let reference = ''
        const refMatch = s.match(/\b(section|clause|paragraph|rule|std)\s+\d+[\d.]*\b/i)
        if (refMatch) {
          reference = refMatch[0]
        } else {
          const numMatch = s.match(/\b\d+\.\d+(\.\d+)?\b/)
          if (numMatch) {
            reference = 'Clause ' + numMatch[0]
          }
        }

        items.push({
          id: `ci_fallback_${Date.now()}_${idx++}`,
          category,
          text: s.replace(/^\s*-\s*/, ''),
          severity: matchedKeyword.sev,
          reference: reference || 'Clause Reference',
          helpText: `Verification instruction: Inspect the platform settings and features to ensure compliance with this requirement: "${s}"`
        })
      }
    }

    res.json({ items: items.slice(0, 15), _aiUsed: false, _fallbackReason: String(error) })
  }
})

app.post('/api/generator/merge-items', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { items, platform } = req.body
    if (!items || !Array.isArray(items) || !items.every((i: any) => i && typeof i === 'object' && (i.text === undefined || typeof i.text === 'string'))) {
      return res.status(400).json({ error: 'items array is required' })
    }
    if (platform !== undefined && typeof platform !== 'string') {
      return res.status(400).json({ error: 'platform must be a string' })
    }

    if (items.length === 0) {
      return res.json([])
    }

    const apiKey = process.env.GROQ_API_KEY
    const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'

    if (!apiKey) {
      return res.status(500).json({ error: 'GROQ_API_KEY is not configured on the backend server' })
    }

    const seenNorm = new Set<string>()
    const dedupedItems = items
      .filter((item: any) => {
        const norm = (item.text || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80)
        if (!norm || seenNorm.has(norm)) return false
        seenNorm.add(norm)
        return true
      })
      .slice(0, 60)
      .map((item: any) => ({
        id: item.id,
        category: item.category,
        text: (item.text || '').slice(0, 300),
        severity: item.severity,
        reference: item.reference || '',
      }))

    const systemPrompt = `You are an expert compliance auditor. You will be provided with a raw list of child safety compliance check items extracted from different parts of a document for ${platform || 'social media platforms'}.
Your task is to:
1. Merge and deduplicate items that are highly similar or check the exact same thing.
2. Group the items into a logical set of categories.
3. Clean up the descriptions to make them highly professional, clear, and uniform in tone.
4. Keep the original references where possible, or list them if multiple items were merged.
5. Limit the final merged list to at most 12 of the most critical and distinct checklist items.

You MUST return your output in JSON format matching this EXACT schema:
{
  "name": "A suitable name for this compiled framework (e.g. EDPB Guidelines 3/2022 on Dark Patterns)",
  "shortName": "A short uppercase identifier, e.g. EDPB-DP",
  "categories": ["Category 1", "Category 2", ...],
  "items": [
    {
      "id": "A unique string ID, e.g. ci_merged_1",
      "category": "Category Name",
      "text": "Polished check question...",
      "severity": "critical|major|minor",
      "reference": "Clause/Section reference",
      "helpText": "Polished audit guidance or explanation of how to verify this requirement."
    }
  ]
}`

    const response = await groqFetchWithRetry('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Here is the list of raw checklist items:\n\n${JSON.stringify(dedupedItems, null, 2)}` }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2
      })
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Groq API error: ${err}`)
    }

    const data = await response.json() as any
    const content = data.choices?.[0]?.message?.content

    const parsed = JSON.parse(content || '{}')
    res.json({ ...parsed, _aiUsed: true })

  } catch (error) {
    console.error('[AI_ENGINE_ERROR] Groq LLM connection failed during item merging:', {
      timestamp: new Date().toISOString(),
      error: String(error),
      fallback: 'local_deduplication',
    })

    const uniqueItems: any[] = []
    const seenTexts = new Set()

    for (const item of (req.body.items || [])) {
      const normalized = (item.text || '').toLowerCase().replace(/[^a-z0-9]/g, '')
      if (!normalized || seenTexts.has(normalized)) continue
      seenTexts.add(normalized)

      uniqueItems.push({
        id: item.id || `ci_merged_${uniqueItems.length + 1}`,
        category: item.category || 'General',
        text: item.text,
        severity: item.severity || 'major',
        reference: item.reference || 'N/A',
        helpText: item.helpText || `Verify compliance with the child safety rule: "${item.text}"`
      })
    }

    const categories = Array.from(new Set(uniqueItems.map(it => it.category)))

    res.json({
      name: 'Age Appropriate Design Code (Extracted Guidelines)',
      shortName: 'AADC-CODE',
      categories: categories.length > 0 ? categories : ['General'],
      items: uniqueItems.slice(0, 15),
      _aiUsed: false,
      _fallbackReason: String(error),
    })
  }
})

async function askGroq(systemPrompt: string, userPrompt: string): Promise<any> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error('GROQ_API_KEY is not configured on the backend server')
  const response = await groqFetchWithRetry('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    }),
  })
  if (!response.ok) throw new Error(`Groq API error: ${await response.text()}`)
  const data = await response.json() as any
  return JSON.parse(data.choices?.[0]?.message?.content || '{}')
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

app.post('/api/guidelines/:id/mappings/generate', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Guideline not found.' })
    const result = await mapping.generateMappingsForGuideline(req.params.id, askGroq)
    res.json(result)
  } catch (error) {
    sendError(res, error)
  }
})

app.get('/api/mappings', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const guidelineId = typeof req.query.guidelineId === 'string' ? req.query.guidelineId : undefined
    res.json(await mapping.fetchMappings(guidelineId))
  } catch (error) {
    sendError(res, error)
  }
})

app.get('/api/mappings/coverage', requireAuth, async (req, res) => {
  try {
    res.json(await mapping.fetchCoverage())
  } catch (error) {
    sendError(res, error)
  }
})

app.patch('/api/mappings/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { status, relation } = req.body
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Mapping not found.' })
    if (!['suggested', 'confirmed', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'status must be suggested, confirmed or rejected.' })
    }
    if (relation !== undefined && !['equivalent', 'partial'].includes(relation)) {
      return res.status(400).json({ error: 'relation must be equivalent or partial.' })
    }
    await mapping.reviewMapping(req.params.id, status, relation, req.user!.userId)
    res.json({ success: true })
  } catch (error) {
    sendError(res, error)
  }
})

app.get('/api/projects/:id/suggestions', requireAuth, requireProjectAccess('id'), async (req, res) => {
  try {
    res.json(await mapping.fetchProjectSuggestions(req.params.id, req.user!.userId))
  } catch (error) {
    sendError(res, error)
  }
})

const MAX_ACCEPT_ITEMS = 500

app.post('/api/projects/:id/suggestions/accept', requireAuth, requireRole('auditor'), requireProjectAccess('id'), async (req, res) => {
  try {
    const { itemIds } = req.body
    if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.length > MAX_ACCEPT_ITEMS
      || !itemIds.every((i) => typeof i === 'string' && UUID_RE.test(i))) {
      return res.status(400).json({ error: `itemIds must be a list of 1 to ${MAX_ACCEPT_ITEMS} item ids.` })
    }
    const accepted = await mapping.acceptSuggestions(req.params.id, req.user!.userId, itemIds)
    res.json({ accepted })
  } catch (error) {
    sendError(res, error)
  }
})

app.post('/api/projects/:id/suggestions/dismiss', requireAuth, requireRole('auditor'), requireProjectAccess('id'), async (req, res) => {
  try {
    const { itemId, sourceItemId } = req.body
    if (typeof itemId !== 'string' || typeof sourceItemId !== 'string') {
      return res.status(400).json({ error: 'itemId and sourceItemId are required.' })
    }
    await mapping.dismissSuggestion(req.params.id, req.user!.userId, itemId, sourceItemId)
    res.json({ success: true })
  } catch (error) {
    sendError(res, error)
  }
})

app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err)
  if (err instanceof CorsRejectedError) {
    return res.status(403).json({ error: 'Not allowed by CORS' })
  }
  if ((err as any)?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON.' })
  }
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})
