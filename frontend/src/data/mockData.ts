import type { User, Guideline, ChecklistItem, AuditProject, AuditResponse } from '../types'

export const USERS: User[] = [
  { id: 'u1', name: 'Jackie Chan', role: 'head_auditor', initials: 'JC', color: 'bg-violet-500' },
  { id: 'u2', name: 'John Lee', role: 'auditor', initials: 'JL', color: 'bg-emerald-500' },
  { id: 'u3', name: 'Ahmad bin Ali', role: 'auditor', initials: 'AA', color: 'bg-amber-500' },
  { id: 'u4', name: 'Sanji Nambiar', role: 'auditor', initials: 'SN', color: 'bg-rose-500' },
  { id: 'u5', name: 'Sam Admin', role: 'admin', initials: 'SA', color: 'bg-blue-600' },
]

export const CURRENT_USER_ID = 'u1'

export const GUIDELINES: Guideline[] = [
  {
    id: 'g1',
    name: 'EDPD – EU Data Protection',
    shortName: 'EDPD',
    version: '2024',
    description: 'European Data Protection framework establishing principles for personal data processing, data subject rights, and accountability obligations for digital platforms.',
    source: 'European Data Protection Board',
    categories: ['Lawful Basis for Processing', 'Data Subject Rights', 'Data Protection by Design', 'Data Breach Notification', 'International Data Transfers'],
    itemCount: 14,
    lastUpdated: '2024-01-15',
  },
  {
    id: 'g2',
    name: 'Australian eSafety Commissioner',
    shortName: 'eSafety AU',
    version: '2021',
    description: 'Australian Online Safety Act 2021 — Basic Online Safety Expectations and mandatory standards for social media services operating in Australia.',
    source: 'Australian eSafety Commissioner',
    categories: ['Basic Online Safety Expectations', 'Age Verification & Child Safety', 'Harmful Content', 'Reporting & Transparency', 'Safety by Design'],
    itemCount: 13,
    lastUpdated: '2024-03-01',
  },
  {
    id: 'g3',
    name: 'UK ICO Age-Appropriate Design Code',
    shortName: 'ICO Code',
    version: '2.0',
    description: "UK Information Commissioner's Office Age-Appropriate Design Code — 15 standards for online services likely to be accessed by children under 18.",
    source: "UK Information Commissioner's Office",
    categories: ['Age Assurance', 'Default Privacy Settings', 'No Nudge Techniques', 'Geolocation Controls', 'Profiling Limits', 'Parental Controls', 'Transparency'],
    itemCount: 15,
    lastUpdated: '2024-09-12',
  },
  {
    id: 'g4',
    name: 'Malaysian Personal Data Protection Act',
    shortName: 'MY PDPA',
    version: '2010',
    description: 'Malaysian Personal Data Protection Act 2010 — governing the processing of personal data in commercial transactions by digital platforms operating in or targeting Malaysia.',
    source: 'Personal Data Protection Department Malaysia',
    categories: ['Data Collection & Notice', 'Consent', 'Data Security', 'Data Integrity', 'Data Subject Rights', 'Cross-Border Transfer'],
    itemCount: 12,
    lastUpdated: '2023-06-01',
  },
  {
    id: 'g5',
    name: "Nielsen's Usability Heuristics",
    shortName: 'Nielsen',
    version: '10.0',
    description: "Jakob Nielsen's 10 general principles for interaction design — usability standards for social media platform interfaces and user experience.",
    source: 'Nielsen Norman Group',
    categories: ['Visibility & Feedback', 'User Control & Freedom', 'Consistency & Standards', 'Error Prevention', 'Help & Documentation'],
    itemCount: 10,
    lastUpdated: '2020-11-15',
  },
]

