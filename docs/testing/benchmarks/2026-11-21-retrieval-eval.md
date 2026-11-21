# Page retrieval evaluation: retrieval-eval

- Date: 2026-11-21T15:30:29.153Z
- Embedder: gemini-embedding-001@768; passage similarity floor 0.65; each search merges up to 15 hits per method
- Test set: 16 questions (6 lexical, 10 paraphrase), 56 passages on 4 pages. The production run sends the top 5 passages of each item to the AI.

| Group | Method | Answer ranked 1st | In top 3 | In top 5 (what the AI sees) | Mean reciprocal rank |
| --- | --- | --- | --- | --- | --- |
| all 16 | keywords only | 31% (5 of 16) | 50% (8 of 16) | 63% (10 of 16) | 0.410 |
| all 16 | keywords + meaning | 50% (8 of 16) | 94% (15 of 16) | 100% (16 of 16) | 0.703 |
| lexical 6 | keywords only | 83% (5 of 6) | 100% (6 of 6) | 100% (6 of 6) | 0.889 |
| lexical 6 | keywords + meaning | 83% (5 of 6) | 100% (6 of 6) | 100% (6 of 6) | 0.917 |
| paraphrase 10 | keywords only | 0% (0 of 10) | 20% (2 of 10) | 40% (4 of 10) | 0.123 |
| paraphrase 10 | keywords + meaning | 30% (3 of 10) | 90% (9 of 10) | 100% (10 of 10) | 0.575 |

Rank of the answering passage for each question (lower is better; "not found" means it was not in the top 15):

| Kind | Question | Keywords only | Keywords + meaning |
| --- | --- | --- | --- |
| lexical | Can users report a post for abuse? | 1 | 1 |
| lexical | Is there a minimum age to create an account? | 1 | 1 |
| lexical | Can users block other accounts? | 3 | 2 |
| lexical | Are accounts of users under 18 private by default? | 1 | 1 |
| lexical | Can users delete their account and their data? | 1 | 1 |
| lexical | Can users download a copy of their data? | 1 | 1 |
| paraphrase | Is location sharing off by default for child accounts? | 5 | 3 |
| paraphrase | Does the platform verify the age of users at sign-up? | not found | 3 |
| paraphrase | Are strangers prevented from sending direct messages to teens? | not found | 1 |
| paraphrase | Are personalised ads switched off for under-18s? | not found | 3 |
| paraphrase | Is harmful content removed within 24 hours of being reported? | not found | 4 |
| paraphrase | Do parents have controls to limit screen time? | not found | 2 |
| paraphrase | Are notifications silenced at night for teen accounts? | not found | 2 |
| paraphrase | Is data from children deleted when the account is closed? | 3 | 2 |
| paraphrase | Are live streams restricted for users under 16? | 2 | 1 |
| paraphrase | Does the platform explain how recommendations work? | 5 | 1 |
