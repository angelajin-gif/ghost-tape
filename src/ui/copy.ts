// DRAFT COPY. Every string here is a placeholder until the developer writes the final copy,
// before Nov 28 (R38.4). Replacing copy means editing only this file. The strings quoted in
// requirements.md are the initial drafts.
//
// Rules (R38):
// - Every user-visible string in src/ui lives here, labels through ARIA announcements.
// - A string that contains a number is a function of that number (R38.3).
// - No string names a modem profile (R27.6): no "robust", no "standard".
// - The demo tape and the examples are data that the UI encodes; tests read them from here (R38.6).
// - Messages are keyed by name. Pure logic and state hold keys or numbers, never English text.

export const app = {
  name: 'Ghost Tape',
  tagline: 'A letter hidden in sound.',
  loading: 'Loading the tape…',
  documentTitle: (heading: string): string => `${heading} · Ghost Tape`,
} as const;

export const nav = {
  label: 'Main',
  home: 'Home',
  receive: 'Receive',
  compose: 'Send a tape',
  broadcast: 'Broadcast',
  notFound: 'That page does not exist. Taking you home.',
  offlineReady: 'Ready to use offline',
  updateAvailable: 'A new version is ready.',
  updateAction: 'Reload',
  routeFailed: 'This page could not be loaded.',
} as const;

export const receive = {
  heading: 'Receive a tape',
} as const;

export const home = {
  heading: 'Ghost Tape',
  intro: 'Play a ghost track out loud. Hold up a second device. Watch the letter develop like a photograph.',
  demoPrompt: 'Try the demo tape',
  callToAction: 'Now send a tape to someone.',
  callToActionLink: 'Make a tape',
} as const;

/** The placeholder demo tape (R2.4). Data, not display text; tests encode it. */
export const demoTape = {
  title: 'A tape from the other side',
  from: 'A ghost',
  to: 'You',
  date: '2026-10-31',
  tracks: ['Static Lullaby', 'Hiss and Hum'],
  letter: 'Tapes remember what we forget. This one kept a voice for you.',
} as const;

export const permission = {
  heading: 'Before we listen',
  explanation:
    'Ghost Tape uses your microphone only to hear the tape. Nothing is recorded or sent anywhere. The sound stays on this device.',
  confirm: 'Allow the microphone',
  dismiss: 'Not now',
} as const;

export const micErrors = {
  denied:
    'The microphone is blocked. Open your browser’s site settings, allow the microphone for this page, then try again.',
  noMicrophone: 'No microphone was found on this device.',
  insecureContext: 'The microphone only works on a secure page (https). This page is not secure.',
  unsupportedRate: 'This device’s audio rate is not supported.',
  fileInstead: 'You can upload an audio file instead.',
} as const;

export const darkroom = {
  heading: 'Darkroom',
  safelight: 'Safelight',
  notYetDeveloped: 'Not yet developed',
  waiting: 'Waiting for a ghost track',
  listening: 'Listening',
  passLabel: (n: number): string => `Pass ${n}`,
  countdownSeconds: (seconds: number): string => `About ${seconds} s left`,
  clarity: (percent: number): string => `Clarity ${percent}%`,
  partsRecovered: (recovered: number, total: number): string => `${recovered} of ${total} parts recovered`,
  playedTimes: (n: number): string => (n === 1 ? 'Played once' : `Played ${n} times`),
  previousPass: 'Previous pass',
  developing: 'Developing',
  developed: 'Developed',
} as const;

export const notices = {
  stillFaint: 'The ghost is still faint. Play it again to bring it closer.',
  headerInvalid: 'That sound was not a Ghost Tape',
  alignmentFailed: 'The sound slipped out of step. Hold the devices still and play it again.',
  signalLost: 'The sound faded before the end. Move closer and play it again.',
  alreadyReceived: 'You already have this tape',
  noGhostTrack: 'No ghost track found in that file',
  fileUnreadable: 'That file could not be read as audio',
  demoFileUnreadable: 'The demo file could not be read',
  noSignal: 'No sound heard yet. Move the devices closer together.',
  signalLostIndicator: 'Signal lost',
} as const;

export const actions = {
  playAgain: 'Play it again',
  decodeDemoFile: 'Decode the demo file instead',
  listen: 'Listen',
  upload: 'Upload an audio file',
  startOver: 'Start over',
  saveAsImage: 'Save as image',
  replyWithTape: 'Reply with a tape',
  tryAgain: 'Try again',
  skip: 'Skip',
  stop: 'Stop',
  close: 'Close',
} as const;

export const compose = {
  heading: 'Send a tape',
  title: 'Title',
  from: 'From',
  to: 'To',
  date: 'Date',
  track: (n: number): string => `Track ${n}`,
  letter: 'Letter',
  titlePlaceholder: 'A tape for you',
  fromPlaceholder: 'Your name',
  toPlaceholder: 'Their name',
  datePlaceholder: 'Year-month-day',
  letterPlaceholder: 'Write your letter here',
  addTrack: 'Add a track',
  removeTrack: (n: number): string => `Remove track ${n}`,
  counter: (n: number, max: number): string => `${n} of ${max}`,
  converted: (n: number): string => (n === 1 ? '1 character was changed to fit.' : `${n} characters were changed to fit.`),
  durationSeconds: (seconds: number): string => `About ${seconds} s of sound`,
  outOfDate: 'out of date',
  carrierLabel: 'How will it travel?',
  saveDraft: 'Keep a draft on this device',
  draftDeleted: 'The draft was deleted.',
  deleteDraft: 'Delete the draft',
} as const;

