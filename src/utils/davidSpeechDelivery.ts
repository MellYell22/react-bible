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
const SOFT_FILLER_RE = /^(mm+|hmm+|hm+|yeah|hey|okay|alright|you know|i mean|well)[,.\s]+/i;
const DECIMAL_PLACEHOLDER = '__DAVID_DECIMAL_POINT__';

