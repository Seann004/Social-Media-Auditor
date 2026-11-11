# AI-Assisted Evidence Assessment — Design

**Date:** 2026-11-01
**Status:** Draft for review
**Scope of this version:** webpage evidence only (no codebase access)

---

## 1. Summary

The AI-Assisted Evidence Assessment feature lets an auditor point SafetyAudit at the public website of the social media platform being audited. The system visits the pages, saves their text and a screenshot of each one, and stores this as evidence for the project. A large language model then compares the evidence with each checklist item and suggests a result: Yes, No, Partially or Not Applicable. Each suggestion comes with a written reason and the exact quotes it relied on, and each quote links to a screenshot with the sentence highlighted on the page.

When evidence is missing, conflicting or inaccessible, cannot be verified, or can't be judged from a website at all, the system flags the item for human review and says why. The AI never answers an item by itself. The auditor accepts or overrides every suggestion, and the system records who decided what, so the audit stays traceable and consistent. The AI speeds up evidence gathering and gives a first opinion; the auditor keeps the final judgement.

---

## 2. Why

- Today an auditor answers every item by hand: they visit the platform, read its policies, take screenshots and upload them one at a time. That is slow, and two auditors may judge the same evidence differently.
- Most of that time goes into **finding and capturing** evidence, not judging it. The machine is good at that part; the judging should stay human.
- For the FYP, the feature shows **responsible AI use**: a human always decides, every suggestion is backed by evidence you can check, and the system is honest about what it cannot tell.

---

## 3. Goals, non-goals, anti-goals

**Goals**
- Collect evidence from a platform's webpages automatically: text, screenshots and page structure.
- Suggest a result for each checklist item, with a reason and verifiable quotes.
- Flag items that need human attention, and give a clear reason for each flag.
- Let the auditor accept or override each suggestion, and record that decision.
- Show, everywhere an answer appears, whether it came from an accepted AI suggestion, an override, or a manual answer.
- Work when several auditors use it at the same time.
- Cost close to nothing to run at FYP scale.

