export type PrepareTtsResult = {
  displayText: string;
  speechText: string;
};

export type HumanizeOptions = {
  isGreeting?: boolean;
  skipOpener?: boolean;
  skipHumanize?: boolean;
  alreadyPrepared?: boolean;
};

const TRAILING_PAUSE_MARKS = /[\s,;:-]+$/;

const SOFT_FILLER_RE =
  /^(mm+|hmm+|hm+|yeah|hey|okay|alright|you know|i mean|well)[,.…\s]+/i;

const SCRIPTED_MARKUP_RE =
  /\[(?:soft\s+breath|breath|inhale|exhale|sigh|pause)\]|\((?:soft\s+breath|breath|inhale|exhale|sigh|pause)\)|\*(?:soft\s+breath|breath|inhale|exhale