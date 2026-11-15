# Item kinds benchmark: item-kinds

- Date: 2026-11-15T18:14:49.477Z
- Model: openai/gpt-oss-120b; prompt version item-kinds-v1; commit 0a0dde0
- AI calls planned: 2; failed: 1; tokens: 2244 (cap 30000); 15.2 s

**Agreement**: the AI kind, at either confidence, is the label (or an equally fair "also" label); a missing answer counts against. **Precision when asserting**: of the high-confidence answers (the only ones the screen uses), how many are right. **Coverage**: the share of items with a high-confidence answer. The held-out items were never used to tune the old keyword rules, and the AI prompt was not tuned to any of these items.

**Partial run**: 40 of 79 items got an answer, because 1 AI call(s) failed (see the console: often Groq's rate limit). Every number below counts an item without an answer against the classifier, so read the Answered column and the disagreements, not the headline agreement.

## Summary

| Set | Items | Answered | Agreement | Asserted (high) | Precision when asserting | Coverage |
|---|---|---|---|---|---|---|
| All | 79 | 40 | 27 of 79 (34.2%) | 35 | 27 of 35 (77.1%) | 44.3% |
| Tuning (shaped the old keyword lists) | 37 | 37 | 25 of 37 (67.6%) | 32 | 25 of 32 (78.1%) | 86.5% |
| Round two (used to tune the keyword lists) | 15 | 3 | 2 of 15 (13.3%) | 3 | 2 of 3 (66.7%) | 20.0% |
| Round three (used to tune the keyword lists) | 15 | 0 | 0 of 15 (0.0%) | 0 | none asserted | 0.0% |
| Held out (never used to tune any rule) | 12 | 0 | 0 of 12 (0.0%) | 0 | none asserted | 0.0% |

## Confusion matrix: every answer

| Label \ AI | app | code | both | neither | no answer |
|---|---|---|---|---|---|
| app | 15 | 1 | 0 | 0 | 13 |
| code | 0 | 7 | 2 | 0 | 10 |
| both | 4 | 1 | 0 | 0 | 5 |
| neither | 2 | 0 | 3 | 5 | 11 |

## Confusion matrix: high confidence only (a low-confidence answer is "no hint")

| Label \ AI | app | code | both | neither | no hint |
|---|---|---|---|---|---|
| app | 15 | 1 | 0 | 0 | 13 |
| code | 0 | 7 | 0 | 0 | 12 |
| both | 4 | 1 | 0 | 0 | 5 |
| neither | 2 | 0 | 0 | 5 | 14 |

## Disagreements (52)

| Set | Item | Label | AI | Confidence | AI reason |
|---|---|---|---|---|---|
| tuning | A safety centre explains the tools available to teens and parents. | neither | app | high | safety centre page accessible |
| tuning | The privacy policy for younger users is easy to find. | neither | app | high | policy link shown in app/help |
| tuning | Parental consent is recorded with the date and the parent's account. | code | both | low | consent recorded in UI and stored |
| tuning | Personal data of users under 18 is not shared with advertisers. | code or neither | both | low | ad‑targeting UI and backend restrictions |
| tuning | Reports of child sexual abuse material are passed to law enforcement. | neither | both | low | report flow visible, law‑enforcement handoff in code |
| tuning | Moderators are available around the clock to handle urgent reports. | neither | both | low | availability shown, staffing in code/ops |
| tuning | Appeals against a moderation decision are answered within seven days. | neither | both | low | appeal UI and backend SLA tracking |
| tuning | Users must enter their date of birth when they sign up. | both | app | high | DOB field on sign‑up screen |
| tuning | Children under 13 who give their real age are blocked from creating an account. | both | app | high | age check blocks under‑13 accounts |
| tuning | Users can delete their account and their data from the settings page. | both | app | high | delete account option in settings |
| tuning | Teen accounts are switched to private when an age check shows the user is under 16. | both | code | high | automatic private switch in backend |
| tuning | Users can download a copy of the data stored about them. | both | app | high | data download feature in settings |
| round_two | Teen accounts cannot receive gifts or payments from adults. | app | code | high | gift/payment restriction enforced server‑side |
| round_two | Young users see a warning before they view sensitive content. | app | no answer | - | - |
| round_two | Direct messages from unknown adults go to a separate requests folder. | app | no answer | - | - |
| round_two | Session tokens expire after 30 minutes of inactivity. | code | no answer | - | - |
| round_two | The API refuses requests that try to read another user's private messages. | code | no answer | - | - |
| round_two | Images uploaded by under-18s have their location metadata removed. | code | no answer | - | - |
| round_two | Account deletion removes the user's messages from the database within 30 days. | code or both | no answer | - | - |
| round_two | Every new feature is reviewed for child safety risks before launch. | neither | no answer | - | - |
| round_two | Parents can contact a support team that answers within two working days. | neither | no answer | - | - |
| round_two | Content moderators have access to wellbeing support. | neither | no answer | - | - |
| round_two | The service has a clear process for removing illegal content quickly. | neither | no answer | - | - |
| round_two | Teens are asked their age at sign-up, and the answer is checked against other signals. | both | no answer | - | - |
| round_two | Users can turn off personalised ads, and their data is then no longer used for ads. | both | no answer | - | - |
| round_three | Teens can hide their like counts. | app | no answer | - | - |
| round_three | Users under 16 cannot be added to group chats by people they don't know. | app | no answer | - | - |
| round_three | Teens are reminded to review their privacy settings every six months. | app | no answer | - | - |
| round_three | Live streams by users under 18 cannot receive gifts. | app | no answer | - | - |
| round_three | A teen's exact location is never shown on their profile. | app | no answer | - | - |
| round_three | Users can see why a post was recommended to them. | app | no answer | - | - |
| round_three | Messages are scanned for grooming patterns before delivery. | code | no answer | - | - |
| round_three | Deleted photos are removed from backups within 90 days. | code | no answer | - | - |
| round_three | Parents receive an email when their child changes a safety setting. | code or both | no answer | - | - |
| round_three | Access to children's personal data is limited to staff who need it. | neither or code | no answer | - | - |
| round_three | The age estimation model is tested for bias across skin tones. | neither | no answer | - | - |
| round_three | Content policies are translated into every language the service supports. | neither | no answer | - | - |
| round_three | The company consults young people when designing new features. | neither | no answer | - | - |
| round_three | Teen accounts default to the strictest content filter, and this is enforced on the server. | both | no answer | - | - |
| round_three | Users who enter a birthday under 13 at sign-up cannot try again with a different date. | both | no answer | - | - |
| held_out | Teens can choose who sees their stories. | app | no answer | - | - |
| held_out | Adults cannot comment on posts by users under 16 unless they are friends. | app | no answer | - | - |
| held_out | The app pauses notifications at night for users under 18. | app | no answer | - | - |
| held_out | Profile photos of teens cannot be downloaded by other users. | app | no answer | - | - |
| held_out | Reported accounts are hidden from a teen's search while a review is open. | app or both | no answer | - | - |
| held_out | Uploaded videos are compressed and their GPS tags stripped on the server. | code | no answer | - | - |
| held_out | A user's age is stored separately from their public profile. | code | no answer | - | - |
| held_out | Moderation decisions are saved with the moderator's ID. | code | no answer | - | - |
| held_out | The service tells the regulator about serious incidents within 72 hours. | neither | no answer | - | - |
| held_out | Safety features are designed with input from child development experts. | neither | no answer | - | - |
| held_out | Volunteers who run community groups are vetted. | neither | no answer | - | - |
| held_out | Every report is acknowledged by email, and the reporter can follow its progress in the app. | both | no answer | - | - |
