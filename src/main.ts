import './style.css';
import { initDB, closeDb, getDatabaseFile, replaceDatabaseFile } from './sqlite-manager.ts';
import { uploadDatabase, downloadDatabase } from './sync.ts';
import { getCardSets, getWordsAndStatsForSet, getGroupedWords } from './db-manager.ts';
import type { GroupedWords } from './db-manager.ts';
import type { CardSetRecord } from './db-manager.ts';
import { SetOrderMode } from './algorithm.ts';
import { TrainingPage } from './training.ts';
import type { WordItem } from './training.ts';

// ----- Конфигурация -----
const API_BASE_URL = 'https://learning.micialware.ru';
const SYNC_ID_STORAGE_KEY = 'japlearn_sync_id';

// ----- Элементы UI -----
const container = document.getElementById('page-container') as HTMLElement;
const navBtns = document.querySelectorAll<HTMLButtonElement>('.nav-btn');
let currentPage: 'words' | 'sets' | 'training' = 'words';

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
  localStorage.setItem(SYNC_ID_STORAGE_KEY, id);
  return id;
}

function restoreSyncId(): void {
  const saved = localStorage.getItem(SYNC_ID_STORAGE_KEY);
  if (saved) {
    const input = document.getElementById('syncId') as HTMLInputElement | null;
    if (input) input.value = saved;
  }
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
      <div id="word-groups"></div>
    </div>

    <div id="status" class="status-bar">Загрузка...</div>
  `;
}

function renderWordGroups(grouped: GroupedWords[]) {
  const containerEl = document.getElementById('word-groups');
  if (!containerEl) return;

  containerEl.innerHTML = '';

  if (grouped.length === 0) {
    containerEl.innerHTML = '<p style="text-align:center;opacity:0.6;padding:1rem;">Нет слов 🎉</p>';
    return;
  }

  // Табы групп
  const tabsContainer = document.createElement('div');
  tabsContainer.className = 'group-tabs';

  const panelsContainer = document.createElement('div');
  panelsContainer.className = 'group-panels';

  let activeIndex = 0;

  for (let i = 0; i < grouped.length; i++) {
    const entry = grouped[i];

    // Кнопка таба
    const tabBtn = document.createElement('button');
    tabBtn.className = 'group-tab' + (i === activeIndex ? ' active' : '');
    const totalWords = entry.tags.reduce((s, t) => s + t.words.length, 0);
    tabBtn.innerHTML = `${escapeHtml(entry.group.name)} <span class="group-tab-count">${totalWords}</span>`;

    // Панель с тегами
    const panel = document.createElement('div');
    panel.className = 'group-panel' + (i === activeIndex ? ' active' : '');

    for (const tagEntry of entry.tags) {
      const tagBlock = document.createElement('div');
      tagBlock.className = 'word-tag-block';

      const tagHeader = document.createElement('div');
      tagHeader.className = 'word-tag-header';
      tagHeader.innerHTML = `
        <span class="word-tag-label">#${escapeHtml(tagEntry.tag)}</span>
        <span class="word-tag-count">${tagEntry.words.length}</span>
      `;

      let tagCollapsed = true;
      const wordsContainer = document.createElement('div');
      wordsContainer.className = 'word-tag-words';
      wordsContainer.style.display = 'none';

      tagHeader.addEventListener('click', () => {
        tagCollapsed = !tagCollapsed;
        wordsContainer.style.display = tagCollapsed ? 'none' : '';
        tagHeader.classList.toggle('collapsed', tagCollapsed);
      });

      for (const word of tagEntry.words) {
        const wordEl = document.createElement('div');
        wordEl.className = 'word-item';

        let reading = word.key;
        let translation = word.value;
        if (word.more) {
          try {
            const parsed = JSON.parse(word.more);
            reading = parsed.reading || word.key;
            translation = parsed.translation || word.value;
          } catch { /* ignore */ }
        }

        wordEl.innerHTML = `
          <span class="word-key">${escapeHtml(reading)}</span>
          <span class="word-value">${escapeHtml(translation)}</span>
        `;
        wordsContainer.appendChild(wordEl);
      }

      tagBlock.appendChild(tagHeader);
      tagBlock.appendChild(wordsContainer);
      panel.appendChild(tagBlock);
    }

    tabBtn.addEventListener('click', () => {
      // Деактивируем все
      tabsContainer.querySelectorAll('.group-tab').forEach((b) => b.classList.remove('active'));
      panelsContainer.querySelectorAll('.group-panel').forEach((p) => p.classList.remove('active'));
      // Активируем текущие
      tabBtn.classList.add('active');
      panel.classList.add('active');
    });

    tabsContainer.appendChild(tabBtn);
    panelsContainer.appendChild(panel);
  }

  containerEl.appendChild(tabsContainer);
  containerEl.appendChild(panelsContainer);
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

  const first = listEl.querySelector('li') as HTMLLIElement | null;
  if (first) {
    first.classList.add('selected');
    const id = Number(first.dataset.setId);
    const set = sets.find(s => s.id === id);
    if (set) showSetDetail(set, first);
  }
}

function showSetDetail(set: CardSetRecord, listItem: HTMLLIElement) {
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

    <button class="btn btn-primary btn-start-training" data-set-id="${set.id}">▶ Начать тренировку</button>
  `;
}

