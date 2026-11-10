# AI evidence walkthrough: screenshots, 2026-11-11

This was a real browser run: Playwright, Chromium, headless, 1440x900. The frontend ran on localhost:5173 and the backend on :3000, restarted with `EVIDENCE_ALLOWED_PRIVATE_HOSTS=127.0.0.1:53198`. The practice social app (fixture) ran on 127.0.0.1:53198.
Branch: `feat/ai-evidence-assessment`. No repo code was changed. These screenshots are not committed.

**New project created for this run:** "Demo: screenshot walkthrough" (`c59b6709-bb36-4dd8-8e13-ad8f73e32f52`). It was created through the UI by the demo head auditor, with the Demo Child Safety Checklist (6 items), Demo Auditor as a member and platform TikTok. The AI steps were run as the demo auditor.

## Screenshots

| # | File | What it shows |
|---|------|---------------|
| 1 | 01-login-page.png | Empty sign-in page |
| 2 | 02-login-filled-head-auditor.png | Head auditor's credentials typed in; the password shows as dots |
| 3 | 03-projects-list-head-auditor.png | Head auditor's audit list before the new project (one existing demo project) |
| 4 | 04-create-project-form-top.png | Create New Audit form: name, TikTok selected, auditor added. This was re-filled for the picture and not submitted; see note |
| 5 | 05-create-project-form-guideline.png | Demo Child Safety Checklist ticked (6 items); summary shows 2 auditors |
| 6 | 06-create-project-form-bottom.png | The form that was actually submitted, scrolled to the notes field |
| 7 | 07-project-created-head-auditor.png | New project opened after creation; the AI panel shows the three source options |
| 8 | 08-login-filled-auditor.png | Demo auditor signing in |
| 9 | 09-auditor-dashboard.png | Auditor dashboard listing both demo audits |
| 10 | 10-auditor-projects-list.png | Auditor's audit list |
| 11 | 11-audit-page-top.png | Audit page right after opening; the checklist is still loading (spinner) |
| 12 | 12-audit-page-checklist-and-ai-panel.png | Audit page loaded: score 0/6, AI evidence panel, checklist |
| 13 | 13-checklist-items.png | Checklist sections and items next to the AI panel |
| 14 | 14-source-choice-three-options.png | Source choice: App (test accounts), Public pages, Code repository |
| 15 | 15-app-address-entered.png | App chosen, practice app address typed in |
| 16 | 16-app-address-saved.png | After "Save app address" |
| 17 | 17-add-teen-account-password-dots.png | Add test account form for Teen 15 (Under 18, 15, handle teen15); password shows only dots |
| 18 | 18-add-adult-account-password-dots.png | Same for Adult 30 |
| 19 | 19-two-test-accounts-saved.png | Both accounts listed with "Password saved" (no password on the page) |
| 20 | 20-two-items-picked.png | P-1 and P-2 picked ("2 picked") |
| 21-27 | 21..27-app-progress-N.png | Live progress: "Checking in the app: <item> · starting / step 6, 10, 11, 13, 15 of 15", "Items checked: 0 of 2", Run button disabled ("A run is already in progress") |
| 28 | 28-app-run-last-run-summary.png | Finished: "Last run 11 Nov 2026, 00:33 · 2 suggestions · 1 flagged" |
| 29 | 29-app-result-card-P1.png | P-1 card: AI suggestion **Yes**, quote from the Settings page, thumbnail, Replay steps, Accept/Override |
| 30 | 30-app-result-card-P2.png | P-2 card: "The AI could not suggest an answer", Needs human review, low confidence; evidence page is "Not found" |
| 31 | 31-replay-P1-step-1.png | Replay dialog over the page (P-1, 10 steps) |
| 32 | 32-replay-P1-step-1-dialog.png | Step 1 refused: "No test account is in use yet; choose one first." |
| 33 | 33-replay-P1-step-5-dialog.png | Step 5: Adult 30 clicked "Sign in", /home, with screenshot |
| 34 | 34-replay-P1-step-6-dialog.png | Step 6: Adult 30 opened /profile/teen15 |
| 35 | 35-replay-P1-step-9-dialog.png | Step 9: Teen 15 opened /settings; screenshot shows "Private account: On"; step 7 shows a refused early finish |
| 36 | 36-replay-P2-step-1.png | Replay dialog for P-2 (15 steps) |
| 37 | 37-replay-P2-step-1-dialog.png | P-2 step 1: switched to Teen 15 |
| 38 | 38-replay-P2-step-6-dialog.png | P-2 step 6: Teen 15 opened /settings |
| 39 | 39-replay-P2-step-7-dialog.png | P-2 step 7: /settings/privacy |
| 40 | 40-replay-P2-step-8-dialog.png | P-2 step 8: /settings/privacy/direct_messages, page says "Not found." |
| 41 | 41-replay-P2-step-12-dialog.png | P-2 step 12: refused, "clicked element e5. That element is not on the page." |
| 42 | 42-repo-address-entered.png | Code repository chosen, `https://github.com/mastodon/mastodon` typed in |
| 43 | 43-repo-saved.png | "Saved: https://github.com/mastodon/mastodon" |
| 44 | 44-repo-three-items-picked.png | P-1, P-2 and R-1 picked |
| 45-46 | 45/46-repo-progress-N.png | Run in progress: "Check the code" disabled, "A run is already in progress" (the status box itself is cut off at the bottom of these panel shots) |
| 47 | 47-repo-last-run-summary.png | Finished: "Last run 11 Nov 2026, 00:38 · 3 suggestions · 2 flagged", Re-assess buttons, "Flagged by AI only" filter |
| 48 | 48-repo-result-card-P1.png | P-1 (code): could not suggest, needs human review, "Based on the code at commit 5e90ca8, not on the live app." |
| 49 | 49-repo-result-card-P2.png | P-2 (code): same |
| 50 | 50-repo-result-card-R1.png | R-1 (code): AI suggestion **Yes**, quote from reports_controller.rb lines 1–29 |
| 51 | 51-repo-R1-code-found-top.png | "Code found" opened: commit note, first file path, lines 1–114, Open on GitHub, line-numbered code |
| 52 | 52-repo-R1-code-found-viewport.png | Further down: app/controllers/api/v1/reports_controller.rb, lines 1–29, **Quoted** badge, Open on GitHub, code |
| 53 | 53-score-before-accept.png | Score before accepting: 0% · 0/6 answered |
| 54 | 54-R1-card-before-accept.png | R-1 card with Accept / Override |
| 55 | 55-R1-card-after-accept.png | R-1 after Accept: "Accepted", Yes selected (green), finding filled from the AI reason |
| 56 | 56-score-after-accept.png | Score after accepting: 100% compliance · 1/6 answered · 1 passing |

