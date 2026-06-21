import { execute, executeVoid } from './sqlite-manager.ts';

export interface Word {
  id: number;
  key: string;
  value: string;
  tags: string;
  more: string | null;
  group_id: number;
}

export interface WordGroup {
  id: number;
  name: string;
}

export interface CardSetRecord {
  id: number;
  name: string;
  forward: string;
  backward: string;
  filter: string;
}

export interface CardStatRecord {
  id: number;
  word_id: number;
  set_id: number;
  score: number;
  last_opened: number;
}

export interface TagGroup {
  tag: string;
  words: Word[];
}

export interface GroupedWords {
  group: WordGroup;
  tags: TagGroup[];
}

/**
 * Парсит last_opened из SQLite.
 * SQLite может вернуть ISO-строку "2026-05-22 10:52:06.823259+00:00",
 * хотя в схеме поле INTEGER. Приводим к unix timestamp (секунды).
 */
function parseLastOpened(value: any): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const ts = Date.parse(value);
    if (!isNaN(ts)) return Math.floor(ts / 1000);
  }
  return Math.floor(Date.now() / 1000);
}

/**
 * Получает все колоды (card_set).
 */
export async function getCardSets(): Promise<CardSetRecord[]> {
  const rows: any[] = await execute(`
    SELECT id, name, forward, backward, filter
    FROM card_set
    ORDER BY id ASC
  `);

  return rows.map((row: any[]) => ({
    id: row[0],
    name: row[1],
    forward: row[2],
    backward: row[3],
    filter: row[4],
  })) as CardSetRecord[];
}

/**
 * Получает все слова для повторения.
 */
export async function getWordsForReview(): Promise<Word[]> {
  const rows: any[] = await execute(`
    SELECT id, key, value, tags, more, group_id
    FROM words
    ORDER BY id ASC
  `);

  return rows.map((row: any[]) => ({
    id: row[0],
    key: row[1],
    value: row[2],
    tags: row[3],
    more: row[4],
    group_id: row[5],
  })) as Word[];
}

/**
 * Получает слова и card_stats для указанной колоды.
 */
export async function getWordsAndStatsForSet(
  setId: number,
): Promise<{ words: Word[]; stats: CardStatRecord[] }> {
  const wordRows: any[] = await execute(
    `SELECT w.id, w.key, w.value, w.tags, w.more, w.group_id
     FROM words w
     INNER JOIN card_stats cs ON cs.word_id = w.id
     WHERE cs.set_id = ?
     ORDER BY w.id ASC`,
    [setId],
  );

  const statRows: any[] = await execute(
    `SELECT id, word_id, set_id, score, last_opened
     FROM card_stats
     WHERE set_id = ?
     ORDER BY word_id ASC`,
    [setId],
  );

  const words: Word[] = wordRows.map((r: any[]) => ({
    id: r[0],
    key: r[1],
    value: r[2],
    tags: r[3],
    more: r[4],
    group_id: r[5],
  }));

  const stats: CardStatRecord[] = statRows.map((r: any[]) => ({
    id: r[0],
    word_id: r[1],
    set_id: r[2],
    score: r[3],
    last_opened: parseLastOpened(r[4]),
  }));

  return { words, stats };
}

/**
 * Обновляет card_stats после ответа.
 */
export async function updateCardStat(
  statId: number,
  score: number,
  lastOpened: number,
): Promise<void> {
  const safeScore = Math.max(1, Math.round(score || 1));
  await executeVoid(
    `UPDATE card_stats SET score = ?, last_opened = ? WHERE id = ?`,
    [safeScore, lastOpened, statId],
  );
}

/**
 * Возвращает все группы (word_group).
 */
export async function getWordGroups(): Promise<WordGroup[]> {
  const rows: any[] = await execute(`
    SELECT id, name FROM word_group ORDER BY id ASC
  `);
  return rows.map((r: any[]) => ({ id: r[0], name: r[1] })) as WordGroup[];
}

/**
 * Группирует все слова по группам и тегам.
 * Если у слова несколько тегов (через пробел), оно попадает в каждую теговую группу.
 */
export async function getGroupedWords(): Promise<GroupedWords[]> {
  const groups = await getWordGroups();
  const words = await getWordsForReview();

  const result: GroupedWords[] = [];

  for (const group of groups) {
    const groupWords = words.filter((w) => w.group_id === group.id);

    // Собираем все уникальные теги в этой группе
    const tagMap = new Map<string, Word[]>();

    for (const word of groupWords) {
      if (!word.tags || word.tags.trim() === '') {
        // Слова без тегов — в группу "без тега"
        const tag = '(без тега)';
        if (!tagMap.has(tag)) tagMap.set(tag, []);
        tagMap.get(tag)!.push(word);
        continue;
      }

      const tags = word.tags.split(',').map((t) => t.trim()).filter(Boolean);
      for (const tag of tags) {
        if (!tagMap.has(tag)) tagMap.set(tag, []);
        tagMap.get(tag)!.push(word);
      }
    }

    const tagEntries: TagGroup[] = [];
    for (const [tag, tagWords] of tagMap) {
      tagEntries.push({ tag, words: tagWords });
    }
    // Сортируем теги: сначала с наибольшим количеством слов
    tagEntries.sort((a, b) => b.words.length - a.words.length);

    result.push({ group, tags: tagEntries });
  }

  return result;
}
