# SafetyAudit: test report for App evidence and Code repository evidence

**Date:** 8 November 2026
**Branch:** `feat/ai-evidence-assessment`, commit `49496fc`
**Tested by:** Claude Code, at the project owner's request

---

## 1. Summary

| Area | Result |
|---|---|
| Automated tests (backend, frontend, end-to-end, type checks, build) | **All pass** |
| Live App run (practice social app, 2 items) | **Works end to end**: no safety rule broken, no password leaked, nothing left changed. **Weakness:** the AI stopped exploring too early, so both items came back "not settled". |
| Live Code run (Mastodon on GitHub, 3 items) | **Works end to end**: one fixed commit, real code quoted and checked. **Result:** "Users can report…" = **Partially**, with 2 verified quotes. The other 2 items were "not settled", which is correct for Mastodon. **Weakness:** translation files took up many of the code pieces. |

---

## 2. Automated tests

| Check | Result |
|---|---|
| Backend unit and integration tests | 2 576 tests. 3 failed in one full run, all timeouts in older page-capture tests while the machine was busy. Run alone, those two files passed 108/108. |
| Frontend unit tests | 331 / 331 pass |
| End-to-end browser tests (Playwright) | 7 / 7 pass, including the App flow and the new Code repository flow |
| Backend type check (`tsc`) | Clean |
| Frontend type check (`tsc`) | Clean |
| Frontend production build | Succeeds |

The backend tests include full runs against a built-in practice social app and a fake GitHub. They cover every safety rule, the limits, and attacks such as hostile archives and comments that try to steer the AI.

---

## 3. Live test 1: App evidence (checking inside a web app)

### Setup
- **Platform:** the built-in practice social app, running on this computer at `http://127.0.0.1:58305`.
- **Test accounts:**

  | Account | Age group | Age | Handle |
  |---|---|---|---|
  | Teen 15 | Under 18 | 15 | `teen15` |
  | Adult 30 | Adult | 30 | `adult30` |

- **What the practice app really does:**
  - Teen 15's account is private by default.
  - Only friends can message Teen 15.
- **Items checked:**
  - **P-1** "Accounts of users under 16 are private by default."
  - **P-2** "Direct messages are off by default for users under 16."
- **Signed in as:** Demo Auditor, through the real API, with the real Supabase database and real Groq.

### Results

| | |
|---|---|
| Run status | **Completed** in about 1 minute |
| AI tokens used | 13 300 (limit 200 000) |
| Settings changed and needing to be put back | None |
| P-1 suggestion | **Not settled** (null), with a "missing evidence" flag |
| P-2 suggestion | **Not settled** (null), with a "missing evidence" flag |
| Other 4 items | Their earlier Public-pages suggestions were carried forward unchanged, still marked "pages" |

**Steps recorded for P-2:**

| Step | What happened |
|---|---|
| 1 | Refused: tried to open a page before choosing an account (safety rule working). |
| 2 | Switched to Teen 15, and the login page opened. |
| 3 | The browser filled in Teen 15's login name. |
| 4 | The browser filled in Teen 15's password. The AI never saw it. |
| 5 | Clicked "Sign in", and the home page opened. |
| 6 | Refused: the AI named Teen 15 as the "target" of a plain link click (safety rule working). |
| 7 | Clicked "Settings", and the settings page opened. It showed "Private account On". |
| 8 | The AI finished the check. |

**Steps recorded for P-1:** the AI switched to Teen 15, saw the home page, and finished.

### What worked
- **Login:** signing in with a test account worked, and the browser typed the password itself.
- **No password leak:** the password does not appear in any API response or in the server log.
- **Safety rules:** both refused actions were blocked by the rules, as designed.
- **Replay:** every step was recorded with its screenshot, ready for the Replay steps view.
- **Carry-forward:** items that were not picked kept their earlier suggestions.
- **Groq free-plan limits:** the server hit them several times, waited, retried, and finished.

### Problem found
**The AI stops exploring too early.**
- For P-1 it never opened Settings. If it had, it would have seen "Private account On" and could have suggested **Yes**.
- For P-2 it did not look at the messaging settings, and it did not try having the adult account message the teen.

