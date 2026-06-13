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

/**
 * Извлекает значения полей из слова.
 * Сначала ищет в основных полях (key, value, tags),
 * потом в more (JSON-словарь).
 * Если поле не найдено — пропускается (возвращается пустая строка, фильтруется).
 */
function getWordFieldValues(word: WordItem, fields: string): string[] {
  const directFields: Record<string, string> = {
    key: word.key,
    value: word.value,
    tags: word.tags,
  };

  return fields
    .split(/\s+/)
    .filter(Boolean)
    .map((f) => {
      if (f in directFields && directFields[f]) return directFields[f];
      if (f in word.more && word.more[f]) return word.more[f];
      return '';
    })
    .filter(Boolean);
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
  private forwardFields: string;
  private backwardFields: string;

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
    this.forwardFields = settings.forward || 'key';
    this.backwardFields = settings.backward || 'value';

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
    const total = this.totalCards;

    this.container.innerHTML = `
      <div class="training-header">
        <button id="btnTrainingBack" class="btn" style="flex:none; padding:0.4rem 0.8rem;">← Назад</button>
        <span style="font-size:0.85rem;color:var(--text);">слов: ${total}</span>
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

    this.renderSide(word, this.forwardFields, this.backwardFields, false);
    this.renderActions(false);
  }

  private renderSide(
    word: WordItem,
    forwardFields: string,
    backwardFields: string,
    showBack: boolean,
  ): void {
    const contentEl = document.getElementById('training-content');
    if (!contentEl) return;

    if (!showBack) {
      const values = getWordFieldValues(word, forwardFields);
      if (values.length === 0) {
        contentEl.innerHTML = '<div class="training-field" style="opacity:0.4;">Нет данных для отображения</div>';
        return;
      }
      contentEl.innerHTML = values
        .map((v) => `<div class="training-field">${this.escapeHtml(v)}</div>`)
        .join('');
    } else {
      const fwdVals = getWordFieldValues(word, forwardFields);
      const bwdVals = getWordFieldValues(word, backwardFields);

      contentEl.innerHTML = `
        <div class="training-side">
          ${fwdVals.length > 0
            ? fwdVals.map((v) => `<div class="training-field">${this.escapeHtml(v)}</div>`).join('')
            : '<div class="training-field" style="opacity:0.4;">—</div>'}
        </div>
        <div class="training-divider"></div>
        <div class="training-side training-side-back">
          ${bwdVals.length > 0
            ? bwdVals.map((v) => `<div class="training-field">${this.escapeHtml(v)}</div>`).join('')
            : '<div class="training-field" style="opacity:0.4;">—</div>'}
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

    this.renderSide(word, this.forwardFields, this.backwardFields, true);
    this.renderActions(true);
  }

  private async vote(mode: WordOpenMode): Promise<void> {
    this.cardSet.open(mode);

    const current = this.cardSet.currentWordIndex;
    if (current === null) return;
    const stat = this.cardSet.set[current];

    if (stat) {
      try {
        await updateCardStat(stat.id, stat.score, Math.floor(stat.last_open / 1000));
      } catch (err) {
        console.error('[Training] Ошибка сохранения:', err);
      }
    }

    // Бесконечная тренировка — всегда переходим к следующей карте
    this.renderCard();
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}