export const cassette = {
  label: 'Cassette',
  lengthLabel: (seconds: number): string => `${seconds} s of tape`,
} as const;

export const rec = {
  key: 'REC',
  recording: 'recording',
  done: 'done',
} as const;

export const validation = {
  newlineNotAllowed: 'Line breaks are only allowed in the letter.',
  unsupportedChar: (field: string): string => `${field} has a character that cannot be sent. Please replace it.`,
  unsupportedCharQuoted: (field: string, character: string, count: number): string =>
    count === 1
      ? `${field} has a character that cannot be sent: “${character}”. Please replace it.`
      : `${field} has ${count} characters that cannot be sent, starting with “${character}”. Please replace them.`,
  tooLong: (field: string, max: number, n: number): string => `${field} can have up to ${max} characters; this one has ${n}.`,
  ghostEmpty: 'A broadcast needs 1 to 140 characters.',
  trioEmpty: 'Add a title, or who it is from, or who it is to',
  dateBad: 'That is not a real date. Use year-month-day, between 2000 and 2255',
  tooManyTracks: 'A tape can have up to 10 tracks.',
  tooLongForCarrier: (excess: number, removeTracks?: number): string =>
    removeTracks === undefined
      ? `This tape is ${excess} characters too long. Shorten the letter.`
      : `This tape is ${excess} characters too long. Shorten the letter, or remove ${removeTracks} ${removeTracks === 1 ? 'track' : 'tracks'}.`,
  generic: 'Something in this field cannot be sent. Please check it.',
  recordFailed: 'The tape could not be recorded. Please try again.',
} as const;

export const send = {
  heading: 'Your tape is ready',
  linkLabel: 'Tape link',
  copyLink: 'Copy the link',
  linkCopied: 'Link copied',
  clipboardFailed: 'The link could not be copied. Select it and copy it by hand.',
  share: 'Share',
  download: 'Download the audio file',
  fileLength: (seconds: number): string => `${seconds} s long`,
  fileSize: (megabytes: number): string => `${megabytes} MB`,
  linkTooLong: 'This tape is too long for a link. Send it as an audio file instead.',
  broadcastHandoff: 'Broadcast this message instead',
  onlyBeginningFits: 'Only the beginning of this message fits.',
  scanToOpen: 'Scan to open the tape player',
} as const;

export const player = {
  heading: 'Tape player',
  closedEnvelope: 'A tape is waiting for you.',
  play: 'Play the tape',
  openHere: 'Open it here',
  damagedLink: 'This link is damaged. Ask the sender for a new one.',
  couldNotPrepare: 'The tape could not be prepared for playing.',
  openElsewhere: 'Open this on another device to listen',
} as const;

export const broadcast = {
  heading: 'Broadcast a ghost',
  messageLabel: 'Message',
  messagePlaceholder: 'A short message for everyone nearby',
  counter: (n: number, max: number): string => `${n} of ${max}`,
  onAir: 'ON AIR',
  stop: 'Stop',
  passCount: (n: number): string => (n === 1 ? 'Played once' : `Played ${n} times`),
  changeAtNextPass: 'Your change will start at the next pass.',
  wakeLockHint: 'Keep this screen open while broadcasting.',
  playbackFailed: 'The broadcast could not play. Please try again.',
  examplesHeading: 'Try an example',
  exampleLoadFailed: 'That example could not be loaded.',
} as const;

/** The three Side B examples (R29). Labels are the button text; texts are what gets encoded. */
export const examples = {
  partySecret: { label: 'party secret', text: 'Happy birthday — look under your pillow.' },
  exhibitionLabel: { label: 'exhibition label', text: 'Placeholder label: this piece listens back.' },
  publicNotice: { label: 'public notice', text: 'Shelter open at Sayles Hall. Water and blankets until 10 pm.' },
} as const;

export const print = {
  caption: 'Developed with Ghost Tape',
  footer: 'A letter hidden in sound.',
  continuation: 'continued',
} as const;

export const a11y = {
  safelightOff: 'Safelight off',
  safelightSteady: 'Safelight on',
  safelightPulsing: 'Safelight pulsing, a sound is arriving',
  safelightFixed: 'Safelight off, the letter is developed',
  signalDetected: 'A sound was detected.',
  passComplete: (pass: number, percent: number): string => `Pass ${pass} finished. Clarity ${percent} percent.`,
  developed: 'The letter is developed.',
  discarded: 'That pass was set aside.',
  broadcastStarted: 'Broadcast started.',
  broadcastStopped: 'Broadcast stopped.',
  passPlayed: (n: number): string => `Played ${n} ${n === 1 ? 'time' : 'times'}.`,
} as const;

export const errors = {
  generic: 'Something went wrong. Please try again.',
  recordFailed: 'The tape could not be recorded. Please try again.',
  imageFailed: 'The image could not be saved.',
  downloadFailed: 'The download could not start.',
} as const;