## Final results

| Run | Item | Suggestion | Confidence / flags |
|-----|------|-----------|--------------------|
| App (practice social app), 2 items, about 3 min | P-1 Accounts of under-16s private by default | **Yes** (Settings shows "Private account: On" for Teen 15) | Not flagged; no low-confidence note shown |
| | P-2 DMs off by default for under-16s | Not settled ("could not suggest an answer") | Flagged: Needs human review, low confidence. The AI opened /settings/privacy/direct_messages, which is "Not found" on the fixture |
| Code (mastodon@5e90ca8), 3 items, about 1 min | P-1 | Not settled | Flagged: needs human review. "No code in the repository matches this item. Only the first part of the repository was read, because it is larger than the limits." |
| | P-2 | Not settled | Flagged: same reason |
| | R-1 Users can report a video, comment or account | **Yes** (not "Partially" as expected) | Not flagged. Quoted from app/controllers/api/v1/reports_controller.rb L1–29; 6 files listed under Code found |

Accepted: R-1 (Yes) by the demo auditor. The score went from 0/6 (0%) to 1/6 (100% compliance, 1 passing). No other answers were touched.

App-run changes and restore summary: none shown. The Last run summary had no "Left changed" or restore section for this run.

## Observations and possible issues (not fixed)

1. **Login reported "Incorrect email or password" once for valid demo credentials.** The retry a moment later worked. The backend maps any Supabase RPC error to 401, so a transient network failure looks like a wrong password. The backend log showed `fetch failed` retries around the same time.
2. **A code-repository citation shows a page thumbnail that fails.** The R-1 card shows "Full page" and "Loading…", then "Preview unavailable", and the browser logs a 404. A code quote has no page screenshot, so the thumbnail shouldn't be shown (50, 55).
3. **Commit note changes after loading.** The R-1 card first says "Based on code, not on the live app." and only shows "…at commit 5e90ca8…" after "Code found" has loaded (50 vs 51/55).
4. **The reason is shown twice** on cards the AI could not settle: once as the summary and again as a bullet (30, 48, 49).
5. **The repo run replaces the app suggestion on the card.** After the code run, P-1's card shows the code result (not settled) and no longer shows the app run's "Yes". This may be intended ("latest run wins"), but an auditor loses sight of the better evidence.
6. "Code found" is offered on P-1/P-2 even though no code matched.
7. The replay line for P-2 step 8 says "page … opened" even though the page was "Not found."; the 404 is not flagged in the step text.
8. The project's checklist took about 10–20 s to appear the first time the new project was opened (11).

## Notes on capture
- Screenshot 4 comes from re-filling the create form without submitting, because the first capture scrolled past the top of the form. Only one project was created.
- Some panel-element screenshots (15–28, 42–46) leave blank space at the bottom or a sticky header at the top. This is because the app scrolls inside a container, not because the page failed to render.