// ----- Тренировка -----

async function startTraining(setId: number) {
  const modeSelect = document.getElementById('mode-select') as HTMLSelectElement | null;
  const mode = (modeSelect?.value as SetOrderMode) || SetOrderMode.Default;

  const sets = await getCardSets();
  const set = sets.find(s => s.id === setId);
  if (!set) {
    setStatus('Колода не найдена', true);
    return;
  }

  const { words, stats } = await getWordsAndStatsForSet(setId);
  if (words.length === 0) {
    setStatus('Нет слов для тренировки', true);
    return;
  }

  console.log(`[Training] Запуск тренировки: ${words.length} слов, ${stats.length} записей, режим: ${mode}`);

  const settings = {
    id: set.id,
    name: set.name,
    forward: set.forward,
    backward: set.backward,
    filter: set.filter,
    count: null,
    worst_words_list: null,
    open_mode: mode,
  };

  const wordItems: WordItem[] = words.map((w) => {
    let parsed: Record<string, string> = {};
    if (w.more) {
      try { parsed = JSON.parse(w.more); } catch { /* ignore */ }
    }
    return {
      id: w.id,
      key: w.key,
      value: w.value,
      tags: w.tags,
      more: parsed,
      group_id: w.group_id,
    };
  });

  const cardStats = stats.map((s) => ({
    id: s.id,
    word_id: s.word_id,
    set_id: s.set_id,
    last_open: s.last_opened * 1000,
    score: s.score,
  }));

  hideNav();
  currentPage = 'training';

  container.innerHTML = '<div id="training-root" style="flex:1;display:flex;flex-direction:column;"></div>';
  const trainingRoot = document.getElementById('training-root') as HTMLElement;

  new TrainingPage(
    trainingRoot,
    settings,
    wordItems,
    cardStats,
    {
      onFinish: () => {
        showNav();
        switchPage('sets');
      },
    },
  );
}

// ----- Навигация -----

function switchPage(page: 'words' | 'sets') {
  currentPage = page;
  showNav();

  navBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  if (page === 'words') {
    renderWordsPage();
    loadGroupedWords();
  } else {
    renderSetsPage();
    loadSets();
  }
}

function hideNav() {
  document.getElementById('app-nav')!.style.display = 'none';
}

function showNav() {
  document.getElementById('app-nav')!.style.display = 'flex';
}

async function loadGroupedWords() {
  try {
    const grouped = await getGroupedWords();
    renderWordGroups(grouped);

    const totalWords = grouped.reduce((s, g) => s + g.tags.reduce((s2, t) => s2 + t.words.length, 0), 0);
    setStatus(`Слов: ${totalWords}`);
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

    if (currentPage === 'words') await loadGroupedWords();
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
    if (currentPage === 'words') await loadGroupedWords();
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

    navBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (currentPage !== 'training') {
          switchPage(btn.dataset.page as 'words' | 'sets');
        }
      });
    });

    switchPage('words');
    restoreSyncId();

    container.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;
      if (target.id === 'btnDownload') await onDownload();
      if (target.id === 'btnUpload') await onUpload();

      const trainingBtn = target.closest('.btn-start-training');
      if (trainingBtn) {
        const setId = Number((trainingBtn as HTMLElement).dataset.setId);
        await startTraining(setId);
      }
    });

  } catch (err) {
    console.error('[App] Ошибка инициализации:', err);
  }
}

main();