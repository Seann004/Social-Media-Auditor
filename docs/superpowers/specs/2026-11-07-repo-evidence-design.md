# Code Repository Evidence: AI Reads a Platform's Code — Design

**Status:** Draft for approval
**Builds on:** `2026-11-01-ai-evidence-assessment-design.md` (Public pages) and `2026-11-06-app-evidence-design.md` (App, test accounts), both built on branch `feat/ai-evidence-assessment`
**Owner's input:** the owner asked for code reading as a second real source next to the app ("either analyse the social media app or by codebase"), and chose to skip the detailed questions. Every decision below not quoted from the owner is marked **(Claude's call)**.

---

## 1. Why

The app source shows what a platform **does** for a test account. The code shows **how it is built**. Examples: whether new under-18 accounts default to private, whether the message rules check age, or whether reports reach a moderation queue. An auditor today would have to read the code by hand. This feature lets the AI find the relevant code for each picked checklist item and suggest an answer, quoting the exact lines. The auditor decides, as with the other sources.

## 2. Goals

- An auditor adds a **code repository address** to a project, for example `https://github.com/owner/name`, and optionally a branch.
- On a run, the auditor **picks the checklist items** to check, as with an app run.
- For each item the system finds the relevant code, and the AI suggests Yes / No / Partially / N/A. The suggestion comes with a reason, quoted lines as evidence, and review flags. Accept and override work as today.
- Each card shows a **"Code found"** view: the file path, the line numbers, the quoted code, and a link to those exact lines at the exact version read.
- Works for any public GitHub repository. It is not tied to one platform.
- Cheap enough for Groq's free plan in a demo: about 3 items per run.

## 3. The success picture (Claude's call, modelled on the app design's)

1. The auditor adds the address of a demo social app's public repository and picks 3 items.
2. The examiner watches progress, item by item.
3. Within a couple of minutes each item has a suggestion. For example: "Teen accounts private by default: **Yes**". The quote shows `isPrivate: age < 18` in `src/users/createUser.ts`, lines 41–43, with a link to GitHub.
4. The examiner opens "Code found" and clicks through to the same lines on GitHub.
5. The auditor accepts one suggestion and overrides another. The score changes only then.

## 4. Non-goals

