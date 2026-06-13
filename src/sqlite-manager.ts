import DbWorker from './db-worker.ts?worker';

// ----- Прокси к Worker -----

let worker: Worker | null = null;
let initPromise: Promise<void> | null = null;
let requestId = 0;

type WorkerRequest = {
  resolve: (data: any) => void;
  reject: (error: Error) => void;
};

const pending = new Map<number, WorkerRequest>();

function sendToWorker(type: string, payload?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!worker) {
      reject(new Error('Worker не создан'));
      return;
    }

    const id = ++requestId;
    pending.set(id, { resolve, reject });

    worker.postMessage({ type, id, ...payload });
  });
}

function initWorker(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = new Promise((resolve, reject) => {
    worker = new DbWorker();

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;

      if (msg.type === 'ready') {
        // Готов — запрос init уже обработан
        return;
      }

      if (msg.type === 'result') {
        const pendingReq = pending.get(msg.id);
        if (!pendingReq) return;
        pending.delete(msg.id);

        if (msg.ok) {
          pendingReq.resolve(msg.data);
        } else {
          console.log(msg);
          pendingReq.reject(new Error(msg.error || 'Неизвестная ошибка Worker'));
        }
      }
    };

    worker.onerror = (err) => {
      console.error('[SQLite Worker] Ошибка:', err);
      reject(new Error('Ошибка Worker'));
    };

    // Отправляем init
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    worker.postMessage({ type: 'init', id });
  });

  return initPromise;
}

// ----- Публичные функции -----

export async function initDB(): Promise<void> {
  await initWorker();
  console.log('[SQLite] База данных инициализирована.');
}

export async function execute(sql: string, params?: any[]): Promise<any[]> {
  const result = await sendToWorker('execute', { sql, params });
  return result;
}

export async function executeVoid(sql: string, params?: any[]): Promise<void> {
  await sendToWorker('executeVoid', { sql, params });
}

export async function getDatabaseFile(): Promise<ArrayBuffer> {
  const buffer = await sendToWorker('getFile');
  return buffer;
}

/**
 * Закрывает соединение с БД и освобождает блокировку файла OPFS.
 */
export async function closeDb(): Promise<void> {
  if (!worker) return;
  await sendToWorker('closeDb');
  worker.terminate();
  worker = null;
  initPromise = null;
}

export async function replaceDatabaseFile(arrayBuffer: ArrayBuffer): Promise<void> {
  // ArrayBuffer передаётся через transferable
  await sendToWorkerRaw('replaceFile', arrayBuffer);
}

async function sendToWorkerRaw(type: string, buffer: ArrayBuffer): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!worker) {
      reject(new Error('Worker не создан'));
      return;
    }

    const id = ++requestId;
    pending.set(id, { resolve, reject });

    worker.postMessage({ type, id, params: buffer }, [buffer]);
  });
}