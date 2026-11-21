# Linking evaluation: linking-eval

- Date: 2026-11-21T15:43:51.179Z
- Matching model: openai/gpt-oss-120b
- Embedder: gemini-embedding-001@768; semantic threshold 0.75
- Library: 572 items in 9 guidelines. Labelled set: 12 seeded items, 45 cross-guideline pairs, 8 linked and 37 not linked.

## Stage 1: does the right partner reach the AI? (candidates chosen from all 572 items)

| Method | Linked pairs offered to the AI | Missed |
| --- | --- | --- |
| words only | 50.0% (4 of 8) | C-1 TESTC / A-1 TESTA; B-1 TESTB / A-1 TESTA; B-2 TESTB / C-2 TESTC; B-1 TESTB / C-1 TESTC |
| words + meaning | 100.0% (8 of 8) | none |

## Stage 2: the AI on every labelled pair (3 repeats; every pair is shown as a candidate)

Stage 2 stopped after 1 of 3 repeats: Groq rate limit: retry-after 1013s exceeds the allowed wait

| Measure | Result |
| --- | --- |
| Pair decisions scored | 45 (1 repeats of 45 pairs) |
| True matches found (recall) | 62.5% (5 of 8) |
| Matches that were right (precision) | 100.0% (5 of 5) |
| F1 | 0.769 |
| Non-links left alone | 100.0% (37 of 37) |
| Relation right (equivalent or partial), among found matches | 0.0% (0 of 5) |
| Mean confidence: right matches / wrong matches | 0.80 / n/a |
| Pairs whose answer changed between repeats | 0 of 45 |

Mistakes (every repeat):
- A-4 TESTA / B-4 TESTB: said equivalent, label partial
- B-1 TESTB / C-1 TESTC: said partial, label equivalent
- B-1 TESTB / A-1 TESTA: said partial, label equivalent
- MISSED C-1 TESTC / A-1 TESTA (label equivalent)
- A-3 TESTA / B-3 TESTB: said partial, label equivalent
- MISSED B-2 TESTB / C-2 TESTC (label partial)
- B-2 TESTB / A-2 TESTA: said equivalent, label partial
- MISSED C-2 TESTC / A-2 TESTA (label partial)

## Stage 3: the whole library (no labels; cost and change only)

| Method | Distinct pairs sent to the AI | Items with 5 candidates | Earlier AI suggestions and approved links still offered |
| --- | --- | --- | --- |
| words only | 2215 | 542 of 572 | 95.7% (178 of 186) |
| words + meaning | 2440 | 560 of 572 | 83.9% (156 of 186) |

Meaning search adds 1190 pairs that words alone never offered, and drops 965.

A sample of the added pairs, for a person to label (are they really the same requirement?):

- [ ] **null EDPB_AUDIT**: Does the app avoid showing multiple pop-ups requesting a phone number after the user has already chosen email registration?  
  **null RISK-MITIG**: Is content only able to be communicated on the service by a registered user?
- [ ] **null EDPB_AUDIT**: Does the app avoid showing multiple pop-ups requesting a phone number after the user has already chosen email registration?  
  **null AUSTRALIA_**: At the point of account creation, are safety settings automatically set to the most protective level — e.g. who can contact, message, or vie
- [ ] **null EDPB_AUDIT**: Does the app avoid showing multiple pop-ups requesting a phone number after the user has already chosen email registration?  
  **null AUSTRALIA_**: If a user declares an age below the minimum threshold, does the platform restrict or block account creation?
- [ ] **null EDPB_AUDIT**: Does the app correctly label non-essential data such as a phone number as optional, without framing it as required for account security?  
  **null AUSTRALIA_**: Does the platform require users to declare their age or date of birth during the registration process?
- [ ] **null EDPB_AUDIT**: Does the app correctly label non-essential data such as a phone number as optional, without framing it as required for account security?  
  **null AUSTRALIA_**: At the point of account creation, are privacy settings automatically set to the most restrictive level available?
- [ ] **null EDPB_AUDIT**: Does the app correctly label non-essential data such as a phone number as optional, without framing it as required for account security?  
  **null AGE-APPROPRI**: Does the platform prevent the detrimental use of user data, including the use of rewards, notifications, and 'likes'?
- [ ] **null EDPB_AUDIT**: Does the app offer an equally secure alternative to the non-essential data it requests?  
  **null UK_ICO_CHE**: Does the platform apply the concept of core service narrowly avoiding the use of a broad core service definition to exempt optional features
