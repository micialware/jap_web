// ──── Constants ────
const MAX_HISTORY_LEN = 20;
const MAX_HISTORY_LEN_PART = 0.33;
const MAX_SCORE = 25;
const FADE_PER_DAY = 0.95;

// ──── Data types ────

export interface WordData {
  id: number;
  key: string;
  value: string;
  tags: string;
  additional: Record<string, string>;
  group_id: number;
}

export interface WordGroup {
  id: number;
  name: string;
}

export interface CardStatistics {
  id: number;
  word_id: number;
  set_id: number;
  last_open: number; // unix timestamp ms
  score: number;
}

export type WordOpenMode = 'easy' | 'ok' | 'hard' | 'none';

export const SetOrderMode = {
  Default: 'Default',
  TrainWorstFirst: 'TrainWorstFirst',
  FullRandom: 'FullRandom',
} as const;

export type SetOrderMode = (typeof SetOrderMode)[keyof typeof SetOrderMode];

export interface CardSetSettings {
  id: number;
  name: string;
  forward: string;
  backward: string;
  filter: string;
  count: number | null;
  worst_words_list: WordData[] | null;
  open_mode: SetOrderMode;
}

// ──── CardStatistics helpers ────

export function calculatedScore(stat: CardStatistics): number {
  const now = Date.now();
  const diffMs = now - stat.last_open;
  const days = diffMs / (1000 * 60 * 60 * 24);
  const multiplier = Math.pow(FADE_PER_DAY, Math.max(0, days));
  return stat.score * multiplier;
}

export function updateStatScore(stat: CardStatistics, status: WordOpenMode): void {
  const cs = calculatedScore(stat);
  switch (status) {
    case 'easy':
      stat.score = Math.round(cs + 5);
      break;
    case 'ok':
      stat.score = Math.round(cs + 2);
      break;
    case 'hard':
      stat.score = Math.round(cs - 1);
      break;
    case 'none':
      stat.score = Math.round(cs * 0.5);
      break;
  }

  if (stat.score < 1) stat.score = 1;
  else if (stat.score > MAX_SCORE) stat.score = MAX_SCORE;

  stat.last_open = Date.now();
}

// ──── WeightedIndex (simple O(n) implementation) ────

class WeightedIndex {
  private weights: number[];

  constructor(weights: number[]) {
    this.weights = [...weights];
  }

  sample(): number {
    const total = this.weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < this.weights.length; i++) {
      r -= this.weights[i];
      if (r <= 0) return i;
    }
    return this.weights.length - 1;
  }

  updateWeight(index: number, weight: number): void {
    this.weights[index] = weight;
  }
}

// ──── SRSModule interface ────

interface SRSModule {
  next(set: { words: WordData[]; set: CardStatistics[] }): number;
  open(status: WordOpenMode, index: number, updatedWord: CardStatistics): void;
  init(set: { words: WordData[]; set: CardStatistics[] }): void;
}

// ──── RandomSRSModule ────

class RandomSRSModule implements SRSModule {
  private backet: number[] = [];
  private initialized = false;

  next(set: { words: WordData[]; set: CardStatistics[] }): number {
    if (this.backet.length === 0) {
      this.backet = Array.from({ length: set.words.length }, (_, i) => i);
      this.shuffle(this.backet);
    }
    return this.backet.pop()!;
  }

  open(_status: WordOpenMode, _index: number, _updatedWord: CardStatistics): void {
    // no-op
  }

  init(set: { words: WordData[]; set: CardStatistics[] }): void {
    this.initialized = true;
    this.backet = Array.from({ length: set.words.length }, (_, i) => i);
    this.shuffle(this.backet);
  }

