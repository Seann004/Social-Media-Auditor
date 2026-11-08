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

// Reading from Supabase
/** Rows asked for at a time by reads with no natural limit. Below PostgREST's default cap of 1 000, so a short page always means the end. */
export const SUPABASE_READ_PAGE_SIZE = 500

// Keeping a run's status true: waits between tries at an update that failed (about a minute in all)
export const RUN_UPDATE_RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 5_000, 10_000, 20_000, 25_000]

// Decisions
export const MAX_OVERRIDE_REASON_CHARS = 2_000
/** Text the auditor typed that travels with a decision. The older save routes have no cap, so these are generous. */
export const MAX_DECISION_FINDINGS_CHARS = 50_000
export const MAX_DECISION_NOTES_CHARS = 10_000
/** Submission statuses in which the audit's answers can no longer change. */
export const LOCKED_SUBMISSION_STATUSES: readonly string[] = ['pending_review', 'approved']

// Starting runs
/** Extra time past the whole-run timeout before a capturing or assessing run is taken to be lost. */
export const STALE_RUN_MARGIN_MS = 300_000
/** The queue runs one job at a time, so a queued run can wait a long time. Past this it is taken to be lost. */
export const STALE_QUEUED_RUN_MS = 6 * 60 * 60 * 1000
export const RUNS_WINDOW_MS = 24 * 60 * 60 * 1000
/** How many lost runs one sweep fails before it gives up. */
export const MAX_STALE_SWEEP = 10

// API
/** Per signed-in user. The page polls every 3 seconds and several tabs may be open. */
export const API_REQUESTS_PER_MINUTE = 300
export const API_RATE_WINDOW_MS = 60_000
export const MAX_BODY_SIZE = '64kb'
export const MAX_ROUTE_PARAM_LENGTH = 64
/** An id in a route: letters, digits and dashes. */
export const ROUTE_ID_PATTERN = /^[A-Za-z0-9-]+$/
export const MAX_URL_LENGTH = 2_048
export const MAX_PERMISSION_NOTE_CHARS = 500

// App evidence: the AI checks items by using the platform's web app
export const APP_PROMPT_VERSION = 'app-evidence-v1'
export const APP_MAX_STEPS_PER_CHECK = 15
/** Its own cap: the Phase 1 cap of 80 000 covers only one or two checks. Counts step and judge calls. */
export const APP_MAX_TOKENS_PER_RUN = 200_000
export const APP_MAX_ITEMS_PER_RUN = 10

// Step prompt budget
export const APP_STEP_INPUT_TOKENS = 2_000
export const APP_STEP_OUTPUT_TOKENS = 800
export const APP_PAGE_TEXT_CHARS = 3_200
export const APP_MAX_ELEMENTS = 80
export const APP_ELEMENT_LINE_CHARS = 160
export const APP_HISTORY_LINES = 12
export const APP_HISTORY_LINE_CHARS = 300
// Fixed caps on the other step-prompt fields, so the whole prompt stays within APP_STEP_INPUT_TOKENS
export const APP_PROMPT_ITEM_TEXT_CHARS = 500
export const APP_PROMPT_NAME_CHARS = 100
export const APP_PROMPT_ACCOUNT_CHARS = 30
export const APP_PROMPT_SESSION_CHARS = 100
export const APP_PROMPT_URL_CHARS = 200
export const APP_PROMPT_LEFT_CHANGED_LINES = 5
export const APP_PROMPT_LEFT_CHANGED_CHARS = 100

// Reading and typing
export const APP_CONTEXT_TEXT_CHARS = 400
export const APP_MAX_TYPE_CHARS = 500
/** Shorter secrets are not looked for in the view or the page text: they would match everywhere. */
export const APP_MIN_SECRET_CHARS = 4

// Timing
export const APP_ACTION_TIMEOUT_MS = 15_000
export const APP_SETTLE_MS = 500
export const APP_NETWORK_IDLE_WAIT_MS = 2_000
export const APP_RUN_TIMEOUT_MS = 1_800_000
/** After the run timeout, how long putting back one check's changes may still take (ruling A22). */
export const APP_RESTORE_GRACE_MS = 60_000
/** How long the response a followed redirect ended on waits for the browser's navigation to it. */
export const APP_REDIRECT_ARRIVAL_MS = 10_000

// Project limits
export const APP_MAX_TEST_ACCOUNTS = 6
export const APP_MAX_LOGIN_DOMAINS = 5
export const APP_MAX_HANDLES = 5

// Giving up
export const APP_LOGIN_FAILURES_BEFORE_UNUSABLE = 2
export const APP_UNREADABLE_REPLIES_BEFORE_STOP = 3

// Crypto and AI
export const SECRET_KEY_BYTES = 32
export const AI_REASONING_EFFORT = 'low'

// Repo evidence: the AI checks items against the code of a public GitHub repository
export const REPO_PROMPT_VERSION = 'repo-evidence-v1'
export const REPO_MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024
export const REPO_MAX_UNPACKED_BYTES = 200 * 1024 * 1024
/** Kept files; reading stops after this many. */
export const REPO_MAX_FILES = 5_000
export const REPO_MAX_FILE_BYTES = 300_000
/** Kept lines across all files; reading stops before passing this many. */
export const REPO_MAX_TOTAL_LINES = 2_000_000
export const REPO_MAX_ITEMS_PER_RUN = 10
export const REPO_LINES_AROUND = 20
export const REPO_MAX_PIECES_PER_ITEM = 6
export const REPO_MAX_MORE_TERMS = 3
export const REPO_MAX_SEARCH_WORDS = 12
export const REPO_MAX_PATH_HINTS = 6
export const REPO_PROMPT_PATHS_CHARS = 3_000
export const REPO_FETCH_TIMEOUT_MS = 60_000
export const REPO_MAX_REDIRECTS = 3
/** Folders skipped at any depth. */
export const REPO_SKIP_DIRS: readonly string[] = [
  'node_modules', 'vendor', 'dist', 'build', '.git', '.next', 'out', 'coverage', 'target',
]
export const REPO_LOCK_FILES: readonly string[] = [
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock', 'poetry.lock', 'composer.lock', 'Gemfile.lock',
]
/** The only hosts a repo run talks to. */
export const REPO_GITHUB_HOSTS: readonly string[] = ['api.github.com', 'codeload.github.com']
