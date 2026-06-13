import { execute } from './sqlite-manager.ts';

export interface Word {
  id: number;
  key: string;
  value: string;
  tags: string;
  more: string | null;
  group_id: number;
}

export interface CardSetRecord {
  id: number;
  name: string;
  forward: string;
  backward: string;
  filter: string;
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
