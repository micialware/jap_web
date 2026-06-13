import './style.css';
import { initDB, closeDb, getDatabaseFile, replaceDatabaseFile } from './sqlite-manager.ts';
import { uploadDatabase, downloadDatabase } from './sync.ts';
import { getWordsForReview, getCardSets } from './db-manager.ts';
import type { CardSetRecord } from './db-manager.ts';
import type { Word } from './db-manager.ts';
import { SetOrderMode } from './algorithm.ts';

// ----- Конфигурация -----
const API_BASE_URL = 'https://learning.micialware.ru';

// ----- Элементы UI -----
const container = document.getElementById('page-container') as HTMLElement;
const navBtns = document.querySelectorAll<HTMLButtonElement>('.nav-btn');
let currentPage: 'words' | 'sets' = 'words';

// ----- Вспомогательные функции -----

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function setStatus(msg: string, isError = false) {
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.textContent = msg;
    statusEl.className = 'status-bar';
    if (isError) statusEl.classList.add('error');
    else statusEl.classList.add('success');
  }
  console.log(`[App] ${msg}`);
}

function getSyncId(): string {
  const input = document.getElementById('syncId') as HTMLInputElement | null;
  const id = input?.value.trim();
  if (!id) throw new Error('Введите ID синхронизации');
  return id;
}

// ----- Рендеринг страниц -----

function renderWordsPage() {
  container.innerHTML = `
    <div class="card">
      <h2 class="card-title">📡 Синхронизация</h2>
      <div class="sync-input-group">
        <input type="text" id="syncId" placeholder="Введите ID синхронизации" autocomplete="off" spellcheck="false" />
        <div class="sync-buttons">
          <button id="btnDownload" class="btn">📥 Скачать</button>
          <button id="btnUpload" class="btn btn-primary">📤 Загрузить</button>
        </div>
      </div>
    </div>

    <div class="card" style="flex: 1;">
      <h2 class="card-title">📚 Слова</h2>
      <ul id="word-list" class="word-list"></ul>
    </div>

    <div id="status" class="status-bar">Загрузка...</div>
  `;
}

function renderWordsList(words: Word[]) {
  const wordListEl = document.getElementById('word-list') as HTMLUListElement | null;
  if (!wordListEl) return;

  wordListEl.innerHTML = '';

  if (words.length === 0) {
    wordListEl.innerHTML = '<li class="word-item word-item-empty">Нет слов для повторения 🎉</li>';
    return;
  }

  for (const word of words) {
    const li = document.createElement('li');
    li.className = 'word-item';

    let reading = word.key;
    let translation = word.value;

    if (word.more) {
      try {
        const parsed = JSON.parse(word.more);
        reading = parsed.reading || word.key;
        translation = parsed.translation || word.value;
      } catch {
        // ignore
      }
    }

    li.innerHTML = `
      <span class="word-key">${reading}</span>
      <span class="word-value">${escapeHtml(translation)}</span>
      ${word.tags ? `<span class="word-tags">${escapeHtml(word.tags)}</span>` : ''}
    `;
    wordListEl.appendChild(li);
  }
}

function renderSetsPage() {
  container.innerHTML = `
    <div class="card" style="flex:1; display:flex; flex-direction:column; padding:0; overflow:hidden;">
      <div class="sets-layout" style="flex:1;">
        <ul id="sets-list" class="sets-list"></ul>
        <div id="sets-detail" class="sets-detail">
          <div class="placeholder-area">
            <div class="placeholder-icon">🗂️</div>
            <div>Выберите колоду</div>
          </div>
        </div>
      </div>
    </div>
    <div id="status" class="status-bar">Загрузка...</div>
  `;
}

function renderSetsList(sets: CardSetRecord[]) {
  const listEl = document.getElementById('sets-list') as HTMLUListElement | null;
  if (!listEl) return;

  listEl.innerHTML = '';

  if (sets.length === 0) {
    listEl.innerHTML = '<li style="opacity:0.5;text-align:center;padding:20px;">Нет колод</li>';
    return;
  }

  for (const set of sets) {
    const li = document.createElement('li');
    li.textContent = set.name;
    li.dataset.setId = String(set.id);
    li.addEventListener('click', () => showSetDetail(set, li));
    listEl.appendChild(li);
  }

  // Выделяем первую
  const first = listEl.querySelector('li') as HTMLLIElement | null;
  if (first) {
    first.classList.add('selected');
    const id = Number(first.dataset.setId);
    const set = sets.find(s => s.id === id);
    if (set) showSetDetail(set, first);
  }
}