- Private repositories, and GitLab, Bitbucket or other hosts. These can come later (Claude's call: private repositories need token handling, which is a separate piece of work).
- Running, building or installing anything from the repository.
- Proving that the code is what is actually deployed. A repo suggestion says what the code does, not what the live app does.
- Reading the whole repository with the AI.

## 5. Anti-goals (failure even if it technically works)

- **Running repository code.** Any file from the repository executed, installed or opened by a tool that runs code.
- **Unproven answers.** A suggestion that quotes lines which are not in the stored code.
- **The repository steering the system.** Text in the code (comments, README, strings) that makes the AI fetch other sites, skip rules or invent quotes.
- **Runaway cost or size.** A huge repository that fills the disk or memory, or a run that spends far beyond its token limit.
- **Code dressed up as live proof.** A repo suggestion presented as if it showed the live app.

## 6. Constraints

- Same principles as the other sources:
  - Suggestions never change answers or the score.
  - The auditor decides.
  - Every claim must point to stored evidence.
  - There is no fallback guessing when the AI is unavailable.
- **One suggestion per item, newest wins**, as in the app design. The run's source is recorded as `repo`, and "latest result run", carry-forward and Re-assess apply unchanged.
- **The version is fixed.** At the start of a run the branch, or the default branch, is turned into one commit ID. Everything that run reads, quotes and links comes from that commit.
- **Downloads only from GitHub's own addresses** (`api.github.com`, `codeload.github.com`), through the existing URL guard.
- **Nothing is written to disk from the archive.** It is read as a stream in memory, under limits:
  - download size about 50 MB;
  - about 5 000 files;
  - about 300 KB per file.
- **What gets skipped:**
  - binary files;
  - folders such as `node_modules`, `vendor`, `dist`, `build` and `.git`;
  - minified files and lock files;
  - any path that tries to escape (`..` or absolute paths).
- **No Head Auditor permission gate.** The repositories are public (Claude's call, same as the app). The README states that real use needs the platform's agreement.
- **Limits live in `config.ts`.** The per-run token cap is reused. When it is reached, the run ends `partial`, as in the other sources. At most 10 items per run, as for the app.
- **Same roles as the other sources.**
- **Reuse what already exists:**
  - runs and the queue;
  - suggestions, flags, quote checks;
  - decisions and provenance;
  - the source choice and item picker in the panel;
  - the AI call helper, with `reasoning_effort` low.

## 7. How it works (Claude's calls)

### 7.1 Setting up the source
The project stores one repository address and an optional branch. It is checked when saved: it must be a `github.com/owner/name` address, and nothing else is accepted.

### 7.2 Reading the code
At run start the system takes these steps:
1. Ask GitHub for the commit ID.
2. Download that commit's archive.
3. Keep the text files that pass the limits in 6.
4. Keep the file list in memory for the run, and store for the run the repository, the commit ID and how many files were read and skipped.

The files themselves are not stored. Only the pieces sent to the AI are saved (7.5), so Re-assess can judge them again.

### 7.3 Finding the code for one item (cheap, two rounds at most)
1. **Search words.** One small AI call, for all picked items together, turns each item into search words and likely file-name hints. For example, "Teen accounts private by default" becomes `private`, `minor`, `age`, `under18`, `default`, `visibility`, and hints like `user`, `account`, `settings`.
2. **Local search, no AI.** Each file is scored by the search words in its path and in its contents. The best pieces are cut out: each is the matching lines plus about 20 lines around them. The cap is about 6 pieces per item, within the existing passage size limit.
3. **Judge.** The AI gets the item and the pieces, each labelled with its path and line numbers. It answers with a suggestion and quotes. It may instead say it needs more, naming up to 3 new search words or file paths.
4. **One more look, at most.** If the AI asked for more, the system runs that search, adds the new pieces, and the AI judges once more. Then it must answer.

### 7.4 Safety rules
- **The repository's text is data, never instructions.** The prompt says so. The AI can only ask for searches inside the same stored code. It cannot fetch anything or reach any other site.
- **Quotes are checked word for word** against the stored pieces, as in the other sources. Answers whose quotes don't match get flagged.
- **A suggestion backed only by comments, docs or tests** (not running code) gets a review flag: "Only comments or documentation support this."
- **Every repo suggestion carries a fixed note:** "Based on the code at commit `abc1234`, not on the live app."

### 7.5 Evidence
Each piece sent to the AI is stored with the run's evidence, and the card marks the ones the suggestion quotes:
- the repository;
- the commit ID;
- the path;
- the first and last line;
- the text;
- a GitHub link to those lines at that commit.

Re-assess re-judges the stored pieces without downloading again.

### 7.6 What the auditor sees
- **The source choice** in the panel gets a third option, **Code repository**, with the address and branch fields and the same item picker.
- **Progress** shows the current item.
- **The card's "Code found" view** lists each piece: path and line numbers, the code with line numbers in a monospace block, and an "Open on GitHub" link.

## 8. Left to the builder

- Prompt wording; how files are scored; the exact numbers (pieces per item, lines around a match, the size limits).
- Table layout and the migration (`003_repo_evidence.sql`), including allowing `repo` as a run source.
- How the archive is read as a stream (a tar and gzip library, or Node's zlib with a small tar reader), as long as nothing touches disk and nothing runs.
- The layout of the "Code found" view, following `DESIGN.md`.
- Tests:
  - a small fixture repository in memory (served as a fake archive), so no test uses the internet;
  - the AI faked;
  - tests for each limit and each skip rule;
  - a test that path tricks such as `..` are refused;
  - a test that a commented-out "safe" line gets the comments flag.
- An E2E test like the app one: add a repository, pick items, run, open "Code found", accept.

## 9. Calls made by Claude (not asked of the owner)

- Public GitHub only for now; private repositories and other hosts come later.
- The run is fixed to one commit, so the quotes and links never drift.
- The archive is read in memory only, and nothing from it runs.
- Plain search first, then the AI judges small pieces: about 2–3 AI calls per item, to stay within the free plan.
- At most one follow-up search per item.
- A comments-only or tests-only answer is flagged, and every repo suggestion carries a "code, not live app" note.
- No permission gate, the auditor picks the items, newest wins: all the same as the app source.
