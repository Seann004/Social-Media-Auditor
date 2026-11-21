# Evaluation of the new AI features, 21 Nov 2026

What was tested, with what, and what it showed. Raw reports are in `docs/testing/benchmarks/`
(`2026-11-21-linking-eval.md`, `2026-11-21-retrieval-eval.md`, `2026-11-21-new-code.md`, `2026-11-21-new-app.md`).
Scripts: `backend/benchmarks/linkingEval.ts`, `backend/benchmarks/retrievalEval.ts`, and the existing `npm run benchmark`.

## Read this first: how much to trust the numbers

- **Every set here is small.** Linking uses 12 items and 45 pairs. Retrieval uses 16 questions. Treat them as checks that
  the features work and as a guide for tuning, not as an accuracy figure for your real audits.
- **The retrieval test set was written by the same person who built the feature** (me). Its paraphrases were chosen to
  share few words with the questions, so it shows the best case for the meaning search.
- **The linking labels are the seed author's judgement** (`scripts/seedOverlap.ts`), not an independent panel. Only 7 pairs in
  the database have ever been decided by an admin, none rejected.
- **Groq's daily limit stopped three runs early** (linking AI stage, app benchmark, last code repeats).
  The app benchmark produced no usable result. See "What could not be measured".

## 1. Same-item linking

Library: 572 items in 9 guidelines (12 are placeholder "N/A" rows). Labelled set: the seeded overlap guidelines
TESTA, TESTB and TESTC, 12 items, 45 cross-guideline pairs, of which 8 are linked (7 approved links plus one pair implied by
a "same requirement" group) and 37 are not.

### Stage 1: does the right partner reach the AI? (5 candidates per item, chosen from all 572 items)

| Method | Linked pairs offered | Missed |
| --- | --- | --- |
| Words only (before) | 4 of 8 (50%) | A-1/C-1, A-1/B-1, B-2/C-2, B-1/C-1 |
| Words + meaning, first version (equal-weight merge) | 5 of 8 (62.5%) | A-1/C-1, B-2/C-2, B-1/C-1 |
| **Words + meaning, final (slots reserved for meaning)** | **8 of 8 (100%)** | none |

- Of the 7 admin-approved links, words alone offered 4 and the final method offers all 7.
- Where the true partner ranks among the other guidelines' items (rank 1 is best): by words 1 to 120 (e.g. B-1/C-1 ranks 83 and 120),
  by meaning 1 to 4 in all 16 directions, cosine 0.87 to 0.94.
- The first merge underperformed because strong word-only hits shared the 5 slots equally and pushed out partners that
  the meaning search had ranked 2nd to 3rd. The fix takes the two lists in turn, meaning first.

### Cost of the change (whole library, no labels)

| Candidates per item | Method | Pairs sent to the AI | Earlier AI suggestions still offered | Approved links offered |
| --- | --- | --- | --- | --- |
| 5 | words only | 2,215 | 178 of 186 (95.7%) | 4 of 7 |
| 5 | words + meaning (current) | 2,440 (+10%) | 156 of 186 (83.9%) | 7 of 7 |
| 6 | words + meaning | 2,880 (+30%) | 171 of 186 (91.9%) | 7 of 7 |
| 8 | words + meaning | 3,779 (+71%) | 179 of 186 (96.2%) | 7 of 7 |

The earlier suggestions came from the word-only method and nobody has reviewed them, so losing some is not
necessarily a loss. Whether those 30 are real matches is unknown. The setting is `CANDIDATES_PER_ITEM` (now 5).

### Stage 2: the real matching prompt and model on every labelled pair (gpt-oss-120b)

Only **1 of 3 planned repeats** ran before Groq's limit. One repeat of 45 pairs:

| Measure | Result |
| --- | --- |
| Matches found (recall) | 5 of 8 (62.5%) |
| Matches that were right (precision) | 5 of 5 (100%) |
| Unlinked pairs left alone | 37 of 37 (100%) |
| F1 | 0.769 |
| Relation right (same requirement vs partial) among found matches | **0 of 5** |
| Mean confidence of right matches | 0.80 |

- The AI is cautious: no false matches, but it missed A-1/C-1 (same requirement), B-2/C-2 and A-2/C-2 (partial).
- It disagreed with the seed labels on the relation in all 5 found pairs, in both directions (said "partial" where the label says
  "same requirement" for A-3/B-3, A-1/B-1 and B-1/C-1; said "same requirement" where the label says "partial" for
  A-4/B-4 and A-2/B-2). The labels are judgement calls, but 0 of 5 is worth a look at the prompt.