- [ ] **null EDPB_AUDIT**: Does the app offer an equally secure alternative to the non-essential data it requests?  
  **null UK_ICO_CHE**: Is a separate privacy setting available for each distinct type of profiling rather than bundling all profiling under one setting?
- [ ] **null EDPB_AUDIT**: Does the app offer an equally secure alternative to the non-essential data it requests?  
  **null UK_ICO_CHE**: Does the platform avoid bundling different types of profiling together under a single privacy toggle or consent mechanism?
- [ ] **null EDPB_AUDIT**: Does the app respect the user's earlier choice and avoid re-requesting information that was already declined during sign-up on subsequent lo  
  **null AUSTRALIA_**: When a user attempts to change a privacy setting, is a plain language explanation displayed before the change takes effect?
- [ ] **null EDPB_AUDIT**: Does the app respect the user's earlier choice and avoid re-requesting information that was already declined during sign-up on subsequent lo  
  **null AUSTRALIA_**: At the point of account creation, are privacy settings automatically set to the most restrictive level available?
- [ ] **null EDPB_AUDIT**: Does the app respect the user's earlier choice and avoid re-requesting information that was already declined during sign-up on subsequent lo  
  **null UK_ICO_CHE**: Does the platform avoid bundling different types of profiling together under a single privacy toggle or consent mechanism?
- [ ] **null EDPB_AUDIT**: Do help icons during sign-up provide neutral information rather than triggering repeated requests for optional data?  
  **null AUSTRALIA_**: When a user attempts to change a privacy setting, is a plain language explanation displayed before the change takes effect?
- [ ] **null EDPB_AUDIT**: Do help icons during sign-up provide neutral information rather than triggering repeated requests for optional data?  
  **null UK_ICO_CHE**: Does the platform present the high-privacy option through a more complex or multi-step mechanism than the low-privacy option making it harde
- [ ] **null EDPB_AUDIT**: Do help icons during sign-up provide neutral information rather than triggering repeated requests for optional data?  
  **null AUSTRALIA_**: At the point of account creation, are privacy settings automatically set to the most restrictive level available?
- [ ] **null EDPB_AUDIT**: Does the app offer alternative download methods such as a QR code or direct app store link, rather than requesting a phone number as the onl  
  **null AUSTRALIA_**: If a user declares an age below the minimum threshold, does the platform restrict or block account creation?
- [ ] **null EDPB_AUDIT**: Does the app offer alternative download methods such as a QR code or direct app store link, rather than requesting a phone number as the onl  
  **null RISK-MITIG**: Is content only able to be communicated on the service by a registered user?
- [ ] **null EDPB_AUDIT**: Does the app offer alternative download methods such as a QR code or direct app store link, rather than requesting a phone number as the onl  
  **null AUSTRALIA_**: Does the messaging feature include visible safety controls, report options, and block functions within the chat interface?
- [ ] **null EDPB_AUDIT**: Does the app use neutral, non-manipulative language when prompting users to share personal data during sign-up, free from emotional, guilt-t  
  **null UK_ICO_CHE**: Does the platform exploit human affirmation needs such as social approval signals or peer comparison to nudge children towards sharing more 
- [ ] **null EDPB_AUDIT**: Does the app use neutral, non-manipulative language when prompting users to share personal data during sign-up, free from emotional, guilt-t  
  **null UK_ICO_CHE**: Is the language used to describe the higher-privacy option framed more negatively such as implying loss, restriction, or disadvantage than t
- [ ] **null EDPB_AUDIT**: Does a help button on an optional data-entry step display neutral guidance rather than a motivational or persuasive message?  
  **null UK_ICO_CHE**: Is the language used to describe the lower-privacy option framed more positively than the language used for the higher-privacy option?
- [ ] **null EDPB_AUDIT**: Does a help button on an optional data-entry step display neutral guidance rather than a motivational or persuasive message?  
  **null UK_ICO_CHE**: Is the language used to describe the higher-privacy option framed more negatively such as implying loss, restriction, or disadvantage than t
- [ ] **null EDPB_AUDIT**: Does a help button on an optional data-entry step display neutral guidance rather than a motivational or persuasive message?  
  **null UK_ICO_CHE**: Does the platform exploit human affirmation needs such as social approval signals or peer comparison to nudge children towards sharing more 
- [ ] **null EDPB_AUDIT**: Does the platform apply confirmation pop-ups symmetrically, appearing equally whether the user accepts or declines data sharing, rather than  
  **null AUSTRALIA_**: When a user attempts to change a privacy setting, is a plain language explanation displayed before the change takes effect?