**Non-goals (this version)**
- Reading the platform's source code (GitHub). Listed as future work.
- Testing mobile apps.
- An AI that clicks around the site on its own.
- Getting around bot protection or captchas.
- Having the AI look at screenshots (the current model can't read images). Screenshots are evidence for people.

**Anti-goals: things that would make this a failure even if it technically works**
- An AI suggestion that silently becomes the answer, or counts toward the compliance score before an auditor confirms it.
- A suggestion that looks confident but whose quotes can't be found in the evidence.
- Test-account passwords or personal data ending up in AI prompts, logs or screenshots shown to the wrong people.
- The server becoming a tool for visiting internal addresses (see §13, "server-side request forgery").

---

## 4. Decided in discussion vs. builder's calls

**Decided by the project owner**
- Evidence comes from **webpages only** in this version.
- The AI suggests Yes / No / Partially / N/A with a reason and screenshot references.
- Items are flagged for human review when evidence is missing, conflicting or inaccessible, or confidence is low, and the reason is shown.
- The **auditor always makes the final decision** (confirm or override).
- **Other people will use the feature**, so the browser runs on the server, not on users' machines.
- Assume the audited platform **has given permission**. Test accounts are therefore possible (Phase 2).
- Keep it **low-cost**: Groq + Supabase free tiers where possible.

**Builder's calls (made while writing this design; can be changed)**
- Keep the current AI model: **Groq, Llama 3.3 70B**, a text-only model.
- Use **Playwright** (headless Chromium) on the backend. Run it locally during development; when deployed, use either a container with Playwright's official Docker image or a hosted browser service, chosen by one setting.
- Find relevant passages with **Postgres full-text search** in Supabase, not embeddings.
- Assess **one checklist category per AI call** to stay inside Groq's limits.
- Compute flags with **rules**. The AI's own confidence is only one input.
- Make an **override reason required**, both for traceability and so we can measure where the AI was wrong.
- Store screenshots in a **private Supabase Storage bucket**, not inside database rows.
- **One current answer per item**, matching what the audit page actually shows today. `Audit_Result` stores a row per auditor, but the page, the submit check and scoring all show a single answer per item. Any assigned auditor can accept or override, the latest decision wins, and the full history is kept. *(Pending confirmation, §18 Q2.)*
- The backend uses a **Supabase service-role key**, kept only in `backend/.env`. New tables and the screenshot bucket have **row-level security** that refuses the public (anon) key, so only the backend can read or write them.
- Respect `robots.txt` unless the Head Auditor records on the project that the platform gave permission (§13.3).
- Build in three phases (§15).

---

## 5. How it works: end to end

1. **Set up sources.** On the audit page, an auditor (or the project's Head Auditor) enters one or more starting links, for example the privacy policy, the help centre and the sign-up page.
2. **Start a run.** The backend creates a run, puts it in a queue, and the page shows progress.
3. **Capture.** A headless browser visits each starting page, plus same-site links up to a set depth and page limit. For each page it saves:
   - the text
   - a text outline of buttons and switches, including on/off states
   - a full-page screenshot
   - the URL, HTTP status and time captured
4. **Split and index.** Page text is split into passages, and the passages are indexed for search.
5. **Assess.** For each checklist category, the system finds the most relevant passages and sends them to the AI together with that category's items. The AI returns, per item:
   - a suggested result
   - a reason
   - exact quotes
   - whether the evidence was enough, conflicting, or impossible to judge from a website
6. **Verify.** The system checks that every quote really appears in the stored text. For each quote that does, it goes back to the page, highlights the sentence and saves a close-up screenshot.
7. **Flag.** Rules attach review flags, each with a reason (§8).
8. **Review.** The auditor sees a suggestion card on each item and accepts it or overrides it. Accepting fills in the auditor's answer the normal way.
9. **Traceability.** The Head Auditor's review screen, and later the report, show where each answer came from.

---

## 6. Evidence collection

### 6.1 Sources
| Source | Phase | Notes |
|---|---|---|
| Starting links + same-site link following | 1 | Limits on depth and page count. Defaults: depth 1, max 30 pages. |
| Test-account login | 2 | The platform provides the accounts. Login steps are stored, and the password is encrypted. |
| Recorded journeys (e.g. "sign up with a 2013 birth year") | 3 | Stored as a **list of safe steps** (go to, click text, fill, select, wait, screenshot), **never as code**, so users can't run arbitrary code on the server. Playwright's recorder can be used to draft the steps. |

### 6.2 What is saved per page
- requested URL and final URL after redirects
- HTTP status, page title, capture time, a hash of the content
- visible text
- an outline of interactive elements and their states (Playwright's accessibility snapshot), so a text-only AI can tell which switches are on or off
- a full-page screenshot, compressed JPEG
- access status: `ok`, `error`, `timeout`, `login_required` or `blocked`

### 6.3 Detecting access problems
A page is marked `login_required` if it redirects to a login URL or its main content is a password form. It is marked `blocked` if it shows a bot challenge or captcha. The system **does not try to get past either**. It records the problem, and that feeds the "inaccessible" flag.

### 6.4 Passages
Page text is split into passages of a few hundred words. Each passage keeps a link to its page and its position on the page. Passages are indexed with Postgres full-text search so the system can find "passages about age checks" quickly and for free.

---

## 7. AI assessment

### 7.1 One call per category
For each enabled checklist category in the project:
1. Search passages using the text of that category's items. Keep the best matches, up to a token budget per call (default about 5,000 input tokens, set as a constant).
2. Send the AI those items and passages, each passage labelled with an ID.
3. Use JSON output mode and a low temperature (0.1), the same as the existing generator calls.

### 7.2 Rules given to the AI
- Use **only** the passages provided. Don't use outside knowledge about the platform.
- Quote **exactly**. Every claim must come with at least one quote and its passage ID.
- If the passages don't settle the item, say the evidence is insufficient instead of guessing.
- Say when an item **can't be judged from a website** at all, for example "data is deleted from servers after 30 days".
- N/A means the feature doesn't exist on the platform. It does **not** mean "no evidence found".

### 7.3 Output per item
```json
{
  "itemId": "…",
  "suggestedResult": "yes | no | partially | not_applicable",
  "reason": "Plain-language explanation for the auditor.",
  "quotes": [{ "passageId": "…", "text": "exact words from the passage" }],
  "evidenceSufficient": true,
  "conflicting": false,
  "webAssessable": true,
  "confidence": "high | medium | low"
}
```
Results map onto the existing statuses: yes → `compliant`, no → `non_compliant`, partially → `partially`, not_applicable → `not_applicable`.

### 7.4 Quote check and highlight screenshots
- A quote counts as **verified** if, after normalising spacing and quote marks, it appears in the passage it names.
- For each verified quote, the system finds the sentence on the page, highlights it, and saves a close-up screenshot. That screenshot is the evidence reference shown to the auditor.
- Unverified quotes are kept but marked, and they trigger a flag.

### 7.5 Recorded with every suggestion
Model name, prompt version, run ID and the passage IDs sent. This makes it possible to explain later why the AI said what it said.

---

## 8. Review flags

A suggestion with **any** flag is shown as "Needs human review", with each reason listed. Accepting a flagged suggestion is still allowed: the auditor decides.

| Flag | Raised when | Example reason shown |
|---|---|---|
| **Missing evidence** | No relevant passages found, or the AI says the evidence is insufficient | "No captured page mentions how age is checked at sign-up." |
| **Inaccessible** | A relevant page needed a login, was blocked, timed out or returned an error | "The account settings page required a login and could not be captured." |
| **Conflicting** | The AI reports conflicting evidence | "The privacy policy says teen accounts are private by default; the help centre says users choose at sign-up." |
| **Unverified quote** | A quote isn't found in the passage it names | "One quoted sentence could not be found in the captured page." |
| **Low confidence** | The AI rates its confidence low | "The AI marked this suggestion as low confidence." |
| **Not judgeable from website** | The AI says the item needs internal evidence | "This item is about server-side data deletion, which a website can't show." |

These AI review flags are **separate from the auditor's existing "Flag" (`needs_review`)**. They must look different in the interface so the two aren't confused. An auditor can still raise their own flag as usual.

---

## 9. Auditor experience

Follows `DESIGN.md` (colours, spacing, motion).

### 9.1 Project level (audit page)
An **AI Evidence Assessment** panel containing:
- a form for starting links (Phase 2: test account; Phase 3: journeys)
- a **Run** button
- progress: pages captured / failed, categories assessed
- last run summary: when it ran, pages, suggestions, how many were flagged, any problems (e.g. "AI daily limit reached; 3 categories not assessed")
- **Re-assess**, which runs the AI again on evidence already captured, without visiting the pages again. It creates a new run that reuses the captured pages. By default it assesses **only the categories the latest run didn't finish** (e.g. after hitting the daily AI limit). A "re-assess all categories" option redoes everything, which is useful after prompt changes.

### 9.2 Item level
For each item with a suggestion, a card shows:
- the suggested result and the reason
- evidence: each quote with its page link and highlight-screenshot thumbnail (click to enlarge)
- review flags and their reasons
- **Accept**: sets the auditor's answer to the suggested result through the existing answer-saving path, pre-fills findings with the reason (editable), and attaches the highlight screenshots as evidence
- **Override**: the auditor picks a different result and must give a short reason; the same saving path is used

A filter shows only flagged suggestions. Counts appear on the category navigation.

### 9.3 Rules
- A suggestion **never** changes an answer or the compliance score until an auditor accepts or overrides it.
- Submitting for review works exactly as it does now: every enabled item must have an auditor answer.

### 9.4 When the answer and the suggestion drift apart (builder's calls)
- **Changing an answer after accepting:** if an item's answer came from an accepted suggestion and the auditor then uses the normal Yes/No/Partially/N/A buttons, the change is treated as an **override**. The auditor is asked for the reason before it saves, so overrides can't skip the reason.
- **Answered by hand before the suggestion arrives:** the card shows whether the AI **agrees** or **disagrees** with the auditor's answer. If it agrees, it's recorded as accepted. If it disagrees, the card stays open until the auditor accepts the suggestion or keeps their answer with a reason (an override).
- **A later run disagrees with an item already decided:** existing decisions are never changed automatically. The card shows "New suggestion differs from current answer", and the auditor can act on it or leave it.
- **Which run's suggestions are shown:** the latest run whose status is `completed` or `partial`.

### 9.5 Head Auditor review and reports
Every answer carries its origin: **"AI suggested Yes · accepted"**, **"AI suggested Yes · overridden to Partially: <reason>"**, or **"Manual"**. Reports show the same marker and link to the evidence (Should-have; see §15).

---

## 10. Roles and permissions

| Action | Admin | Head Auditor (own project) | Auditor (assigned) |
|---|---|---|---|
| Set up sources, start a run | – | ✓ | ✓ |
| View suggestions and evidence | – | ✓ | ✓ |
| Accept / override | – | – (reviews only, as today) | ✓ (any assigned auditor; one current answer per item) |
| Record "platform gave permission" | – | ✓ | – |

**Prerequisite: server-side identity checks.** Today login runs in the browser (`supabase.rpc('verify_user_login')`), the backend trusts the user ID sent by the browser, and role checks only happen in the frontend (`RoleRoute`). That's not safe for a feature that makes the server visit websites and spend AI budget. Builder's calls:
- Add a backend login endpoint. It calls the same login check and returns a **signed session token**, with the secret kept in `backend/.env`. The new endpoints require that token and check project membership on the server. Existing endpoints can move over later.
- The backend uses a **Supabase service-role key** (only in `backend/.env`, never in the frontend). New tables and the screenshot bucket get **row-level security** that refuses the anon key. Without this, anyone with the frontend's public key could read screenshots or write decisions directly, bypassing the check above. Whoever owns the Supabase project needs to provide that key.

---

## 11. Data model (new tables)

Existing tables are unchanged, apart from how accepted or overridden answers are linked (below). Rows are added, never edited in place; a new run creates new rows.

| Table | Purpose | Key columns |
|---|---|---|
| `Evidence_Source` | Sources configured per project | projectId, type (`url`, `test_account`, `journey`), startUrls, encrypted login details (Phase 2), steps (Phase 3), createdBy |
| `Evidence_Permission` | Record that the platform permitted automated access | projectId, granted (bool), note (who gave permission, how), recordedBy (Head Auditor), recordedAt |
| `Evidence_Run` | One capture + assessment run | projectId, startedBy, status (`queued`, `capturing`, `assessing`, `completed`, `failed`, `partial`), progress counts, tokensUsed, model, promptVersion, error, timestamps |
| `Evidence_Page` | One captured page | runId, url, finalUrl, httpStatus, accessStatus, title, text, accessibilitySnapshot, screenshotPath, contentHash, capturedAt |
| `Evidence_Passage` | Searchable piece of page text | pageId, position, text, search index column |
| `AI_Suggestion` | AI result for one item in one run | runId, projectId, itemId, suggestedResult, reason, confidence, flags (list of {type, reason}), createdAt |
| `AI_Suggestion_Quote` | A quote backing a suggestion | suggestionId, passageId, quoteText, verified, highlightScreenshotPath |
| `AI_Suggestion_Decision` | An auditor's decision | suggestionId, userId, decision (`accepted`, `overridden`), finalResult, overrideReason, decidedAt |

The **latest decision per item** defines provenance. Earlier decisions stay as history. The builder decides how answers in `Audit_Result` link back to the decision, e.g. a nullable `suggestionDecisionId` column.

Screenshots live in a **private Supabase Storage bucket** and are shown through short-lived signed links. Existing manual evidence images are stored as base64 text inside `Audit_Result`. Doing the same for AI screenshots would fill the 500 MB free database quickly. The builder decides how accepted highlight screenshots appear in the item's existing evidence list.

---

## 12. Backend API (new)

All endpoints require the server-side identity check from §10.

| Method & path | Who | Does |
|---|---|---|
| `GET /api/projects/:id/evidence-sources` | project members | List sources |
| `POST /api/projects/:id/evidence-sources` | Head Auditor, Auditor | Add or update sources (validated, §13) |
| `POST /api/projects/:id/evidence-runs` | Head Auditor, Auditor | Start a run (capture + assess) |
| `POST /api/projects/:id/evidence-runs/:runId/reassess` | Head Auditor, Auditor | Assess again using captured evidence |
| `GET /api/projects/:id/evidence-runs/latest` | project members | Status and progress (polled by the UI) |
| `GET /api/projects/:id/suggestions` | project members | Suggestions from the latest run with status `completed` or `partial`, with quotes, flags and the current decision per item |
| `PUT /api/projects/:id/evidence-permission` | Head Auditor | Record or clear "platform gave permission" |
| `POST /api/suggestions/:id/decision` | Auditor | Accept or override; writes the decision and saves the answer through the existing path |
| `GET /api/evidence/screenshots/:pageOrQuoteId` | project members | Returns a short-lived signed link |

Responses use the existing JSON style of the backend.

---

## 13. Running jobs, limits and security

### 13.1 Jobs
- A queue inside the backend process. Number of runs at once is a constant (default 1).
- One shared Chromium instance, with a **separate browser context per run**, so cookies and logins never mix between runs. Contexts are closed after use.
- Status is stored in `Evidence_Run`, and the UI polls every few seconds.
- On server start, runs left in progress are marked `failed` with the reason "server restarted".
- Groq rate limits: reuse the existing `groqFetchWithRetry`. If the daily limit is reached, the run ends as `partial`: completed categories keep their suggestions, and the summary says which weren't assessed. **Re-assess** finishes them later.

### 13.2 Limits (constants, adjustable)
Max pages per run (30), link depth (1), page timeout (30 s), whole-run timeout, token budget per AI call (~5,000) and per run, max runs per project per day.

### 13.3 Security
- **Server-side request forgery protection.** Only `http`/`https` links are allowed. The system blocks private, local and cloud-metadata addresses, and applies that check to **every** request the browser makes (redirects and page resources included) using Playwright's request interception, after looking up the address.
- **Credentials (Phase 2):** encrypted at rest with a key from `backend/.env`. They are never sent to the AI and never logged, and screenshots taken on the login step are discarded.
- **Screenshots:** private bucket, signed links only, visible only to project members.
- **Input validation:** source URLs, step lists and decision bodies are validated at the API.
- **Rate limiting** on run creation.
- **Platform rules:** no captcha solving and no getting around blocks. Respect `robots.txt` unless the Head Auditor has recorded permission in `Evidence_Permission`. Pages skipped because of `robots.txt` are marked `blocked` with that reason, which feeds the "inaccessible" flag. The browser identifies itself with a user agent the platform can allowlist. For the real-data demo run, choose a platform and pages that its `robots.txt` allows. Some large platforms block crawlers they don't list by name, so check before choosing. Never record permission that wasn't given.

### 13.4 Privacy
Page text is sent to Groq, an outside provider. Test accounts must contain **made-up data only**. This limitation must be stated in the FYP report: a real platform would need to approve the AI provider, or the model would need to run inside the platform's own network.

---

## 14. Deployment and cost

- **Development and demo:** everything runs on a laptop with Playwright installed locally.
- **Deployed for others:** a container host using Playwright's official Docker image. Alternatively, a hosted browser service, connected through a `BROWSER_WS_ENDPOINT` setting. When the setting is present, the backend connects to it instead of starting Chromium itself.
- **Cost:** about US$0.03 per audit run when batched by category (Groq Llama 3.3 70B: about US$0.59 per million input tokens and US$0.79 per million output tokens). The free tier (about 100k tokens per day; check the Groq console) covers about two full runs a day. Supabase's free plan covers 1 GB of storage and a 500 MB database, and free projects pause after 7 days without use.

---

## 15. Phases

| Phase | Includes | Priority |
|---|---|---|
| **1 — Core (public pages)** | Sources (links), capture, passages, category assessment, quote check + highlight screenshots, review flags, suggestion cards with accept/override, provenance on the review screen, server-side identity check, request-forgery protection | Must |
| 1 | Re-assess without re-capturing; provenance in reports | Should |
| **2 — Test accounts** | Encrypted login details, logged-in capture, login-wall handling | Should |
| **3 — Journeys** | Safe step lists, step screenshots as evidence | Could |
| Future work | Code evidence (GitHub App / snapshot / on-site analyser), vision model on screenshots, mobile apps via Appium | Report only |

---

## 16. How we'll know it works

Recommended test target: a **small demo social media site built for the purpose**. Some features are compliant on purpose and some aren't, so the correct answer for every checklist item is known in advance. In addition, run the system once on a real platform's public pages to show it works on real data.

Measures (the data model records everything needed):
- **Accuracy:** share of suggestions that match the known answer, split into flagged and unflagged.
- **Flag usefulness:** share of wrong suggestions that were flagged.
- **Quote check pass rate.**
- **Acceptance rate:** accepted vs. overridden, plus the most common override reasons.
- **Time saved:** time to complete an audit with and without the feature.

### Testing
- Unit tests: passage splitting, quote checking, flag rules, the request-forgery guard, result mapping.
- Integration: capture against a local test site (including login-wall and error pages), and assessment with a mocked AI response.
- End-to-end (Playwright): run → suggestions appear → accept and override → answers and provenance show on the review screen.

---

## 17. Left to the builder

Prompt wording, passage size, search scoring, exact limits and thresholds, how highlights are drawn, the queue implementation, test framework choice, and the detailed layout of the panel and cards within `DESIGN.md`.

---

## 18. Open questions (for the project owner)

1. **Is the demo social media site part of this build, and which guideline's checklist should it be built against?** It's possibly the largest single piece of work. The accuracy measures and the end-to-end test depend on it, and its answer key has to match specific checklist items.
2. **When a project has several auditors, do they share one answer per item, or should each auditor answer every item?** This design assumes one shared answer (§4), because that's what the audit page shows today. If each auditor should answer separately, decisions, provenance and the existing scoring and submit logic all change.
