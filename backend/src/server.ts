import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import * as db from './services/dbService.js'

dotenv.config()

const app = express()
const port = process.env.PORT || 3000

app.use(cors())
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ limit: '50mb', extended: true }))

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() })
})

// ─── Users ──────────────────────────────────────────────────────────────────
app.get('/api/users', async (req, res) => {
  try {
    const users = await db.fetchAllUsers()
    res.json(users)
  } catch (error) {
    console.error('Error fetching users:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

app.post('/api/users', async (req, res) => {
  try {
    const { userId, userName, userEmail, role, userPassword } = req.body
    await db.createUser({ userId, userName, userEmail, role, userPassword })
    res.status(201).json({ success: true })
  } catch (error) {
    console.error('Error creating user:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

// ─── Projects ────────────────────────────────────────────────────────────────
app.get('/api/projects', async (req, res) => {
  try {
    const userId = req.query.userId as string
    if (!userId) {
      return res.status(400).json({ error: 'userId parameter is required' })
    }
    const projects = await db.fetchUserProjects(userId)
    res.json(projects)
  } catch (error) {
    console.error('Error fetching user projects:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

app.get('/api/projects/compliance-summary', async (req, res) => {
  try {
    const idsString = req.query.ids as string
    if (!idsString) {
      return res.json({})
    }
    const ids = idsString.split(',')
    const summary = await db.fetchProjectComplianceSummary(ids)
    res.json(summary)
  } catch (error) {
    console.error('Error fetching compliance summary:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

app.get('/api/projects/:id', async (req, res) => {
  try {
    const details = await db.fetchProjectDetails(req.params.id)
    res.json(details)
  } catch (error) {
    console.error('Error fetching project details:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

app.post('/api/projects', async (req, res) => {
  try {
    const projectId = await db.createProject(req.body)
    res.status(201).json({ projectId })
  } catch (error) {
    console.error('Error creating project:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

app.patch('/api/projects/:id', async (req, res) => {
  try {
    await db.updateProject(req.params.id, req.body)
    res.json({ success: true })
  } catch (error) {
    console.error('Error updating project:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

app.delete('/api/projects/:id', async (req, res) => {
  try {
    await db.deleteProject(req.params.id)
    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting project:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

// Members
app.post('/api/projects/:id/members', async (req, res) => {
  try {
    const projectId = req.params.id
    const userIds = (req.body.userIds || []) as string[]
    
    // 1. Fetch current details to see existing members
    const details = await db.fetchProjectDetails(projectId)
    const existingUserIds = (details?.members || []).map((m: any) => m.userId) as string[]
    
    // 2. Perform sync
    await db.syncProjectMembers(projectId, userIds)
    
    // 3. Find newly added userIds
    const newUserIds = userIds.filter((id: string) => !existingUserIds.includes(id))
    
    // 4. Send emails asynchronously
    for (const userId of newUserIds) {
      db.sendAssignmentEmail(projectId, userId).catch((err) => {
        console.error('Error in sendAssignmentEmail async chain:', err)
      })
    }
    
    res.json({ success: true })
  } catch (error) {
    console.error('Error syncing project members:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

app.post('/api/projects/:id/members/add', async (req, res) => {
  try {
    const projectId = req.params.id
    const userId = req.body.userId as string
    
    // 1. Perform add
    await db.addProjectMember(projectId, userId)
    
    // 2. Send email asynchronously
    db.sendAssignmentEmail(projectId, userId).catch((err) => {
      console.error('Error in sendAssignmentEmail async chain:', err)
    })
    
    res.json({ success: true })
  } catch (error) {
    console.error('Error adding project member:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

app.delete('/api/projects/:id/members/:userId', async (req, res) => {
  try {
    await db.removeProjectMember(req.params.id, req.params.userId)
    res.json({ success: true })
  } catch (error) {
    console.error('Error removing project member:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

// Guidelines
app.post('/api/projects/:id/guidelines', async (req, res) => {
  try {
    await db.syncProjectGuidelines(req.params.id, req.body.guidelineIds)
    res.json({ success: true })
  } catch (error) {
    console.error('Error syncing guidelines:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

// Scope
app.post('/api/projects/:id/scope', async (req, res) => {
  try {
    await db.syncProjectScope(req.params.id, req.body.features)
    res.json({ success: true })
  } catch (error) {
    console.error('Error syncing project scope:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

// Create guideline template (admin)
app.post('/api/guidelines', async (req, res) => {
  try {
    const { guideline, items } = req.body
    console.log("--- POST /api/guidelines received ---");
    console.log("Total items count:", items?.length);
    console.log("Payload size (bytes):", JSON.stringify(req.body).length);
    await db.createGuideline({ guideline, items })
    res.status(201).json({ success: true })
  } catch (error) {
    console.error('Error creating guideline:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

// ─── Guidelines Global ──────────────────────────────────────────────────────
app.get('/api/guidelines', async (req, res) => {
  try {
    const guidelines = await db.fetchGuidelines()
    res.json(guidelines)
  } catch (error) {
    console.error('Error fetching guidelines:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

app.delete('/api/guidelines/:id', async (req, res) => {
  try {
    await db.deleteGuideline(req.params.id)
    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting guideline:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

// Fetch global template items for a guideline (admin/guidelines view)
app.get('/api/guidelines/:id/items', async (req, res) => {
  try {
    const items = await db.fetchGuidelineItems(req.params.id)
    res.json(items)
  } catch (error) {
    console.error('Error fetching guideline items:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

// ─── Checklist Items ──────────────────────────────────────────────────────────
app.get('/api/projects/:id/checklist', async (req, res) => {
  try {
    const items = await db.fetchProjectChecklistItems(req.params.id)
    res.json(items)
  } catch (error) {
    console.error('Error fetching checklist items:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

app.post('/api/projects/:id/checklist/items', async (req, res) => {
  try {
    const { category, text, severity, reference, guidelineId, itemName, itemCode, helpText, verbatimClauseText, answerOptions } = req.body
    const projectId = req.params.id
    const itemId = await db.addProjectChecklistItem(projectId, guidelineId, {
      category, text, severity, reference, itemName, itemCode, helpText, verbatimClauseText, answerOptions,
    })
    res.status(201).json({ itemId })
  } catch (error) {
    console.error('Error adding checklist item:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

app.patch('/api/projects/:projectId/results/:itemId/findings', async (req, res) => {
  try {
    const { userId, findings } = req.body
    await db.saveAuditFindings(req.params.projectId, req.params.itemId, userId, findings ?? '')
    res.json({ success: true })
  } catch (error) {
    console.error('Error saving findings:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

app.post('/api/projects/:id/checklist/categories/toggle', async (req, res) => {
  try {
    const { category, enabled, guidelineId } = req.body
    const projectId = req.params.id
    await db.toggleProjectChecklistCategory(projectId, guidelineId, category, enabled)
    res.json({ success: true })
  } catch (error) {
    console.error('Error toggling category:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

app.patch('/api/checklist/items/:id', async (req, res) => {
  try {
    await db.updateChecklistItem(req.params.id, req.body)
    res.json({ success: true })
  } catch (error) {
    console.error('Error updating checklist item:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

app.delete('/api/checklist/items/:id', async (req, res) => {
  try {
    await db.deleteChecklistItem(req.params.id)
    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting checklist item:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

// ─── Audit Results ────────────────────────────────────────────────────────────
app.get('/api/projects/:id/results', async (req, res) => {
  try {
    const results = await db.fetchAuditResults(req.params.id)
    res.json(results)
  } catch (error) {
    console.error('Error fetching audit results:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

app.post('/api/projects/:id/results', async (req, res) => {
  try {
    const { itemId, userId, guidelineId, result, notes } = req.body
    const scoreData = await db.upsertAuditResult(
      req.params.id,
      itemId,
      userId,
      guidelineId,
      result,
      notes
    )
    res.json(scoreData)
  } catch (error) {
    console.error('Error upserting audit result:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

// ─── Submission Workflow ──────────────────────────────────────────────────────
app.post('/api/projects/:id/submit', async (req, res) => {
  try {
    await db.submitForReview(req.params.id)
    res.json({ success: true })
  } catch (error) {
    console.error('Error submitting project for review:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

app.post('/api/projects/:id/review', async (req, res) => {
  try {
    const { approved, remarks } = req.body
    await db.reviewSubmission(req.params.id, approved, remarks)
    res.json({ success: true })
  } catch (error) {
    console.error('Error reviewing project submission:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

// ─── Compliance Scores & Reports ──────────────────────────────────────────────
app.get('/api/projects/:id/compliance-scores', async (req, res) => {
  try {
    const scores = await db.fetchComplianceScores(req.params.id)
    res.json(scores)
  } catch (error) {
    console.error('Error fetching compliance scores:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

app.get('/api/reports', async (req, res) => {
  try {
    const userId = req.query.userId as string
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' })
    }
    const filters = {
      statusFilter: req.query.statusFilter as any,
      search: req.query.search as string,
      dateFrom: req.query.dateFrom as string,
      dateTo: req.query.dateTo as string,
    }
    const reports = await db.fetchAuditReports(userId, filters)
    res.json(reports)
  } catch (error) {
    console.error('Error fetching audit reports:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})

app.post('/api/reports', async (req, res) => {
  try {
    const { projectId, userId } = req.body
    const reportId = await db.createAuditReport(projectId, userId)
    res.status(201).json({ reportId })
  } catch (error) {
    console.error('Error creating audit report:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
  }
})


// ─── Llama 3.3 Groq Generator Routes ──────────────────────────────────────────
app.post('/api/generator/process-chunk', async (req, res) => {
  try {
    const { textChunk, platform } = req.body
    if (!textChunk) {
      return res.status(400).json({ error: 'textChunk is required' })
    }

    const apiKey = process.env.GROQ_API_KEY
    const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'

    if (!apiKey) {
      return res.status(500).json({ error: 'GROQ_API_KEY is not configured on the backend server' })
    }

    const systemPrompt = `You are a compliance assistant specializing in child safety regulation and social media platform audits.
Analyze the provided text snippet from a regulatory guideline document and extract child safety compliance check items.
Focus on identifying concrete, auditable items suitable for checking a platform like ${platform || 'social media platforms'}.

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

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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
    res.json(parsed.items || [])

  } catch (error) {
    console.warn('Groq API failed, using local heuristic fallback parser:', error)
    
    // Heuristic Extractor Fallback
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
        const refMatch = s.match(/\\b(section|clause|paragraph|rule|std)\\s+\\d+[\\d.]*\\b/i)
        if (refMatch) {
          reference = refMatch[0]
        } else {
          const numMatch = s.match(/\\b\\d+\\.\\d+(\\.\\d+)?\\b/)
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

    res.json(items.slice(0, 15))
  }
})

app.post('/api/generator/merge-items', async (req, res) => {
  try {
    const { items, platform } = req.body
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'items array is required' })
    }

    if (items.length === 0) {
      return res.json([])
    }

    const apiKey = process.env.GROQ_API_KEY
    const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'

    if (!apiKey) {
      return res.status(500).json({ error: 'GROQ_API_KEY is not configured on the backend server' })
    }

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

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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
          { role: 'user', content: `Here is the list of raw checklist items:\n\n${JSON.stringify(items, null, 2)}` }
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
    res.json(parsed)

  } catch (error) {
    console.warn('Groq merge failed, using local deduplication fallback:', error)
    
    // Fallback merge
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
      items: uniqueItems.slice(0, 15)
    })
  }
})

app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})
