# App Evidence: AI-Driven Checks Inside a Platform's App — Design

**Status:** Draft for approval
**Builds on:** `docs/superpowers/specs/2026-11-01-ai-evidence-assessment-design.md` (Phase 1, webpage evidence, built on branch `feat/ai-evidence-assessment`)
**Next after this:** code repository evidence (separate design)

---

## 1. Why

SafetyAudit audits social media platforms for child safety. Phase 1 reads a platform's public web pages, which shows what the platform **says** about itself. An audit needs what the app **does**: whether an under-18 account really is private by default, whether an adult really can't message a teen. Today an auditor checks that by hand: log in as an under-18 account, open the settings, look at what's on, take a screenshot, mark Yes or No.

This feature lets the AI do those checks inside the platform's app, using test accounts the platform provides, and suggest an answer with screenshots as proof. The auditor still makes the decision.

Reading public web pages stays, as an extra source. The owner considers it outside the project's real aim.

## 2. Goals

- An auditor adds the platform's **web app address** and one or more **test accounts** to a project, each labelled (for example "Teen, 15", "Adult, 30").
- On a run, for each checklist item, the system logs in with the right test account(s) in a browser, and **the AI decides where to go and what to click** to find the answer.
- The AI may **change things** on the test accounts (switch a setting, have the adult test account try to message the teen test account) to test what the app allows.
- Each item gets the same kind of suggestion as Phase 1: Yes / No / Partially / N/A, a reason, evidence (screenshots and what the AI did), and review flags. Accept and override work as today.
- The auditor can **replay every step** the AI took, with a screenshot of each.
- Works on **any platform's web app** given access. Not tied to one platform.
- **The auditor picks which checklist items to check in the app** for each app run (owner's decision). Only those are checked, which keeps AI cost within the free plan for demos. Items not picked keep whatever suggestion they already have.

## 3. The success picture (owner agreed)

1. The auditor adds the app address and two test accounts (Teen 15, Adult 30) and clicks Run.
2. The examiner watches progress while the AI works through the app.
3. Minutes later each item has a suggestion, for example "Teen accounts private by default: **Yes**" with a screenshot of the settings showing the switch on, or "Adults can message teens: **No**" with screenshots of the adult account trying and being blocked.
4. The examiner opens a suggestion and replays each step with its screenshot.
5. The auditor accepts one and overrides another; the score changes only then.

## 4. Non-goals

- Reading code repositories (the next design).
- Native mobile apps. Web app only.
- Creating accounts. The platform provides the test accounts. (A later extra may check the sign-up steps without finishing a sign-up.)
- Solving captchas or getting around blocks, 2-factor codes, or bot detection.
- Choosing or setting up a demo platform. That's decided separately.

## 5. Anti-goals (failure even if it technically works)

- **Touching real people.** The AI messages, follows, comments on, tags or posts to anyone other than the project's own test accounts, or makes anything public.
- **Leaking credentials.** A test account's password reaches the AI, a log, a screenshot, a report or the browser of anyone using SafetyAudit.
- **Unproven answers.** A suggestion that claims something no recorded step shows.
- **Silent changes.** The app's test accounts left changed with no record of what changed.
- **Runaway cost.** A run that spends far more AI than its limit.

## 6. Constraints

- Same principles as Phase 1: suggestions never change answers or the score; the auditor decides; every claim must point to recorded evidence; no heuristic fallback when the AI is unavailable.
- **AI cost stays low enough for Groq's free plan for demos.** The AI works from page text and the page's accessibility tree, not from images (the current model, `openai/gpt-oss-120b`, is text-only). Screenshots are proof for people, not AI input.
- Per-check step limit and per-run token limit, both in `config.ts`.
- Assumes the platform has given permission to use its app with these accounts. robots.txt does not apply to logged-in use. **An app run does not require the Head Auditor's recorded permission** (owner's decision, for now); the existing permission tickbox keeps its Phase 1 meaning (robots.txt for public pages). The FYP report should state that real use needs the platform's agreement.
- **One suggestion per item, newest wins** (owner's decision). An app suggestion replaces an earlier public-pages suggestion for that item, and the other way round; Phase 1's "latest result run" rule and carry-forward apply unchanged, with each run recording its source (`app` or `pages`).
- Reuse what Phase 1 built: the guarded browser and URL guard (SSRF defence), page reading through an isolated world, the visibility filter, screenshots and storage, passages and quote checks, flags, runs and the queue, decisions, provenance, the panel and cards.
- Same roles as Phase 1: Auditors and the project's Head Auditor set up and run; Head Auditor records permission; Auditors decide.

## 7. How it works (decided)

### 7.1 Test accounts
- A project can have several test accounts: a label, an age group (`under_18` or `adult`), an age if known, the login name, and the password.
- **Passwords are encrypted at rest** with a key held only in the backend's environment. They're decrypted only inside the browser step that types them, never sent to the AI, never logged, never returned by any API, and masked in screenshots (the password field is blanked before any screenshot).
- The browser types the password itself. The AI only says "fill the password for account X here".

### 7.2 Which account for which item
The AI is given the checklist item and the list of account labels, and picks the account(s) it needs. A single check may use two accounts (for example adult tries to contact teen); each gets its own separate browser session.

### 7.3 The AI's loop for one check
1. Show the AI: the checklist item, the goal, the accounts available, the current page's visible text and accessibility tree (through Phase 1's isolated-world reader and visibility filter), and the steps so far.
2. The AI returns one action from a fixed list: open a link, click an element, type text into a field, select an option, toggle a switch, go back, switch account, or finish with its observations.
3. The system checks the action against the safety rules (7.4), carries it out, waits for the page to settle, takes a screenshot, and records the step.
4. Repeat until the AI finishes or the step limit is reached.

