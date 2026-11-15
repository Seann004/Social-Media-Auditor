// Labelled checklist items for measuring the evidence-kind rules. Not imported by app code.
//
// The labels say which source can honestly answer each item, judged by a person reading the item,
// never by running the rules: `app` (seen in a signed-in app), `code` (seen in the code), `both`,
// or `neither` (policy, process, organisation, offline). `also` lists a second answer that is just
// as fair for an item that is genuinely mixed.
//
// How each set was used, so the numbers can be read fairly:
// - TUNING_SAMPLES were written first and shaped the first keyword lists.
// - ROUND_TWO_SAMPLES were written as a held-out set after the first lists. The first lists agreed
//   with only 2 of them, so they were then used to widen the lists: they are tuning data now.
// - ROUND_THREE_SAMPLES were written as a held-out set after the second change. The second lists
//   agreed with 8 of 15. Their misses showed two defects (a doubled consonant, "scanned", was not
//   found, and "within 90 days" was read as a response time when it was a retention period) and
//   one missing synonym ("birthday"), which were fixed: they are tuning data now.
// - HELD_OUT_SAMPLES were written after that third change and were never used to change the
//   rules. Their agreement is the fairest number.
import type { EvidenceKind } from './evidenceKind'

export interface KindSample {
  text: string
  label: EvidenceKind
  also?: readonly EvidenceKind[]
}

/** The six demo items, then realistic child-safety checklist items of every kind. */
export const TUNING_SAMPLES: readonly KindSample[] = [
  // The demo checklist.
  { text: 'Accounts of users under 16 are private by default.', label: 'app' },
  { text: 'Direct messages are off by default for users under 16.', label: 'app' },
  { text: 'Users can report a video, comment or account from the app.', label: 'app', also: ['both'] },
  { text: 'Parents can link to a teen account to manage safety settings.', label: 'app' },
  { text: 'A safety centre explains the tools available to teens and parents.', label: 'neither' },
  { text: 'The privacy policy for younger users is easy to find.', label: 'neither' },

  // Seen in a signed-in app.
  { text: 'Teens can block or mute any account that contacts them.', label: 'app' },
  { text: 'Adults who do not follow a teen cannot send them a direct message.', label: 'app' },
  { text: 'Location sharing is turned off for teen accounts until they turn it on.', label: 'app' },
  { text: 'Autoplay of videos is switched off for users under 18.', label: 'app' },
  { text: "A teen's follower list is not visible to accounts they don't follow.", label: 'app' },
  { text: 'Users under 18 get a reminder to take a break after an hour of scrolling.', label: 'app' },
  { text: 'Teens can turn off comments on their own posts.', label: 'app' },
  { text: "Teen accounts do not appear in 'suggested accounts' for adults.", label: 'app' },
  { text: 'Search results for self-harm terms show support resources instead of content.', label: 'app' },

  // Seen in the code.
  { text: 'Passwords are stored hashed, never in plain text.', label: 'code' },
  { text: 'Direct messages are encrypted in transit and at rest.', label: 'code' },
  { text: 'Failed login attempts are rate limited.', label: 'code' },
  { text: 'Chat messages of under-18 users are deleted after 90 days.', label: 'code' },
  { text: 'Every moderation action is written to an audit log.', label: 'code' },
  { text: 'Precise location data of children is not stored on the server.', label: 'code' },
  { text: 'Uploaded images are checked against a hash list of known abuse material.', label: 'code' },
  { text: "Parental consent is recorded with the date and the parent's account.", label: 'code' },
  { text: 'Personal data of users under 18 is not shared with advertisers.', label: 'code', also: ['neither'] },

  // Policy, process, organisation.
  { text: 'Staff who review reports receive child safety training every year.', label: 'neither' },
  { text: "The service carries out an annual children's risk assessment.", label: 'neither' },
  { text: "A named senior manager is accountable for children's safety.", label: 'neither' },
  { text: 'The terms of service are written in language a 13-year-old can understand.', label: 'neither' },
  { text: 'Reports of child sexual abuse material are passed to law enforcement.', label: 'neither' },
  { text: 'Moderators are available around the clock to handle urgent reports.', label: 'neither' },
  { text: 'The company publishes a yearly transparency report on child safety.', label: 'neither' },
  { text: 'Appeals against a moderation decision are answered within seven days.', label: 'neither' },

  // Seen in the app, with a part only the code shows.
  { text: 'Users must enter their date of birth when they sign up.', label: 'both' },
  { text: 'Children under 13 who give their real age are blocked from creating an account.', label: 'both' },
  { text: 'Users can delete their account and their data from the settings page.', label: 'both' },
  { text: 'Teen accounts are switched to private when an age check shows the user is under 16.', label: 'both' },
  { text: 'Users can download a copy of the data stored about them.', label: 'both' },
]