function showSetDetail(set: CardSetRecord, listItem: HTMLLIElement) {
  // Обновляем выделение
  document.querySelectorAll('#sets-list li').forEach(el => el.classList.remove('selected'));
  listItem.classList.add('selected');

  const detailEl = document.getElementById('sets-detail');
  if (!detailEl) return;

  detailEl.innerHTML = `
    <h3>${escapeHtml(set.name)}</h3>
    <p><strong>Прямой порядок:</strong> ${escapeHtml(set.forward)}</p>
    <p><strong>Обратный порядок:</strong> ${escapeHtml(set.backward)}</p>
    <p><strong>Фильтр:</strong> ${escapeHtml(set.filter)}</p>

    <label style="font-size:0.8rem;color:var(--text);display:block;margin-top:12px;">Режим тренировки</label>
    <select id="mode-select" class="mode-select">
      <option value="${SetOrderMode.Default}">${SetOrderMode.Default} — взвешенная случайность</option>
      <option value="${SetOrderMode.TrainWorstFirst}">${SetOrderMode.TrainWorstFirst} — слабые слова</option>
      <option value="${SetOrderMode.FullRandom}">${SetOrderMode.FullRandom} — полная случайность</option>
    </select>

    <button class="btn btn-primary" data-set-id="${set.id}">▶ Начать тренировку</button>
  `;
}

// ----- Навигация -----

function switchPage(page: 'words' | 'sets') {
  currentPage = page;

  // Обновляем активную кнопку
  navBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  if (page === 'words') {
    renderWordsPage();
    loadWords();
  } else {
    renderSetsPage();
    loadSets();
  }
}

async function loadWords() {
  try {
    const words = await getWordsForReview();
    renderWordsList(words);
    const count = words.length;
    setStatus(`Слов: ${count}`);
  } catch (err) {
    setStatus('Ошибка загрузки слов', true);
    console.error(err);
  }
}

async function loadSets() {
  try {
    const sets = await getCardSets();
    renderSetsList(sets);
    setStatus(`Колод: ${sets.length}`);
  } catch (err) {
    setStatus('Ошибка загрузки колод', true);
    console.error(err);
  }
}

// ----- Обработчики синхронизации -----

async function onDownload() {
  try {
    const id = getSyncId();
    const btn = document.getElementById('btnDownload') as HTMLButtonElement | null;
    if (btn) btn.disabled = true;

    setStatus('Скачивание...');
    await downloadDatabase(id, API_BASE_URL, replaceDatabaseFile, initDB);

    if (currentPage === 'words') await loadWords();
    setStatus('База данных скачана.');
  } catch {
    // ошибка уже обработана в sync.ts
  } finally {
    const btn = document.getElementById('btnDownload') as HTMLButtonElement | null;
    if (btn) btn.disabled = false;
  }
}

async function onUpload() {
  try {
    const id = getSyncId();
    const btn = document.getElementById('btnUpload') as HTMLButtonElement | null;
    if (btn) btn.disabled = true;

    setStatus('Загрузка...');
    await uploadDatabase(id, API_BASE_URL, closeDb, getDatabaseFile);

    await initDB();
    if (currentPage === 'words') await loadWords();
    setStatus('База данных загружена.');
  } catch {
    // ошибка уже обработана в sync.ts
  } finally {
    const btn = document.getElementById('btnUpload') as HTMLButtonElement | null;
    if (btn) btn.disabled = false;
  }
}

// ----- Инициализация -----

async function main() {
  try {
    await initDB();
    console.log('[App] База данных инициализирована.');

    // Навигация
    navBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        switchPage(btn.dataset.page as 'words' | 'sets');
      });
    });

    // Стартовая страница
    switchPage('words');

    // Глобальные обработчики кликов (для кнопок на динамических страницах)
    container.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;
      if (target.id === 'btnDownload') await onDownload();
      if (target.id === 'btnUpload') await onUpload();
    });

  } catch (err) {
    console.error('[App] Ошибка инициализации:', err);
  }
}

main();