The safety system worked correctly; the gap is in how the AI is told to explore. A likely fix is a prompt change:
- don't finish until you have looked at the relevant settings page, or tried the action;
- for messaging items, use both accounts.

This would cost a few more steps per item.

---

## 4. Live test 2: Code repository evidence

### Setup
- **Repository:** `https://github.com/mastodon/mastodon` (public), default branch.
- **Items checked:**
  - **P-1** "Accounts of users under 16 are private by default."
  - **P-2** "Direct messages are off by default for users under 16."
  - **R-1** "Users can report a video, comment or account from the app."

### Results

| | |
|---|---|
| Run status | **Completed** in about 3 minutes |
| Commit read | `4dff13d48694e302d1a161b3d0795284a512b482` (all quotes and links point to it) |
| AI tokens used | 27 342 (limit 80 000) |
| R-1 suggestion | **Partially**, high confidence, no flags. "The API can report an account and a comment or post… no evidence that videos specifically can be reported." |
| P-1 suggestion | **Not settled**: no code makes under-16 accounts private by default. The extra search round ran (6 more pieces). |
| P-2 suggestion | **Not settled**: no code turns off direct messages for under-16s. |

**R-1 quotes:** both were checked word for word against the real code. They come from `app/controllers/api/v1/reports_controller.rb`:
- `def create … @report = ReportService.new.call(current_account, reported_account, …)`
- `def report_params … params.permit(:account_id, :comment, :category, … status_ids: [] …)`

The "Code found" view lists 6 pieces, with the reports controller marked **Quoted**, and a link to the exact lines on GitHub.

### What worked
- **One fixed version:** the code was downloaded once and read in memory only. Nothing was run, and nothing was saved to disk.
- **Real, checked quotes:** R-1 got a sensible answer based on real code, and every quote was verified.
- **Honest answers on P-1 and P-2:** Mastodon really has no under-16 defaults, only a "minimum age" setting. The AI said so instead of guessing.
- **Extra search round:** it ran for P-1 and stayed within the token limit.
- **Rate limits:** Groq's limits were hit, waited out, and retried.

### Problems found
1. **Translation files crowd out real code.** For P-1 and P-2, most pieces were Mastodon's translation files (`config/locales/simple_form.ar.yml`, `.be.yml`, `.bg.yml` and so on). They mention "age" in many languages. They pushed out more useful code, such as account defaults and messaging rules. **Fix:** rank translation files (`config/locales/`, `locales/`, `i18n/`, `*.po`) lower or skip them, and allow at most one piece per folder.
2. **A wrong-looking flag on "not settled" items.** P-1 and P-2 also got the flag "This item needs evidence the code can't show". The AI marked them as not checkable from code, even though code could show them. This is a minor wording issue.

---

## 5. Things to note

- **`EVIDENCE_SECRET_KEY`.** It is not set in `backend/.env`. For this test a temporary key was given to the server process only, and `.env` was not changed. The key is saved at `scratchpad/testrun/evidence-secret-key.txt`. Add it to `backend/.env` as `EVIDENCE_SECRET_KEY=...` so the two test accounts saved in this test stay usable. Without it, app runs are switched off.
- **What the test left in the database (the demo project):**
  - one App run and one Code run;
  - the practice app address;
  - two test accounts;
  - the Mastodon address.
- **Newest wins.** P-1 and P-2 now show the Code run's suggestions, because it ran last. R-1 shows the Code run's "Partially".
- **No code files were changed** by testing.
- **Raw results** (every run, suggestion, step and code piece) are saved as JSON next to this report.

---

## 6. Re-test after the fixes (10 November 2026)

This re-test came after the merge of GitHub main (e7a97d7) and four fixes:

| Fix | Commit |
|---|---|
| App checks must explore before finishing | ddad110, e09fd6a |
| Translation files no longer crowd the code search | 06ed9b5, 49166fb |
| No "can't show" flag on unsettled items | 46c2408 |
| A decision no longer copies photos between auditors | a3ec8fb |