/** Written after the first lists; the first lists agreed with 2 of them, and they then shaped the second change. */
export const ROUND_TWO_SAMPLES: readonly KindSample[] = [
  { text: 'Teen accounts cannot receive gifts or payments from adults.', label: 'app' },
  { text: 'Users under 18 cannot go live.', label: 'app' },
  { text: 'The app asks teens to confirm before posting their location.', label: 'app' },
  { text: 'Young users see a warning before they view sensitive content.', label: 'app' },
  { text: 'Direct messages from unknown adults go to a separate requests folder.', label: 'app' },
  { text: 'Session tokens expire after 30 minutes of inactivity.', label: 'code' },
  { text: "The API refuses requests that try to read another user's private messages.", label: 'code' },
  { text: 'Images uploaded by under-18s have their location metadata removed.', label: 'code' },
  { text: "Account deletion removes the user's messages from the database within 30 days.", label: 'code', also: ['both'] },
  { text: 'Every new feature is reviewed for child safety risks before launch.', label: 'neither' },
  { text: 'Parents can contact a support team that answers within two working days.', label: 'neither' },
  { text: 'Content moderators have access to wellbeing support.', label: 'neither' },
  { text: 'The service has a clear process for removing illegal content quickly.', label: 'neither' },
  { text: 'Teens are asked their age at sign-up, and the answer is checked against other signals.', label: 'both' },
  { text: 'Users can turn off personalised ads, and their data is then no longer used for ads.', label: 'both' },
]

/** Written after the second change; the second lists agreed with 8 of them, and their misses shaped the third change. */
export const ROUND_THREE_SAMPLES: readonly KindSample[] = [
  { text: 'Teens can hide their like counts.', label: 'app' },
  { text: "Users under 16 cannot be added to group chats by people they don't know.", label: 'app' },
  { text: 'Teens are reminded to review their privacy settings every six months.', label: 'app' },
  { text: 'Live streams by users under 18 cannot receive gifts.', label: 'app' },
  { text: "A teen's exact location is never shown on their profile.", label: 'app' },
  { text: 'Users can see why a post was recommended to them.', label: 'app' },
  { text: 'Messages are scanned for grooming patterns before delivery.', label: 'code' },
  { text: 'Deleted photos are removed from backups within 90 days.', label: 'code' },
  { text: 'Parents receive an email when their child changes a safety setting.', label: 'code', also: ['both'] },
  { text: "Access to children's personal data is limited to staff who need it.", label: 'neither', also: ['code'] },
  { text: 'The age estimation model is tested for bias across skin tones.', label: 'neither' },
  { text: 'Content policies are translated into every language the service supports.', label: 'neither' },
  { text: 'The company consults young people when designing new features.', label: 'neither' },
  { text: 'Teen accounts default to the strictest content filter, and this is enforced on the server.', label: 'both' },
  { text: 'Users who enter a birthday under 13 at sign-up cannot try again with a different date.', label: 'both' },
]

/** Written after the third change, and never used to change the rules. */
export const HELD_OUT_SAMPLES: readonly KindSample[] = [
  { text: 'Teens can choose who sees their stories.', label: 'app' },
  { text: 'Adults cannot comment on posts by users under 16 unless they are friends.', label: 'app' },
  { text: 'The app pauses notifications at night for users under 18.', label: 'app' },
  { text: 'Profile photos of teens cannot be downloaded by other users.', label: 'app' },
  { text: "Reported accounts are hidden from a teen's search while a review is open.", label: 'app', also: ['both'] },
  { text: 'Uploaded videos are compressed and their GPS tags stripped on the server.', label: 'code' },
  { text: "A user's age is stored separately from their public profile.", label: 'code' },
  { text: "Moderation decisions are saved with the moderator's ID.", label: 'code' },
  { text: 'The service tells the regulator about serious incidents within 72 hours.', label: 'neither' },
  { text: 'Safety features are designed with input from child development experts.', label: 'neither' },
  { text: 'Volunteers who run community groups are vetted.', label: 'neither' },
  { text: 'Every report is acknowledged by email, and the reporter can follow its progress in the app.', label: 'both' },
]
