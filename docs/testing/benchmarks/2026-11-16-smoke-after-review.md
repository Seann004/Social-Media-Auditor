# Evidence benchmark: smoke-after-review

Started 2026-11-15T17:58:28.966Z · model `openai/gpt-oss-120b` · 1 repeat per case · token cap 400,000 · commit cfbe9b5 (uncommitted changes)

## What this measures

- Sources: the practice social app, shown to the AI as the platform "Social", with its settingsMenu mode on in every app case (Settings then links each settings page); and a synthetic repository of 15 files served by a faked GitHub.
- Both are far simpler than a real platform: a few pages with plain labels, and a few hundred lines of code. The numbers show how the tool does on small, fixed ground, not how accurate it is on a real platform.
- Case mix: 1 app case (1 no); 0 code cases.
- Floors: always "yes" would score 0%, always "no" 100%, always "not settled" 0%. Accuracy means something only well above the highest floor (100%, always "no").

## Summary

| Measure | All | App | Code |
| --- | --- | --- | --- |
| Cases | 1 | 1 | 0 |
| Repeats | 1 | 1 | 0 |
| Accuracy | – (0 of 0) | – (0 of 0) | – (0 of 0) |
| Strict accuracy | 0% (0 of 1) | 0% (0 of 1) | – (0 of 0) |
| Floor: always "yes" | 0% | 0% | – |
| Floor: always "no" | 100% | 100% | – |
| Floor: always "not settled" | 0% | 0% | – |
| Coverage | – | – | – |
| Wrong-claim rate | – (0 wrong) | – (0 wrong) | – (0 wrong) |
| Stability | – | – | – |
| Not settled | 0 | 0 | 0 |
| Unproven | 0 | 0 | 0 |
| Errors (left out) | 1 | 1 | 0 |
| Average steps | 9.0 | 9.0 | – |
| Tokens | 11,281 | 11,281 | 0 |
| Tokens per repeat | 11,281 | 11,281 | – |
| Seconds | 8.8 | 8.8 | 0.0 |
| Seconds per repeat | 8.8 | 8.8 | – |

- Accuracy: correct repeats out of the repeats that count. Strict accuracy: correct repeats out of all repeats, errors included. Floor: the accuracy a tool would reach by always giving that one answer.
- Coverage: the share of counted repeats that made a claim (any answer but "not settled" or a hedge the case allows). Wrong-claim rate: wrong claims out of all claims.
- Not settled: no result where a claim was expected, an allowed hedge, or a run that failed to give a suggestion by itself (never correct). Unproven: the right claim, but none of its quotes was found in what the AI was sent.
- Error: a repeat left out because the benchmark's token cap or Groq's daily limit stopped it, or it could not run (see the last section). Stability: cases whose repeats all gave the same answer (unknown with fewer than two).
- Seconds include Groq's rate-limit waits, so they are not comparable across runs.

## Cases

| Case | Source | Item | Expected | Answers | Outcomes | Stable |
| --- | --- | --- | --- | --- | --- | --- |
| app-private-off | App | Is the Teen 15 account currently private? | no | (none) | error | – |

## Wrong and unproven results

None.

## Repeats without a suggestion

| Case | Repeat | Run status | Counted as | Message |
| --- | --- | --- | --- | --- |
| app-private-off | 1 | partial | left out (daily limit) | AI daily limit reached; 1 item not checked |