- With one repeat there is no stability figure.

## 2. Auto audit

### Page evidence: finding the passage that answers an item (embeddings)

16 hand-written questions (6 lexical, 10 paraphrase), 56 passages on 4 pages, the real `searchForItem`, Gemini embeddings.
The keyword arm is a simplified Postgres-style search (stems, stop words), the same for both arms.

| Group | Method | Ranked 1st | In top 3 | In top 5 (what the AI sees) | Mean reciprocal rank |
| --- | --- | --- | --- | --- | --- |
| all 16 | keywords only | 31% | 50% | 63% | 0.410 |
| all 16 | **keywords + meaning** | 50% | 94% | **100%** | 0.703 |
| lexical 6 | keywords only | 83% | 100% | 100% | 0.889 |
| lexical 6 | keywords + meaning | 83% | 100% | 100% | 0.917 |
| paraphrase 10 | keywords only | 0% | 20% | 40% | 0.123 |
| paraphrase 10 | **keywords + meaning** | 30% | 90% | **100%** | 0.575 |

Meaning search does not hurt questions that already matched by words. Caveats: self-written set, production uses
Postgres full-text rather than the simplified keyword arm, and this tests retrieval only, not the AI's final answer.

### Code evidence (real AI, same 10 cases and 2 repeats as the 21 Nov baseline)

| Measure | Baseline | Now |
| --- | --- | --- |
| Repeats run | 20 of 20 | 18 of 20 (daily limit) |
| Accuracy | 55% (11 of 20) | 65% (11 of 17) |
| Coverage | 50% | 59% |
| Wrong-claim rate | 10% (1 wrong) | 0% |
| Stability | 70% | 100% |
| Unproven (right answer, quote not found) | 2 | 2 |
| Tokens per repeat | 2,312 | 2,360 |

**The code path was not changed by this work**, so the difference is run-to-run variation of the model and fewer repeats.
It is not an improvement to credit to the new features.

### App evidence: step budget, sign-in, second check of claims

**No real-AI result.** The app benchmark was started on the 6 cases that failed at baseline (3 "not settled" after using all 15 steps,
2 wrong claims, 1 control). Groq's daily limit stopped it after the first repeat, which recorded 0 tokens and counted as an error.
The baseline (21 Nov, 12 repeats) was: accuracy 55%, wrong-claim rate 29%, 12.9 steps on average, with 5 of 12 checks using
all 15 steps and 4 more using 14.

What is verified, by tests with scripted AI and the real browser against the practice app:
- sign-in steps are not counted against the 15 steps, up to 12 free sign-in steps;
- the system signs an account in by itself after a switch, records each step, hides the password, and hands back to the AI when sign-in fails;
- a check stops after 4 refused or failed steps in a row;
- each yes/no claim with quotes is checked a second time, and an unconfirmed claim becomes "no answer".

What is **estimated, not measured**: the baseline spent 4 to 5 AI steps on login per account (about 1.5k tokens each);
those are now done by the system.

### Items assessed once

When items are linked as the same requirement, the AI is asked about the first one and the answer is copied to the others.
Verified by tests only (including the case where the first item gets no answer). Not measured on real audits.

## 3. Problems found while testing, and fixed

- Embedding calls failed on network errors without retrying, and one failure discarded every vector already made.
  The embedder now retries network failures and waits out rate limits, and vectors are saved in chunks.
- 12 placeholder "N/A" items were paired with each other by the meaning search. They are now excluded.
- The equal-weight merge dropped true partners (stage 1 above). Replaced.
- The auto sign-in change broke 11 existing app tests, which I had not noticed from an earlier partial run. The test
  fixture now turns it off for scripted sign-in, and new tests cover it being on. Full suite: 134 of 134 files pass.

## 4. What could not be measured, and next steps

1. Re-run `npx tsx benchmarks/linkingEval.ts --repeats 3` after Groq's daily limit resets, for stability and a firmer relation figure.
2. Re-run the app benchmark on the 6 chosen cases (`--only app-private-on,app-push-off,app-birthday-hide,app-tag-nobody,app-message-settings-not-enforced,app-trap-private-banner`). It needs about 150,000 tokens.
3. Have a person label the sample of "added pairs" printed at the end of the linking report. That gives real precision for the meaning search.
4. Decide `CANDIDATES_PER_ITEM` (5 or 6) once point 3 is known.
5. Look at the matching prompt: it is cautious (recall 5 of 8) and its same-requirement versus partial calls did not match the seed labels.