export const CHECKLIST_ITEMS: ChecklistItem[] = [
  // EDPD — Lawful Basis for Processing
  { id: 'e01', guidelineId: 'g1', category: 'Lawful Basis for Processing', text: 'Platform identifies and documents a valid lawful basis for each personal data processing activity.', severity: 'critical', reference: 'Art. 6 GDPR' },
  { id: 'e02', guidelineId: 'g1', category: 'Lawful Basis for Processing', text: 'Consent obtained is freely given, specific, informed, and unambiguous — not bundled with terms of service.', severity: 'critical', reference: 'Art. 7 GDPR' },
  { id: 'e03', guidelineId: 'g1', category: 'Lawful Basis for Processing', text: 'Platform maintains records of consent including timestamp, version of consent text, and purpose.', severity: 'major', reference: 'Art. 7(1) GDPR' },
  // EDPD — Data Subject Rights
  { id: 'e04', guidelineId: 'g1', category: 'Data Subject Rights', text: 'Users can access a complete copy of their personal data upon request.', severity: 'critical', reference: 'Art. 15 GDPR' },
  { id: 'e05', guidelineId: 'g1', category: 'Data Subject Rights', text: 'Platform provides a working mechanism for users to request erasure of personal data (right to be forgotten).', severity: 'critical', reference: 'Art. 17 GDPR' },
  { id: 'e06', guidelineId: 'g1', category: 'Data Subject Rights', text: 'Users can object to automated decision-making and profiling that produces legal or significant effects.', severity: 'major', reference: 'Art. 22 GDPR' },
  { id: 'e07', guidelineId: 'g1', category: 'Data Subject Rights', text: 'Platform responds to all data subject requests within 30 calendar days.', severity: 'major', reference: 'Art. 12(3) GDPR' },
  // EDPD — Data Protection by Design
  { id: 'e08', guidelineId: 'g1', category: 'Data Protection by Design', text: 'Privacy-by-design principles are documented and embedded in system development lifecycle.', severity: 'major', reference: 'Art. 25 GDPR' },
  { id: 'e09', guidelineId: 'g1', category: 'Data Protection by Design', text: 'Data minimisation is applied — only personal data strictly necessary for the stated purpose is collected.', severity: 'critical', reference: 'Art. 5(1)(c) GDPR' },
  { id: 'e10', guidelineId: 'g1', category: 'Data Protection by Design', text: 'A Data Protection Officer (DPO) is appointed where required and contact details are publicly available.', severity: 'major', reference: 'Art. 37 GDPR' },
  // EDPD — Data Breach Notification
  { id: 'e11', guidelineId: 'g1', category: 'Data Breach Notification', text: 'Platform maintains a documented data breach response procedure with defined roles and timelines.', severity: 'critical', reference: 'Art. 33 GDPR' },
  { id: 'e12', guidelineId: 'g1', category: 'Data Breach Notification', text: 'Personal data breaches are reported to the supervisory authority within 72 hours of discovery.', severity: 'critical', reference: 'Art. 33(1) GDPR' },
  // EDPD — International Data Transfers
  { id: 'e13', guidelineId: 'g1', category: 'International Data Transfers', text: 'Transfers of personal data outside the EEA are based on an adequacy decision or appropriate safeguards.', severity: 'critical', reference: 'Art. 46 GDPR' },
  { id: 'e14', guidelineId: 'g1', category: 'International Data Transfers', text: 'Standard contractual clauses or binding corporate rules are in place for all third-country data transfers.', severity: 'major', reference: 'Art. 46(2) GDPR' },

  // Australian eSafety Commissioner — Basic Online Safety Expectations
  { id: 'a01', guidelineId: 'g2', category: 'Basic Online Safety Expectations', text: 'Platform has published a statement of compliance with the Basic Online Safety Expectations (BOSE).', severity: 'major', reference: 'Online Safety Act 2021 s.46' },
  { id: 'a02', guidelineId: 'g2', category: 'Basic Online Safety Expectations', text: 'Platform takes reasonable steps to ensure users are not exposed to harmful content.', severity: 'critical', reference: 'Online Safety Act 2021 s.47' },
  { id: 'a03', guidelineId: 'g2', category: 'Basic Online Safety Expectations', text: 'Platform provides a visible and easy-to-use complaints mechanism for users to report harmful content.', severity: 'critical', reference: 'Online Safety Act 2021 s.47(2)' },
  // Australian eSafety — Age Verification & Child Safety
  { id: 'a04', guidelineId: 'g2', category: 'Age Verification & Child Safety', text: 'Platform implements age verification measures to prevent minors from accessing age-restricted material.', severity: 'critical', reference: 'Online Safety Act 2021 s.102' },
  { id: 'a05', guidelineId: 'g2', category: 'Age Verification & Child Safety', text: 'Age-appropriate design principles are applied to all features and content accessible by minors.', severity: 'major', reference: 'eSafety by Design Guidance' },
  // Australian eSafety — Harmful Content
  { id: 'a06', guidelineId: 'g2', category: 'Harmful Content', text: 'End-to-end encrypted services have proactive technical measures to detect child sexual abuse material.', severity: 'critical', reference: 'Online Safety Act 2021 s.187' },
  { id: 'a07', guidelineId: 'g2', category: 'Harmful Content', text: 'Platform removes Class 1 material (CSAM) within timeframes specified by the eSafety Commissioner.', severity: 'critical', reference: 'Online Safety Act 2021 s.109' },
  { id: 'a08', guidelineId: 'g2', category: 'Harmful Content', text: 'Platform has documented processes to address cyberflashing and non-consensual sharing of intimate images.', severity: 'major', reference: 'Online Safety Act 2021 s.75' },
  // Australian eSafety — Reporting & Transparency
  { id: 'a09', guidelineId: 'g2', category: 'Reporting & Transparency', text: 'Platform publishes annual transparency reports including content removal statistics by category.', severity: 'major', reference: 'Online Safety Act 2021 s.47(6)' },
  { id: 'a10', guidelineId: 'g2', category: 'Reporting & Transparency', text: 'Platform cooperates fully with eSafety Commissioner investigations, audits, and information requests.', severity: 'critical', reference: 'Online Safety Act 2021 s.183' },
  // Australian eSafety — Safety by Design
  { id: 'a11', guidelineId: 'g2', category: 'Safety by Design', text: 'Safety-by-design principles are embedded at the design stage of all new features and products.', severity: 'major', reference: 'eSafety by Design Framework' },
  { id: 'a12', guidelineId: 'g2', category: 'Safety by Design', text: 'Platform has a named senior executive accountable for online safety compliance.', severity: 'major', reference: 'BOSE Determination 2022' },
  { id: 'a13', guidelineId: 'g2', category: 'Safety by Design', text: 'Platform conducts regular safety risk assessments before launching new features targeting minors.', severity: 'minor', reference: 'eSafety by Design Framework' },

  // UK ICO Code — Age Assurance
  { id: 'i01', guidelineId: 'g3', category: 'Age Assurance', text: 'Platform implements age verification or age estimation to identify users likely to be children.', severity: 'critical', reference: 'Standard 2' },
  { id: 'i02', guidelineId: 'g3', category: 'Age Assurance', text: 'Age assurance mechanisms are proportionate to the level of risk posed by the data processing.', severity: 'major', reference: 'Standard 2' },
  { id: 'i03', guidelineId: 'g3', category: 'Age Assurance', text: 'Age assurance data is not retained longer than strictly necessary to complete verification.', severity: 'critical', reference: 'Standard 2' },
  // UK ICO Code — Default Privacy Settings
  { id: 'i04', guidelineId: 'g3', category: 'Default Privacy Settings', text: 'Default privacy settings are set to the highest level of privacy for users identified as children.', severity: 'critical', reference: 'Standard 4' },
  { id: 'i05', guidelineId: 'g3', category: 'Default Privacy Settings', text: "Child users' profile information is private and not publicly visible by default.", severity: 'critical', reference: 'Standard 4' },
  { id: 'i06', guidelineId: 'g3', category: 'Default Privacy Settings', text: 'Direct messaging for child users is restricted to confirmed contacts only by default.', severity: 'critical', reference: 'Standard 4' },
  // UK ICO Code — No Nudge Techniques
  { id: 'i07', guidelineId: 'g3', category: 'No Nudge Techniques', text: 'Platform does not deploy nudge techniques to encourage children to share more personal data.', severity: 'critical', reference: 'Standard 6' },
  { id: 'i08', guidelineId: 'g3', category: 'No Nudge Techniques', text: 'No dark patterns are used in privacy settings or consent flows targeted at child users.', severity: 'critical', reference: 'Standard 6' },
  { id: 'i09', guidelineId: 'g3', category: 'No Nudge Techniques', text: 'Opt-out options are equally prominent and accessible as opt-in options for child users.', severity: 'major', reference: 'Standard 6' },
  // UK ICO Code — Geolocation Controls
  { id: 'i10', guidelineId: 'g3', category: 'Geolocation Controls', text: 'Precise geolocation data is not collected from child users unless strictly necessary and with explicit consent.', severity: 'critical', reference: 'Standard 9' },
  { id: 'i11', guidelineId: 'g3', category: 'Geolocation Controls', text: 'Geolocation features can be disabled by child users without loss of core platform functionality.', severity: 'major', reference: 'Standard 9' },
  // UK ICO Code — Profiling Limits
  { id: 'i12', guidelineId: 'g3', category: 'Profiling Limits', text: 'Profiling of child users for targeted advertising is switched off by default.', severity: 'critical', reference: 'Standard 7' },
  { id: 'i13', guidelineId: 'g3', category: 'Profiling Limits', text: 'Inferred interests and behavioural data of child users are not shared with third parties for advertising.', severity: 'critical', reference: 'Standard 7' },
  // UK ICO Code — Parental Controls
  { id: 'i14', guidelineId: 'g3', category: 'Parental Controls', text: "Platform provides accessible parental controls that do not expose a child's specific browsing history.", severity: 'major', reference: 'Standard 12' },
  // UK ICO Code — Transparency
  { id: 'i15', guidelineId: 'g3', category: 'Transparency', text: 'Privacy policy is written in child-friendly language and is clearly accessible from the platform.', severity: 'major', reference: 'Standard 3' },

  // Malaysian PDPA — Data Collection & Notice
  { id: 'm01', guidelineId: 'g4', category: 'Data Collection & Notice', text: 'Platform provides a clear and accessible privacy notice before or at the point of personal data collection.', severity: 'critical', reference: 'Principle 1 PDPA 2010' },
  { id: 'm02', guidelineId: 'g4', category: 'Data Collection & Notice', text: "Privacy notice specifies the type of data collected, the purpose of processing, and the user's rights.", severity: 'critical', reference: 'Principle 1(b) PDPA 2010' },
  { id: 'm03', guidelineId: 'g4', category: 'Data Collection & Notice', text: "Personal data is collected only for a lawful purpose directly related to the platform's activities.", severity: 'major', reference: 'Principle 2 PDPA 2010' },
  // Malaysian PDPA — Consent
  { id: 'm04', guidelineId: 'g4', category: 'Consent', text: 'Platform obtains explicit user consent before processing sensitive personal data categories.', severity: 'critical', reference: 'Principle 3 PDPA 2010' },
  { id: 'm05', guidelineId: 'g4', category: 'Consent', text: 'Users can withdraw consent at any time and the platform acts upon withdrawal without undue delay.', severity: 'major', reference: 'Principle 3(2) PDPA 2010' },
  // Malaysian PDPA — Data Security
  { id: 'm06', guidelineId: 'g4', category: 'Data Security', text: 'Platform implements reasonable security safeguards to prevent unauthorised access, loss, or disclosure.', severity: 'critical', reference: 'Principle 7 PDPA 2010' },
  { id: 'm07', guidelineId: 'g4', category: 'Data Security', text: 'Staff who handle personal data are trained on PDPA obligations and internal data protection policies.', severity: 'major', reference: 'Principle 7 PDPA 2010' },
  // Malaysian PDPA — Data Integrity
  { id: 'm08', guidelineId: 'g4', category: 'Data Integrity', text: 'Platform takes reasonable steps to ensure all stored personal data is accurate and kept up to date.', severity: 'major', reference: 'Principle 4 PDPA 2010' },
  { id: 'm09', guidelineId: 'g4', category: 'Data Integrity', text: 'Personal data is not retained longer than is necessary to fulfil the purpose for which it was collected.', severity: 'major', reference: 'Principle 5 PDPA 2010' },
  // Malaysian PDPA — Data Subject Rights
  { id: 'm10', guidelineId: 'g4', category: 'Data Subject Rights', text: 'Users can request access to their personal data and receive a response within 21 days.', severity: 'major', reference: 'Principle 6 PDPA 2010' },
  { id: 'm11', guidelineId: 'g4', category: 'Data Subject Rights', text: 'Users can request correction of inaccurate personal data and the platform processes it within 21 days.', severity: 'major', reference: 'Principle 6(3) PDPA 2010' },
  // Malaysian PDPA — Cross-Border Transfer
  { id: 'm12', guidelineId: 'g4', category: 'Cross-Border Transfer', text: 'Transfer of personal data outside Malaysia is only to countries with adequate protection or with user consent.', severity: 'critical', reference: 'Principle 9 PDPA 2010' },

  // Nielsen's Usability Heuristics — Visibility & Feedback
  { id: 'n01', guidelineId: 'g5', category: 'Visibility & Feedback', text: "Platform always shows users the current system status — loading states, save confirmations, and progress indicators are clearly visible.", severity: 'major', reference: 'Heuristic 1' },
  { id: 'n02', guidelineId: 'g5', category: 'Visibility & Feedback', text: 'Platform provides clear and timely feedback for every user action within a reasonable time (under 1 second for most interactions).', severity: 'major', reference: 'Heuristic 1' },
  // Nielsen — User Control & Freedom
  { id: 'n03', guidelineId: 'g5', category: 'User Control & Freedom', text: 'Users can clearly undo and redo actions throughout the platform without losing data.', severity: 'minor', reference: 'Heuristic 3' },
  { id: 'n04', guidelineId: 'g5', category: 'User Control & Freedom', text: 'Platform provides clearly marked exits so users can leave unwanted states without going through a long process.', severity: 'minor', reference: 'Heuristic 3' },
  // Nielsen — Consistency & Standards
  { id: 'n05', guidelineId: 'g5', category: 'Consistency & Standards', text: "Platform follows established UI conventions — icons, terminology, and interactions match user expectations.", severity: 'minor', reference: 'Heuristic 4' },
  { id: 'n06', guidelineId: 'g5', category: 'Consistency & Standards', text: 'Design is visually consistent across all screens — colours, typography, and interaction patterns are predictable.', severity: 'major', reference: 'Heuristic 4' },
  // Nielsen — Error Prevention
  { id: 'n07', guidelineId: 'g5', category: 'Error Prevention', text: 'Platform proactively prevents errors — irreversible actions require a confirmation step before proceeding.', severity: 'major', reference: 'Heuristic 5' },
  { id: 'n08', guidelineId: 'g5', category: 'Error Prevention', text: 'Forms provide real-time inline validation to guide users before they submit and make errors.', severity: 'minor', reference: 'Heuristic 5' },
  // Nielsen — Help & Documentation
  { id: 'n09', guidelineId: 'g5', category: 'Help & Documentation', text: 'Error messages are written in plain language, identify the specific problem, and suggest a concrete solution.', severity: 'minor', reference: 'Heuristic 9' },
  { id: 'n10', guidelineId: 'g5', category: 'Help & Documentation', text: 'Platform provides context-sensitive help and documentation that is easy to search and focused on the user task.', severity: 'minor', reference: 'Heuristic 10' },
]