### 7.4 Safety rules, enforced by the system, not only asked of the AI
- **Only our own accounts.** Any action that reaches a person (message, follow, comment, tag, mention, invite, friend request) must name a target, and the target must be one of the project's test accounts; otherwise the system refuses the action.
- **Nothing public.** Actions whose control text means publishing to others (Post, Publish, Share, Go live, and similar) are refused unless the AI has set the audience to private or to test accounts only and the page confirms it. When unsure, refuse.
- **Destructive actions refused:** delete account, deactivate, change password, change email or phone, payments, purchases, sign out of other sessions.
- **Stay on the platform.** All navigation goes through Phase 1's guarded browser. Allowed: the app address's host and its subdomains, plus any extra login domains the auditor lists (for single sign-on pages). Anything else is refused. Private or local addresses (a demo or test app) are allowed only through the existing `EVIDENCE_ALLOWED_PRIVATE_HOSTS` setting.
- **Stop on blocks.** A captcha, 2-factor prompt, bot check or "suspicious activity" page ends the check and is reported as an inaccessible flag.
- Every refused action is recorded as a step, so the auditor sees what the AI tried.

### 7.5 Sessions and putting things back
Each test account logs in once per run, and its session is reused by every check in that run. The system records every setting the AI changed (before and after). At the end of each check it tries to put each one back, and records whether that worked. If something couldn't be put back, later checks still run, but they are told what was left changed, and it is listed on the run summary for the auditor. Checks run in checklist order.

### 7.5a Limits
The step limit applies per check and the token cap per run. When the run cap is reached, the run ends `partial`: the items already checked keep their suggestions, and the rest are listed as not checked, as in Phase 1. Re-assess for an app run re-judges the recorded steps without browsing again; the steps are stored as evidence the existing assessment can read (see 7.6).

### 7.6 Evidence
Each recorded step becomes evidence: the page text and screenshot, plus a plain line saying what was done and what happened ("Adult account opened Teen's profile; the Message button was not shown"). The AI's final answer for the item must quote recorded steps or page text; quotes are checked as in Phase 1. A suggestion whose claim no step supports gets flagged. Highlighted close-ups work as in Phase 1 where a quote is page text.

### 7.7 What the auditor sees
- The panel gets a choice of source: **App (test accounts)** or **Public pages**. The test accounts are managed in the panel; passwords are write-only.
- Progress shows the current item and step.
- Each card shows the suggestion and a **"Replay steps"** view: the steps in order, each with its screenshot and the line describing it, including refused actions and anything not put back.

## 8. Left to the builder

- Prompt wording; the exact step limit and token limits (sensible starting points: about 25 steps per check, the existing per-run token cap); how page text is trimmed for each step.
- Whether checks run one item at a time or group items that share a page, if grouping saves AI cost without losing proof.
- The encryption scheme (an authenticated cipher such as AES-256-GCM with a 32-byte key), key name, and table layout.
- The exact word lists for "reaches a person", "public" and "destructive", and how a target is identified on the page.
- Replay view layout, following `DESIGN.md`.
- Tests: a local fixture social app (sign in, privacy switch, messaging between accounts, a public post button, a captcha page) so every rule is tested without a real platform; the AI faked in tests.

## 9. Calls made by Claude (not asked of the owner)

- AI reads text and the accessibility tree, not screenshots, to keep cost low and fit the current text-only model.
- Passwords never go to the AI; the browser fills them.
- The safety rules are enforced in code, not only in the prompt.
- Changed settings are put back at the end where possible, and anything not restored is reported.
- One browser session per test account.
- The source choice (App or Public pages) is per run, in the existing panel; for an app run the panel lists the checklist items with tickboxes.
- Re-assess re-judges recorded steps rather than browsing again.
- Allowed domains: the app's host and subdomains plus auditor-listed login domains.
- One login per account per run; settings restored after each check; a failed restore is reported and doesn't stop the run.
- The run's token cap is reused; reaching it ends the run `partial`, as in Phase 1.