- [ ] **null EDPB_AUDIT**: Does the platform apply confirmation pop-ups symmetrically, appearing equally whether the user accepts or declines data sharing, rather than  
  **null UK_ICO_CHE**: Does the platform apply the concept of core service narrowly avoiding the use of a broad core service definition to exempt optional features
- [ ] **null EDPB_AUDIT**: Does the platform apply confirmation pop-ups symmetrically, appearing equally whether the user accepts or declines data sharing, rather than  
  **null UK_ICO_CHE**: Does the platform avoid bundling different types of profiling together under a single privacy toggle or consent mechanism?
- [ ] **null EDPB_AUDIT**: Is the privacy policy link easily accessible after completing registration, reachable within a minimal number of steps rather than hidden be  
  **null UK_ICO_CHE**: Does the platform fail to provide any contextual, bite-sized privacy explanation at the point at which a child's personal data is activated 
- [ ] **null EDPB_AUDIT**: Is the privacy policy link easily accessible after completing registration, reachable within a minimal number of steps rather than hidden be  
  **P-3 DEMO**: The privacy policy for younger users is easy to find.
- [ ] **null EDPB_AUDIT**: Are data visibility settings pre-set to the most restrictive available option by default, rather than 'Everyone' or a broadly invasive optio  
  **null UK_ICO_CHE**: Are any privacy settings governing optional or non-essential processing set to on, public, or data-sharing enabled by default for child acco
- [ ] **null EDPB_AUDIT**: Are data visibility settings pre-set to the most restrictive available option by default, rather than 'Everyone' or a broadly invasive optio  
  **null UK_ICO_CHE**: Is children's personal data not made visible to other users by default with visibility settings requiring the child to actively change them 
- [ ] **null EDPB_AUDIT**: Can users access the privacy policy or data protection information during sign-up without needing to complete registration first?  
  **null UK_ICO_CHE**: Does the platform fail to provide any contextual, bite-sized privacy explanation at the point at which a child's personal data is activated 
- [ ] **null EDPB_AUDIT**: Can users access the privacy policy or data protection information during sign-up without needing to complete registration first?  
  **null AUSTRALIA_**: Are the safety policies and community guidelines easily accessible without requiring navigation through multiple nested menus or sub-pages?
- [ ] **null EDPB_AUDIT**: Can users access the privacy policy or data protection information during sign-up without needing to complete registration first?  
  **P-3 DEMO**: The privacy policy for younger users is easy to find.
- [ ] **null EDPB_AUDIT**: If users are directed to the privacy policy to withdraw consent, can they actually find the withdrawal option after logging in?  
  **null UK_ICO_CHE**: Does the platform provide all privacy information required by Articles 13 and 14 of the GDPR accessible in a clear and prominent place on th
- [ ] **null EDPB_AUDIT**: If users are directed to the privacy policy to withdraw consent, can they actually find the withdrawal option after logging in?  
  **null UK_ICO_CHE**: Are the tools for exercising data protection rights so difficult to locate that children in the target age group would be unable to find the
- [ ] **null EDPB_AUDIT**: Are there shortcut links at every sign-up step where personal data is mentioned ?  
  **null AUSTRALIA_**: At the point of account creation, are privacy settings automatically set to the most restrictive level available?
- [ ] **null EDPB_AUDIT**: Are there shortcut links at every sign-up step where personal data is mentioned ?  
  **null AUSTRALIA_**: Are the safety policies and community guidelines easily accessible without requiring navigation through multiple nested menus or sub-pages?
- [ ] **null EDPB_AUDIT**: Are there shortcut links at every sign-up step where personal data is mentioned ?  
  **null UK_ICO_CHE**: Does the platform disclose any use of geolocation data at the point of sign-up informing children before they complete registration that the
- [ ] **null EDPB_AUDIT**: Do this shortcut links lead directly to the relevant section of the privacy policy/privacy settings — without requiring extra navigation?  
  **null AUSTRALIA_**: Are the safety policies and community guidelines easily accessible without requiring navigation through multiple nested menus or sub-pages?
- [ ] **null EDPB_AUDIT**: Do this shortcut links lead directly to the relevant section of the privacy policy/privacy settings — without requiring extra navigation?  
  **P-3 DEMO**: The privacy policy for younger users is easy to find.

AI usage during this evaluation: [{"feature":"matching","model":"openai/gpt-oss-120b","calls":1,"inputTokens":1923,"outputTokens":513}]
