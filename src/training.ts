import { CardSet } from './algorithm.ts';
import type { CardSetSettings, CardStatistics, WordData, WordOpenMode } from './algorithm.ts';
import { updateCardStat } from './db-manager.ts';

export interface WordItem {
  id: number;
  key: string;
  value: string;
  tags: string;
  more: Record<string, string>;
  group_id: number;
}

function getFieldValues(more: Record<string, string>, fields: string): string[] {
  return fields
    .split(/\s+/)
    .filter(Boolean)
    .map((f) => more[f] || f);
}

export interface TrainingCallbacks {
  onFinish: () => void;
}

export class TrainingPage {
  private container: HTMLElement;
  private cardSet: CardSet;
  private words: WordItem[];
  private callbacks: TrainingCallbacks;
  private totalCards: number;

  constructor(
    container: HTMLElement,
    settings: CardSetSettings,
    words: WordItem[],
    stats: CardStatistics[],
    callbacks: TrainingCallbacks,
  ) {
    this.container = container;
    this.callbacks = callbacks;
    this.totalCards = stats.length;

    const wordData: WordData[] = words.map((w) => ({
      id: w.id,
      key: w.key,
      value: w.value,
      tags: w.tags,
      additional: w.more as unknown as Record<string, string>,
      group_id: w.group_id,
    }));

    this.words = words;
    this.cardSet = new CardSet(settings, wordData, stats);
    this.render();
  }

  private render(): void {
    const current = this.cardSet.currentWordIndex;
    const total = this.totalCards;

    this.container.innerHTML = `
      <div class="training-header">
        <button id="btnTrainingBack" class="btn" style="flex:none; padding:0.4rem 0.8rem;">← Назад</button>
        <span style="font-size:0.85rem;color:var(--text);">${current !== null ? current + 1 : 0} / ${total}</span>
      </div>
      <div id="training-card" class="training-card">
        <div class="training-content" id="training-content">
        </div>
      </div>
      <div id="training-actions" class="training-actions">
      </div>
    `;

    this.renderCard();

    document.getElementById('btnTrainingBack')?.addEventListener('click', () => {
      this.callbacks.onFinish();
    });
  }

  private renderCard(): void {
    const result = this.cardSet.next();
    const word = this.words.find((w) => w.id === result.word.id);
    if (!word) return;

    const settings = (this.cardSet as any).settings as CardSetSettings | undefined;
    const forwardFields = settings?.forward || 'key';
    const backwardFields = settings?.backward || 'value';

    this.renderSide(word, forwardFields, backwardFields, false);
    this.renderActions(false);
  }

  private renderSide(
    word: WordItem,
    forwardFields: string,
    backwardFields: string,
    showBack: boolean,
  ): void {
    const more = word.more;

    const contentEl = document.getElementById('training-content');
    if (!contentEl) return;

    if (!showBack) {
      const values = getFieldValues(more, forwardFields);
      contentEl.innerHTML = values
        .map((v) => `<div class="training-field">${this.escapeHtml(v)}</div>`)
        .join('');
    } else {
      const fwdVals = getFieldValues(more, forwardFields);
      const bwdVals = getFieldValues(more, backwardFields);

      contentEl.innerHTML = `
        <div class="training-side">
          ${fwdVals.map((v) => `<div class="training-field">${this.escapeHtml(v)}</div>`).join('')}
        </div>
        <div class="training-divider"></div>
        <div class="training-side training-side-back">
          ${bwdVals.map((v) => `<div class="training-field">${this.escapeHtml(v)}</div>`).join('')}
        </div>
      `;
    }
  }

  private renderActions(showReveal: boolean): void {
    const actionsEl = document.getElementById('training-actions');
    if (!actionsEl) return;

    if (!showReveal) {
      actionsEl.innerHTML = `
        <button id="btnReveal" class="btn btn-primary" style="flex:none; width:100%;">Показать перевод</button>
      `;
      document.getElementById('btnReveal')?.addEventListener('click', () => this.reveal());
    } else {
      actionsEl.innerHTML = `
        <div class="training-vote">
          <button class="btn vote-btn vote-easy" data-mode="easy">🟢 Легко</button>
          <button class="btn vote-btn vote-ok" data-mode="ok">🟡 Нормально</button>
          <button class="btn vote-btn vote-hard" data-mode="hard">🟠 Тяжело</button>
          <button class="btn vote-btn vote-none" data-mode="none">🔴 Не знаю</button>
        </div>
      `;
      actionsEl.querySelectorAll('.vote-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const mode = (btn as HTMLElement).dataset.mode as WordOpenMode;
          this.vote(mode);
        });
      });
    }
  }

  private reveal(): void {
    const current = this.cardSet.currentWordIndex;
    if (current === null) return;

    const word = this.words[current];
    if (!word) return;

    const settings = (this.cardSet as any).settings as CardSetSettings | undefined;
    const forwardFields = settings?.forward || 'key';
    const backwardFields = settings?.backward || 'value';

    this.renderSide(word, forwardFields, backwardFields, true);
    this.renderActions(true);
  }

  private async vote(mode: WordOpenMode): Promise<void> {
    this.cardSet.open(mode);

    const current = this.cardSet.currentWordIndex;
    if (current === null) return;
    const stat = this.cardSet.set[current];

    try {
      await updateCardStat(stat.id, stat.score, Math.floor(stat.last_open / 1000));
    } catch (err) {
      console.error('[Training] Ошибка сохранения:', err);
    }

    if (current < this.totalCards - 1) {
      this.renderCard();
    } else {
      this.finish();
    }
  }

  private finish(): void {
    this.container.innerHTML = `
      <div class="training-header">
        <button id="btnTrainingFinish" class="btn" style="flex:none; padding:0.4rem 0.8rem;">← Назад</button>
      </div>
      <div class="training-card" style="display:flex;align-items:center;justify-content:center;">
        <div style="text-align:center;">
          <div style="font-size:3rem;margin-bottom:1rem;">🎉</div>
          <h2 style="margin:0;color:var(--text-h);">Тренировка завершена!</h2>
          <p style="color:var(--text);">Все ${this.totalCards} карточек пройдены.</p>
        </div>
      </div>
      <div class="training-actions"></div>
    `;

    document.getElementById('btnTrainingFinish')?.addEventListener('click', () => {
      this.callbacks.onFinish();
    });
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}