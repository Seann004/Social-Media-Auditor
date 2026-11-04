/** Every limit for the evidence feature lives here. */

export const PROMPT_VERSION = 'evidence-v1'
export const USER_AGENT = 'SafetyAuditEvidenceBot/1.0'

// Capture
export const MAX_PAGES_PER_RUN = 30
export const LINK_DEPTH = 1
export const PAGE_TIMEOUT_MS = 30_000
export const RUN_TIMEOUT_MS = 900_000
export const MAX_START_URLS = 10
export const MAX_CONCURRENT_RUNS = 1
export const MAX_RUNS_PER_PROJECT_PER_DAY = 5
export const MAX_REDIRECT_HOPS = 5
export const NETWORK_IDLE_WAIT_MS = 5_000
export const MAX_RESPONSE_BYTES = 25 * 1024 * 1024
export const BROWSER_CLOSE_TIMEOUT_MS = 5_000
/** A visit may take this many page timeouts: check, navigate, screenshot and read. */
export const VISIT_DEADLINE_PAGE_TIMEOUTS = 4

// AI budget
export const MAX_INPUT_TOKENS_PER_CALL = 5_000
export const MAX_OUTPUT_TOKENS_PER_CALL = 1_500
export const MAX_TOKENS_PER_RUN = 80_000
export const MAX_ITEMS_PER_CALL = 10
export const GROQ_MAX_WAIT_MS = 60_000
export const AI_TEMPERATURE = 0.1

// Passages and highlights
export const MAX_WORDS_PER_PASSAGE = 250
/** About 1 000 tokens, so that any one passage fits the input budget of a call. */
export const MAX_CHARS_PER_PASSAGE = 4_000
export const MAX_PASSAGES_PER_ITEM = 5
export const MAX_HIGHLIGHTS_PER_SUGGESTION = 2
export const JPEG_QUALITY = 70
/** Context kept around a highlighted quote in its close-up, in CSS pixels. */
export const HIGHLIGHT_PADDING_PX = 80
/** How many places a quote is tried at before it is left out, when its words occur more than once. */
export const HIGHLIGHT_MAX_OCCURRENCES = 5
/** Extra tries at a picture when the page moved while it was being taken. */
export const HIGHLIGHT_SHOT_RETRIES = 1

// Links and sessions (seconds unless named otherwise)
export const VIEWING_LINK_SECONDS = 300
export const ACCEPTED_EVIDENCE_LINK_SECONDS = 31_536_000
export const SESSION_HOURS = 12

// Keeping a run's status true: waits between tries at an update that failed (about a minute in all)
export const RUN_UPDATE_RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 5_000, 10_000, 20_000, 25_000]

// Decisions
export const MAX_OVERRIDE_REASON_CHARS = 2_000
/** Submission statuses in which the audit's answers can no longer change. */
export const LOCKED_SUBMISSION_STATUSES: readonly string[] = ['pending_review', 'approved']