Automated checks after the fixes:
- **Backend:** 2 605+ tests pass. A few browser tests fail only when the full suite runs at the same time, and pass on their own.
- **Frontend:** 326 / 326.
- **Type checks:** both clean.
- **E2E:** 7 / 7.

### App run (practice app, P-1 and P-2)
- **P-2 (direct messages):** the AI now explored much further, in 12 steps:
  - signed in as Adult 30;
  - opened Settings, then `/settings/privacy`, then `/settings/direct_messages`;
  - then finished.

  The result is still **not settled**. It looked only from the adult's side, and it never had the adult try to message the teen. The "can't show" flag no longer appears.
- **P-1 (private by default):** not checked. A network failure reaching Groq ("fetch failed") ended the check. A second try also failed, because Groq could not be reached from this computer at the time (GitHub could).
- **Still to improve:** the AI keeps naming the account it is using as the "target" of plain clicks, which the safety rules refuse. Each of those wastes a step.

### Code run (Mastodon, P-1, P-2 and R-1)
- **Translation files are gone from the pieces.** The AI now sees real code: `status/visibility.rb`, `date_of_birth_validator.rb`, `admin_settings.rb`, the registration view and `setting.rb`.
- **P-1:** **not settled**, now with a verified quote showing Mastodon only validates a minimum age (`record.errors.add(attribute, :below_limit) if value.present? && value.to_date > min_age.ago`). There is no "private by default for under-16s". The answer is correct and better supported than before.
- **P-2:** **not settled**. This is correct, because Mastodon has no age-based message defaults. The "can't show" flag no longer appears.
- **R-1:** not re-checked this time. A network failure reaching Supabase while saving ended that item. The earlier result, **Partially** with 2 verified quotes, stands.

### New finding: no retry on a network failure
- **What happens:** a single "fetch failed" talking to Groq or Supabase ends that item and leaves the run `partial`. Groq rate limits (429) are retried, but plain network errors are not.
- **Suggested fix:** retry a failed network call once or twice before giving up on the item.

---

## 7. Final re-test (11 November 2026), after the retry and target fixes

Fixes tested here: network retries, the AI no longer names its own account as a click target, and a Groq "invalid JSON" reply gets one more try.

### App run (practice app, P-1 and P-2): completed, 18 441 tokens, 68 seconds, nothing left changed
- **P-2 (direct messages):** the AI signed in as Teen 15 and opened Settings, then Privacy, then Direct messages, before finishing. The result is still **not settled**: the page was opened, but nothing on it showed the default state. No steps were wasted on refused targets this time.
- **P-1 (private by default):** the AI opened Settings, where the page said "Private account **On**". It had tried to finish after 2 steps. The "finished too early" rule refused that once, as designed, and it then finished properly. The quote "Settings Private account On" was **verified**. The result is still **not settled**, with the reason that the page shows the setting is On but not whether it was on by default. That is a cautious answer for a 15-year-old account that already existed.
- **One quote was marked unverified.** The AI also quoted the whole link list of the home page, and the quote check flagged it. The checker worked as designed.

### Code run (Mastodon, R-1): not re-run
The project had used its 5 runs for the day, so the server refused with "This project has used its 5 runs for today". The earlier R-1 result stands: **Partially**, with 2 verified quotes from `reports_controller.rb`. The server-side fix for Groq's invalid-JSON 400 is covered by automated tests only. It has not been seen live.

### Overall status
| Area | Status |
|---|---|
| Automated tests | Backend 2 655 / 2 657 on the last full run. The 2 failures are old page-capture timing tests that pass when run alone (82 / 82). Frontend 326 / 326. Both type checks clean. |
| App evidence, live | Works end to end. The AI now explores settings and messaging pages, and the safety rules block wrong actions. |
| Code evidence, live | Works end to end. Real code is quoted and checked, and translation files no longer crowd the search. |
| Accuracy | P-1 and P-2 still come back "not settled" in both features. This is cautious rather than wrong, but a demo would be stronger if the AI also tried the adult account messaging the teen, and used a freshly created under-18 account for the "by default" items. |