export const AUDIT_PROJECTS: AuditProject[] = [
  {
    id: 'p1',
    name: 'TikTok EDPD & ICO Audit',
    platform: 'TikTok',
    guidelineIds: ['g1', 'g3'],
    status: 'in_progress',
    submissionStatus: 'not_submitted',
    headAuditorId: 'u1',
    auditorIds: ['u1', 'u2'],
    createdAt: '2026-04-22',
    updatedAt: '2026-05-08',
    dueDate: '2026-06-17',
    scope: ['Age Assurance', 'Default Privacy Settings', 'Lawful Basis for Processing', 'Data Subject Rights'],
    notes: 'Focus on features accessible to under-13 users. Cross-reference TikTok for Younger Users documentation.',
  },
  {
    id: 'p2',
    name: 'Instagram ICO Code Review',
    platform: 'Instagram',
    guidelineIds: ['g3'],
    status: 'completed',
    submissionStatus: 'approved',
    submissionRemarks: 'All findings well-documented. Minor gaps noted in Default Privacy Settings — follow-up scheduled for Q3.',
    headAuditorId: 'u1',
    auditorIds: ['u1', 'u3'],
    createdAt: '2026-04-01',
    updatedAt: '2026-05-02',
    dueDate: '2026-05-02',
    scope: ['Age Assurance', 'Default Privacy Settings', 'No Nudge Techniques', 'Transparency'],
    notes: "Completed May 2026. Follow-up audit recommended after Instagram's Q3 privacy update.",
  },
  {
    id: 'p3',
    name: 'Facebook EDPD & MY PDPA Audit',
    platform: 'Facebook',
    guidelineIds: ['g1', 'g4'],
    status: 'in_progress',
    submissionStatus: 'not_submitted',
    headAuditorId: 'u1',
    auditorIds: ['u1', 'u4'],
    createdAt: '2026-04-28',
    updatedAt: '2026-05-07',
    dueDate: '2026-05-23',
    scope: ['Data Subject Rights', 'Data Security', 'Consent', 'Cross-Border Transfer'],
    notes: "Using Facebook's Privacy Fundamentals documentation as reference. Mapping compliance gaps from the 2025 audit.",
  },
  {
    id: 'p4',
    name: 'Discord eSafety AU Baseline',
    platform: 'Discord',
    guidelineIds: ['g2'],
    status: 'draft',
    submissionStatus: 'not_submitted',
    headAuditorId: 'u1',
    auditorIds: ['u1'],
    createdAt: '2026-05-09',
    updatedAt: '2026-05-09',
    dueDate: '2026-06-30',
    scope: [],
    notes: '',
  },
  {
    id: 'p5',
    name: 'Snapchat ICO & Nielsen Audit',
    platform: 'Snapchat',
    guidelineIds: ['g3', 'g5'],
    status: 'under_review',
    submissionStatus: 'pending_review',
    headAuditorId: 'u3',
    auditorIds: ['u1', 'u3'],
    createdAt: '2026-04-10',
    updatedAt: '2026-05-05',
    dueDate: '2026-05-12',
    scope: ['Age Assurance', 'Default Privacy Settings', 'Visibility & Feedback', 'Error Prevention'],
    notes: 'Submitted for review by head auditor. Score pending final sign-off.',
  },
]

// INITIAL_RESPONSES are empty — all audit results are persisted in Supabase
export const INITIAL_RESPONSES: AuditResponse[] = []
