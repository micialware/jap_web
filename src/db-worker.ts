/**
 * Web Worker для работы с wa-sqlite + OPFS.
 * Воркер необходим, так как createSyncAccessHandle() доступен только в Worker'ах.
 */

import { Factory } from 'wa-sqlite/src/sqlite-api.js';
import { OriginPrivateFileSystemVFS } from 'wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js';
import ModuleConstructor from 'wa-sqlite/dist/wa-sqlite-async.mjs';

let sqlite: any = null;
let db: number | null = null;
let vfs: any = null;
let initialized = false;

const DB_FILENAME = '/japanese_app.db';
const SQLITE_OPEN_CREATE = 0x0004;
const SQLITE_OPEN_READWRITE = 0x0002;
const OPEN_FLAGS = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE;

async function init() {
  if (initialized) return;

  const module = await ModuleConstructor();
  const api = Factory(module);
  sqlite = api;

  const opfsVfs = new OriginPrivateFileSystemVFS();

  vfs = opfsVfs;
  const rc = api.vfs_register(opfsVfs, true);
  if (rc) {
    throw new Error(`Не удалось зарегистрировать OPFS VFS, код ${rc}`);
  }

  const handle = await api.open_v2(DB_FILENAME, OPEN_FLAGS);
  db = handle;

  initialized = true;
  self.postMessage({ type: 'ready', ok: true });

}

async function execSchema() {
  if (!sqlite || db === null) return;

  const schema = `
create table if not exists card_set
(
    id       INTEGER primary key autoincrement,
    name     TEXT not null,
    forward  TEXT not null,
    backward TEXT not null,
    filter   TEXT not null
);

create table if not exists settings
(
    id    text primary key,
    value text
);

create table if not exists word_group
(
    id   INTEGER primary key autoincrement,
    name TEXT not null
);

create table if not exists words
(
    id       INTEGER primary key autoincrement,
    key      TEXT not null,
    value    TEXT not null,
    tags     TEXT not null,
    more     TEXT,
    group_id integer default 1 not null
        constraint words_word_group_id_fk references word_group on update cascade on delete cascade
);

create table if not exists card_stats
(
    id          INTEGER primary key autoincrement,
    word_id     INTEGER not null references words on delete cascade,
    set_id      TEXT    not null references card_set on delete cascade,
    score       INTEGER default 1 not null,
    last_opened integer not null
);
`;

  const statements = schema
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    await sqlite.exec(db!, stmt + ';');
  }
}

self.onmessage = async (e: MessageEvent) => {
  const { type, id, sql, params } = e.data;

  try {
    switch (type) {
      case 'init': {
        await init();
        await execSchema();
        self.postMessage({ type: 'result', id, ok: true, data: null });
        break;
      }

      case 'execute': {
        if (!sqlite || db === null) throw new Error('БД не инициализирована');
        const result = await sqlite.execWithParams(db, sql, params);
        self.postMessage({ type: 'result', id, ok: true, data: result.rows });
        break;
      }

      case 'executeVoid': {
        if (!sqlite || db === null) throw new Error('БД не инициализирована');
        await sqlite.run(db, sql, params);
        self.postMessage({ type: 'result', id, ok: true, data: null });
        break;
      }

      case 'closeDb': {
        if (sqlite && db !== null) {
          await sqlite.close(db);
          db = null;
        }
        if (vfs) {
          await vfs.close();
          vfs = null;
        }
        initialized = false;
        self.postMessage({ type: 'result', id, ok: true, data: null });
        break;
      }

      case 'getFile': {
        // Получаем файл из OPFS
        const root = await navigator.storage.getDirectory();
        const fileHandle = await root.getFileHandle('japanese_app.db');
        const file = await fileHandle.getFile();
        const buffer = await file.arrayBuffer();
        // Передаём ArrayBuffer как Transferable
        self.postMessage(
          { type: 'result', id, ok: true, data: buffer },
          { transfer: [buffer] },
        );
        break;
      }

      case 'replaceFile': {
        // Закрываем текущее соединение
        if (sqlite && db !== null) {
          await sqlite.close(db);
          db = null;
        }
        if (vfs) {
          await vfs.close();
          vfs = null;
        }
        initialized = false;

        // Перезаписываем файл в OPFS
        const root = await navigator.storage.getDirectory();
        const fileHandle = await root.getFileHandle('japanese_app.db', { create: true });
        const accessHandle = await (fileHandle as any).createSyncAccessHandle();
        try {
          const data = new Uint8Array(params);
          accessHandle.truncate(0);
          accessHandle.write(data, { at: 0 });
          accessHandle.flush();
        } finally {
          accessHandle.close();
        }

        // Переинициализируем
        await init();
        self.postMessage({ type: 'result', id, ok: true, data: null });
        break;
      }

      default:
        throw new Error(`Неизвестный тип сообщения: ${type}`);
    }
  } catch (err: any) {
    self.postMessage({ type: 'result', id, ok: false, error: err.message });
  }
};