  private shuffle(arr: number[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
}

// ──── SemiRandomSRSModule ────

class SemiRandomSRSModule implements SRSModule {
  private history: number[] = [];
  private lastWeights!: WeightedIndex;
  private initialized = false;

  next(set: { words: WordData[]; set: CardStatistics[] }): number {
    const index = this.lastWeights.sample();

    if (this.history.includes(index)) {
      return this.next(set);
    }

    if (this.history.length >= this.historyLen(set.set.length)) {
      this.history.shift();
    }
    this.history.push(index);

    return index;
  }

  open(_status: WordOpenMode, index: number, word: CardStatistics): void {
    const newWeight = Math.pow(100.0 / Math.max(0.1, calculatedScore(word)), 2.0);
    this.lastWeights.updateWeight(index, newWeight);
  }

  init(set: { words: WordData[]; set: CardStatistics[] }): void {
    this.initialized = true;
    const weights = set.set.map(
      (s) => Math.pow(100.0 / Math.max(0.1, calculatedScore(s)), 2.0) * 2.0,
    );
    this.lastWeights = new WeightedIndex(weights);
  }

  private historyLen(setLen: number): number {
    return Math.min(MAX_HISTORY_LEN, Math.floor(setLen * MAX_HISTORY_LEN_PART));
  }
}

// ──── WorstWordsSRSModule (stub) ────

class WorstWordsSRSModule implements SRSModule {
  private initialized = false;

  next(_set: { words: WordData[]; set: CardStatistics[] }): number {
    throw new Error('Not implemented');
  }

  open(_status: WordOpenMode, _index: number, _updatedWord: CardStatistics): void {
    throw new Error('Not implemented');
  }

  init(_set: { words: WordData[]; set: CardStatistics[] }): void {
    throw new Error('Not implemented');
  }
}

// ──── OrderModule ────

type OrderModule =
  | { type: 'SemiRandomSRS'; module: SemiRandomSRSModule }
  | { type: 'RandomSRS'; module: RandomSRSModule }
  | { type: 'WorstWordsSRS'; module: WorstWordsSRSModule };

// ──── CardSet ────

export class CardSet {
  words: WordData[];
  set: CardStatistics[];
  currentWordIndex: number | null = null;
  private orderModule: OrderModule;

  constructor(settings: CardSetSettings, words: WordData[], stats: CardStatistics[]) {
    this.words = words;
    this.set = stats;

    const openMode = settings.open_mode;

    this.orderModule =
      openMode === SetOrderMode.FullRandom
        ? { type: 'RandomSRS', module: new RandomSRSModule() }
        : openMode === SetOrderMode.TrainWorstFirst
          ? { type: 'WorstWordsSRS', module: new WorstWordsSRSModule() }
          : { type: 'SemiRandomSRS', module: new SemiRandomSRSModule() };
  }

  private getOrderContext() {
    return { words: this.words, set: this.set };
  }

  next(): { word: WordData; stat: CardStatistics } {
    const ctx = this.getOrderContext();

    let index: number;
    const mod = this.orderModule;

    switch (mod.type) {
      case 'SemiRandomSRS': {
        if (!mod.module['initialized']) {
          mod.module.init(ctx);
        }
        index = mod.module.next(ctx);
        break;
      }
      case 'RandomSRS': {
        if (!mod.module['initialized']) {
          mod.module.init(ctx);
        }
        index = mod.module.next(ctx);
        break;
      }
      case 'WorstWordsSRS': {
        if (!mod.module['initialized']) {
          mod.module.init(ctx);
        }
        index = mod.module.next(ctx);
        break;
      }
    }

    this.currentWordIndex = index;
    return { word: this.words[index], stat: this.set[index] };
  }

  open(status: WordOpenMode): void {
    if (this.currentWordIndex === null) return;
    const index = this.currentWordIndex;

    const word = this.set[index];
    updateStatScore(word, status);

    const mod = this.orderModule;
    switch (mod.type) {
      case 'SemiRandomSRS':
        mod.module.open(status, index, word);
        break;
      case 'RandomSRS':
        mod.module.open(status, index, word);
        break;
      case 'WorstWordsSRS':
        mod.module.open(status, index, word);
        break;
    }
  }

  get length(): number {
    return this.set.length;
  }
}

// ──── Factory helper ────

export function createCardSet(
  settings: CardSetSettings,
  words: WordData[],
  stats: CardStatistics[],
): CardSet {
  return new CardSet(settings, words, stats);
}