import { init, compress, decompress } from '@bokuweb/zstd-wasm';

/**
 * Загружает (upload) базу данных на сервер.
 *
 * @param id - Идентификатор для синхронизации.
 * @param apiBaseUrl - Базовый URL API (без слеша на конце).
 * @param closeDb - Функция для закрытия соединения с БД.
 * @param getDbBuffer - Функция, возвращающая ArrayBuffer с бинарным файлом БД.
 */
export async function uploadDatabase(
  id: string,
  apiBaseUrl: string,
  closeDb: () => Promise<void>,
  getDbBuffer: () => Promise<ArrayBuffer>,
): Promise<void> {
  try {
    // 1. Закрываем соединение, чтобы снять блокировку файла OPFS
    await closeDb();

    // 2. Получаем бинарный файл БД
    const dbBuffer = await getDbBuffer();
    const plainBytes = new Uint8Array(dbBuffer);

    // 3. Сжимаем zstd
    await init();
    const compressed = compress(plainBytes);

    // 4. Создаём FormData и добавляем сжатый файл
    const formData = new FormData();
    const blob = new Blob([compressed.buffer as ArrayBuffer], { type: 'application/octet-stream' });
    formData.append('db', blob, 'database.sqlite.zst');

    // 5. POST-запрос
    const url = `${apiBaseUrl.replace(/\/+$/, '')}/upload/${encodeURIComponent(id)}`;
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Ошибка загрузки: сервер ответил ${response.status} ${response.statusText}`);
    }

    console.log('[Sync] База данных успешно загружена.');
  } catch (err) {
    console.error('[Sync] Ошибка загрузки:', err);
    alert(`Ошибка загрузки: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

/**
 * Скачивает (download) базу данных с сервера.
 *
 * @param id - Идентификатор для синхронизации.
 * @param apiBaseUrl - Базовый URL API (без слеша на конце).
 * @param replaceDbBuffer - Функция, перезаписывающая файл БД новым ArrayBuffer.
 * @param initDb - Функция для повторной инициализации соединения с БД.
 */
export async function downloadDatabase(
  id: string,
  apiBaseUrl: string,
  replaceDbBuffer: (buffer: ArrayBuffer) => Promise<void>,
  initDb: () => Promise<void>,
): Promise<void> {
  try {
    // 1. GET-запрос
    const url = `${apiBaseUrl.replace(/\/+$/, '')}/download/${encodeURIComponent(id)}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Ошибка скачивания: сервер ответил ${response.status} ${response.statusText}`);
    }

    // 2. Получаем сжатые данные
    const compressedBuffer = await response.arrayBuffer();
    const compressedBytes = new Uint8Array(compressedBuffer);

    // 3. Распаковываем zstd
    await init();
    const decompressedBytes = decompress(compressedBytes);

    // 4. Перезаписываем файл в OPFS
    await replaceDbBuffer(decompressedBytes.buffer as ArrayBuffer);

    // 5. Переинициализируем соединение с БД
    await initDb();

    console.log('[Sync] База данных успешно скачана и применена.');
  } catch (err) {
    console.error('[Sync] Ошибка скачивания:', err);
    alert(`Ошибка скачивания: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}