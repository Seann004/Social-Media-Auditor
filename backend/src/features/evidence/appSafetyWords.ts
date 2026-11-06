/**
 * The word lists of the app safety rules. They are a net, not a proof: the rules refuse unless an
 * action is positively safe, so a label in a language these lists miss is caught by the rule that
 * refuses unknown controls in a person context (see appSafetyTargets.ts).
 */

/** Words for reaching another person. Plurals and -ing forms count. */
export const PERSON_ACTION = new RegExp(
  '\\b(?:' +
    [
      'messag(?:e|es|ing)', 'send(?:s|ing)?', 'follow(?:s|ing|ers)?', 'add friend', 'invite(?:s|d)?', 'inviting',
      'comment(?:s|ing)?', 'repl(?:y|ies|ying)', 'tag(?:s|ging)?', 'mention(?:s|ing)?', 'chat(?:s|ting)?', 'dms?', 'connect(?:s|ing)?',
      'pok(?:e|es|ing)', 'wav(?:e|es|ing)', 'calls?', 'calling', 'requests?', 'accept(?:s|ing)?', 'join(?:s|ing)?',
      'lik(?:e|es|ing)', 'duets?', 'stitch(?:es)?', 'remix(?:es)?', 'envoyer', 'enviar', 'senden', 'nachricht', 'mensaje', 'mensagem',
      'seguir', 'suivre', 'folgen', 'abonner',
    ].join('|') +
    ')\\b',
  'i',
)

/** Words for putting something where others can see it. */
export const PUBLISH_ACTION = new RegExp(
  '\\b(?:' +
    [
      'post(?:s|ed|ing)?', 'publish(?:es|ed|ing)?', 'share(?:s|d)?', 'sharing', 'live', 'tweet(?:s|ed|ing)?', 'repost(?:s|ed|ing)?',
      'retweet(?:s|ed|ing)?', 'upload(?:s|ed|ing)?', 'broadcast(?:s|ing)?', 'stor(?:y|ies)', 'reels?', 'boost(?:s|ed|ing)?',
      'quote(?:s|d)?', 'publicar', 'publier', 'compartir', 'partager', 'teilen', 'ver[oö]ffentlichen',
    ].join('|') +
    ')\\b',
  'i',
)

/**
 * A button that looks like the last step of a form, whatever it submits, matched at the start of the label.
 * (post, publish, share, quote, boost, live and upload are in PUBLISH_ACTION, send in PERSON_ACTION and confirm in DESTRUCTIVE_ACTION.)
 */
export const FINAL_ACTION = /^\s*(?:submit|done|create|save|next|finish|apply|ok)\b/i

export const DESTRUCTIVE_ACTION = new RegExp(
  '\\b(?:' +
    [
      'delet\\w*', 'deactivat\\w*', 'eras\\w+', 'remov\\w*', 'disabl\\w*', 'suspend\\w*', 'revok\\w*', 'clos\\w* (?:my |your |the )?account',
      'cancel (?:my |your |the )?(?:account|subscription|membership|plan|order)', 'paus\\w* (?:my |your |the )?(?:account|profile|membership)',
      'take a break', '(?:change|reset|forgot|forget|update|edit|new|set)\\s+(?:\\w+\\s+)?(?:password|email|phone|username|mobile)',
      '(?:password|email|phone|username|mobile)\\s+(?:change|reset|update|edit)', 'email address', 'phones?', 'pay\\w*', 'billing', 'cards?', 'purchas\\w*', 'buy\\w*', 'checkout', 'subscri\\w+', 'upgrad\\w*',
      'donat\\w*', 'gift\\w*', 'coins?', 'tips?', 'tipping', 'top ?ups?', 'recharg\\w*', 'orders?', 'ordering', 'unlock\\w*', 'membership\\w*',
      'report\\w*', 'confirm\\w*', 'unsend\\w*', 'unfollow\\w*', 'leav(?:e|es|ing)', 'clear\\w*', 'permanent\\w*',
      'log ?out', 'log ?off', 'sign ?out', 'end session', 'other sessions', 'supprim\\w*', 'elimin\\w*', 'borrar', 'l[öo]e?schen',
      'entfern\\w*', 'pagar', 'comprar', 'acheter', 'kaufen', 'bezahlen', 'cerrar sesi[oó]n', 'd[ée]connexion', 'abmelden',
    ].join('|') +
    ')\\b',
  'i',
)

/** A price or a recurring charge. Tested on the text as written, before its punctuation is dropped. */
export const PRICE = /[$€£]\s?\d|\d\s?(?:usd|eur|gbp)\b|\bper (?:month|year|week)\b|\/\s?(?:mo|month|yr|year)\b/i

export const PRIVATE_AUDIENCE = /\b(?:only me|just me|private|test accounts? only)\b/i
/** Words that turn a private-sounding audience into a wider one: "not private", "private group (visible to all members)". */
export const WIDENED_AUDIENCE = /\b(?:not|non|un)[- ]?private\b|\bvisible to (?:all|everyone|anyone|members)\b|\ball members\b|\bgroup\b|\bunlisted\b|\blink\b/i
export const PUBLIC_AUDIENCE = /\b(?:public|everyone|anyone|anybody|friends|followers|community|world|network|contacts|connections)\b/i
/** What marks a control as the audience control of a composer. */
export const AUDIENCE_CONTROL = /audience|visibility|privacy|who can (?:see|view)|share with|shared with|visible to/i

/** A field that sets who a message goes to. */
export const RECIPIENT_FIELD = /^\s*(?:to|cc|bcc)\b|\b(?:recipients?|send to|share with|add people|contacts?)\b/i
/** Controls that go nowhere near a person; the only ones allowed in a person context without a target. */
export const SAFE_NAVIGATION =
  /^\s*(?:open|view|settings|privacy|privacy settings|back|next page|previous page|menu|more|close|cancel|home|profile|about|overview|posts|photos|videos|search|help)\s*$/i

/** Fields of an account that the AI never types into. */
export const ACCOUNT_FIELD = /\b(?:e-?mail|username|user name|mobile|birth\w*|dob)\b/i
export const LOGIN_PATH = /\/(?:log-?in|sign-?in|sso|auth)(?:\/|$)/i

export const TWO_FACTOR =
  /two-factor|2-step|two-step|verification code|security code|enter the code|authenticator|code we sent|login code|log-in code|confirmation code|\d[- ]?digit code|one-time (?:code|passcode)|passcode/i
export const SUSPICIOUS =
  /suspicious activity|unusual activity|confirm it'?s you|verify it'?s you|we noticed unusual|account (?:is |has been |was )?(?:temporarily )?(?:locked|suspended|disabled)|we (?:have )?(?:locked|suspended|disabled) your account/i
export const CAPTCHA_FRAME = /recaptcha|hcaptcha|challenges\.cloudflare|turnstile|arkoselabs|funcaptcha|geetest|captcha-delivery|datadome|awswaf|perimeterx|px-cdn|fbsbx\.com\/captcha/i
/** Wording that is a block wherever it stands on the page. */
export const STRONG_BLOCK = /captcha|verify you(?:'re| are) (?:a )?human|press (?:&|and) hold|confirm you are (?:a )?human|checking your browser/i
export const BLOCK_TITLE_EXTRA = /security verification|human verification|verify you(?:'re| are)|verify it'?s you/i
export const CODE_FIELD = /\b(?:code|otp|verification|digit)\b/i
export const NOT_A_SECURITY_CODE = /promo|postal|zip|country|coupon|discount|voucher|area/i
