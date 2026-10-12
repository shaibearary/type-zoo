import {
  OUTBOX_DOMAIN,
  STORAGE_DOMAIN,
  THEME_DOMAIN,
  UPLOAD_DOMAIN,
  outbox,
  storage,
  themeGet,
  themeOnChanged,
  type Subscription,
  type Theme,
} from '@napplet/sdk';
import { cardAltText, installCardArtwork, renderCardImage } from './card-render.js';
import { buildImetaTag, uploadCardImage } from './card-upload.js';
import { runtimeHasDomain } from './domain-availability.js';
import { CARD_FORMATS, getCardFormat, type FormatId } from './formats.js';
import { createPublicationTracker } from './publish-session.js';
import './styles.css';

type Draft = { title: string; body: string; date: string; formatId: FormatId };
type SavedCard = Draft & { id: string; createdAt: number; updatedAt: number };
type ViewName = 'home' | 'editor' | 'boxes';

const STORAGE_KEYS = { draft: 'type-zoo.draft.v3', cards: 'type-zoo.cards.v3' } as const;
const PUBLISH_FALLBACK_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol'] as const;
const elements = {
  app: requireElement<HTMLElement>('#app'),
  homeView: requireElement<HTMLElement>('#homeView'),
  editorView: requireElement<HTMLElement>('#editorView'),
  boxesView: requireElement<HTMLElement>('#boxesView'),
  calendarStrip: requireElement<HTMLElement>('#calendarStrip'),
  timeline: requireElement<HTMLElement>('#timeline'),
  emptyHome: requireElement<HTMLElement>('#emptyHome'),
  composeButton: requireElement<HTMLButtonElement>('#composeButton'),
  menuButton: requireElement<HTMLButtonElement>('#menuButton'),
  boxesButton: requireElement<HTMLButtonElement>('#boxesButton'),
  backButton: requireElement<HTMLButtonElement>('#backButton'),
  boxesBackButton: requireElement<HTMLButtonElement>('#boxesBackButton'),
  publishButton: requireElement<HTMLButtonElement>('#publishButton'),
  saveButton: requireElement<HTMLButtonElement>('#saveButton'),
  cardCanvas: requireElement<HTMLElement>('#cardCanvas'),
  formatIcon: requireElement<HTMLElement>('#formatIcon'),
  formatName: requireElement<HTMLElement>('#formatName'),
  titleInput: requireElement<HTMLInputElement>('#titleInput'),
  bodyInput: requireElement<HTMLTextAreaElement>('#bodyInput'),
  dateInput: requireElement<HTMLInputElement>('#dateInput'),
  characterCount: requireElement<HTMLElement>('#characterCount'),
  formatShelf: requireElement<HTMLElement>('#formatShelf'),
  status: requireElement<HTMLOutputElement>('#status'),
  searchInput: requireElement<HTMLInputElement>('#searchInput'),
  boxesGrid: requireElement<HTMLElement>('#boxesGrid'),
  emptyBoxes: requireElement<HTMLElement>('#emptyBoxes'),
  duplicatePostDialog: requireElement<HTMLDialogElement>('#duplicatePostDialog'),
};

let draft = blankDraft();
let savedCards: SavedCard[] = [];
let selectedDate = dateKey(new Date());
let activeCardId: string | null = null;
let lastSavedFingerprint: string | null = null;
let draftTimer = 0;
let toastTimer = 0;
let themeSubscription: Subscription | null = null;
let isPublishing = false;
const publicationTracker = createPublicationTracker();

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function blankDraft(): Draft {
  return { title: '', body: '', date: dateKey(new Date()), formatId: 'pip-caller' };
}

function fingerprint(value: Draft): string {
  return JSON.stringify([value.title.trim(), value.body.trim(), value.date, value.formatId]);
}

function showToast(message: string, tone: 'ok' | 'error' = 'ok'): void {
  window.clearTimeout(toastTimer);
  elements.status.textContent = message;
  elements.status.dataset.tone = tone;
  elements.status.classList.add('is-visible');
  toastTimer = window.setTimeout(() => elements.status.classList.remove('is-visible'), 1800);
}

/** Hold a step message up for as long as the step runs; the next toast clears it. */
function showProgress(message: string): void {
  window.clearTimeout(toastTimer);
  elements.status.textContent = message;
  elements.status.dataset.tone = 'ok';
  elements.status.classList.add('is-visible');
}

function switchView(view: ViewName): void {
  elements.homeView.hidden = view !== 'home';
  elements.editorView.hidden = view !== 'editor';
  elements.boxesView.hidden = view !== 'boxes';
  if (view === 'home') renderHome();
  if (view === 'boxes') renderBoxes();
}

function renderCalendar(): void {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - 3);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
  elements.calendarStrip.replaceChildren(...days.map((date) => {
    const key = dateKey(date);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `calendar-day${key === selectedDate ? ' is-active' : ''}`;
    const hasNotes = savedCards.some((card) => card.date === key);
    button.innerHTML = `<small>${date.toLocaleDateString('en', { weekday: 'short' })}</small><strong>${date.getDate()}</strong><span>${hasNotes ? '•' : '+'}</span>`;
    button.addEventListener('click', () => { selectedDate = key; renderHome(); });
    return button;
  }));
}

function renderHome(): void {
  renderCalendar();
  const cards = savedCards.filter((card) => card.date === selectedDate).sort((a, b) => b.updatedAt - a.updatedAt);
  elements.timeline.replaceChildren(...cards.map((card) => createTimelineCard(card)));
  elements.emptyHome.hidden = cards.length > 0;
}

function createTimelineCard(card: SavedCard): HTMLElement {
  const format = getCardFormat(card.formatId);
  const row = document.createElement('article');
  row.className = 'timeline-entry';
  const time = new Date(card.updatedAt).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
  row.innerHTML = `<div class="timeline-time"><strong>${card.date.slice(5).replace('-', '/')}</strong><span>${time}</span></div><button type="button" class="timeline-card ${format.className}"><span class="mini-icon">${format.icon}</span><strong>${escapeHtml(card.title)}</strong><p>${escapeHtml(card.body)}</p></button>`;
  row.querySelector('button')?.addEventListener('click', () => openCard(card));
  return row;
}

function renderFormatShelf(): void {
  elements.formatShelf.replaceChildren(...CARD_FORMATS.map((format) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `format-choice${draft.formatId === format.id ? ' is-active' : ''}`;
    button.setAttribute('aria-pressed', String(draft.formatId === format.id));
    button.innerHTML = `<span>${format.icon}</span><small>${format.name}</small>`;
    button.addEventListener('click', () => {
      draft.formatId = format.id;
      applyDraft();
      renderFormatShelf();
      queueDraftSave();
    });
    return button;
  }));
}

function applyDraft(): void {
  const format = getCardFormat(draft.formatId);
  elements.titleInput.value = draft.title;
  elements.bodyInput.value = draft.body;
  elements.dateInput.value = draft.date;
  elements.cardCanvas.className = `card-canvas ${format.className}`;
  elements.formatIcon.textContent = format.icon;
  elements.formatName.textContent = format.name;
  elements.characterCount.textContent = String(draft.body.length);
  // Posting now needs both rails: the shell uploads the card image, then
  // publishes the note that points at it.
  elements.publishButton.hidden = !runtimeHasDomain(OUTBOX_DOMAIN) || !runtimeHasDomain(UPLOAD_DOMAIN);
}

function syncDraft(): void {
  draft.title = elements.titleInput.value;
  draft.body = elements.bodyInput.value;
  draft.date = elements.dateInput.value;
  elements.characterCount.textContent = String(draft.body.length);
  queueDraftSave();
}

function createCard(): void {
  draft = blankDraft();
  draft.date = selectedDate;
  activeCardId = null;
  lastSavedFingerprint = null;
  applyDraft();
  renderFormatShelf();
  switchView('editor');
  elements.bodyInput.focus();
}

function openCard(card: SavedCard): void {
  draft = { title: card.title, body: card.body, date: card.date, formatId: card.formatId };
  activeCardId = card.id;
  lastSavedFingerprint = fingerprint(draft);
  applyDraft();
  renderFormatShelf();
  switchView('editor');
}

async function saveCard(): Promise<void> {
  syncDraft();
  if (!draft.title.trim() && !draft.body.trim()) {
    elements.bodyInput.focus();
    showToast('Write something first', 'error');
    return;
  }
  const currentFingerprint = fingerprint(draft);
  if (currentFingerprint === lastSavedFingerprint) {
    showToast('Already saved');
    selectedDate = draft.date;
    switchView('home');
    return;
  }
  const now = Date.now();
  if (activeCardId) {
    savedCards = savedCards.map((card) => card.id === activeCardId ? { ...card, ...draft, updatedAt: now } : card);
    showToast('Changes saved');
  } else {
    activeCardId = `${now}-${Math.random().toString(16).slice(2)}`;
    savedCards = [{ ...draft, id: activeCardId, createdAt: now, updatedAt: now }, ...savedCards];
    showToast('Saved');
  }
  lastSavedFingerprint = currentFingerprint;
  await storage.setItem(STORAGE_KEYS.cards, JSON.stringify(savedCards));
  await storage.setItem(STORAGE_KEYS.draft, JSON.stringify(draft));
  selectedDate = draft.date;
  switchView('home');
}

async function publishCard(): Promise<void> {
  if (isPublishing) return;
  syncDraft();
  if (!draft.title.trim() && !draft.body.trim()) {
    showToast('Write something first', 'error');
    return;
  }
  if (!runtimeHasDomain(OUTBOX_DOMAIN)) {
    showToast('Nostr publishing is unavailable', 'error');
    return;
  }
  if (!runtimeHasDomain(UPLOAD_DOMAIN)) {
    showToast('Image upload is unavailable', 'error');
    return;
  }
  const postFingerprint = fingerprint(draft);
  if (publicationTracker.has(postFingerprint) && !await confirmDuplicatePost()) {
    showToast('Post cancelled');
    return;
  }
  isPublishing = true;
  elements.publishButton.disabled = true;
  try {
    // The post is the card itself: draw the background art and the typed words
    // into one PNG, hand it to the shell's upload rail, then publish a note
    // whose content is the stored image URL.
    showProgress('Drawing the card');
    const snapshot = { ...draft };
    const card = await renderCardImage(snapshot);
    const alt = cardAltText(snapshot);
    showProgress('Uploading the image');
    const uploaded = await uploadCardImage(card, snapshot, alt);
    if (!uploaded.ok || !uploaded.url) {
      showToast(uploaded.error ?? 'Image upload failed', 'error');
      return;
    }
    const template = {
      kind: 1,
      content: uploaded.url,
      tags: [
        buildImetaTag(uploaded, card, alt),
        ['t', 'type-zoo'],
        ['type-zoo-format', snapshot.formatId],
      ],
      created_at: Math.floor(Date.now() / 1000),
    };
    const result = await outbox.publish(template, {
      // Explicit first-use destinations let the shell publish before the account
      // has a NIP-65 relay list. Once configured, normal shell routing still owns
      // signing, validation, and relay fanout.
      relays: [...PUBLISH_FALLBACK_RELAYS],
      toOutbox: false,
    });
    if (!result.ok) {
      showToast(result.error ?? 'Publish failed', 'error');
      return;
    }
    publicationTracker.record(postFingerprint);
    showToast('Posted the card image');
  } finally {
    isPublishing = false;
    elements.publishButton.disabled = false;
  }
}

function confirmDuplicatePost(): Promise<boolean> {
  return new Promise((resolve) => {
    elements.duplicatePostDialog.returnValue = 'cancel';
    elements.duplicatePostDialog.addEventListener('close', () => {
      resolve(elements.duplicatePostDialog.returnValue === 'post-again');
    }, { once: true });
    elements.duplicatePostDialog.showModal();
  });
}

function renderBoxes(): void {
  const query = elements.searchInput.value.trim().toLowerCase();
  const cards = savedCards.filter((card) => `${card.title} ${card.body}`.toLowerCase().includes(query));
  elements.boxesGrid.replaceChildren(...cards.map((card) => {
    const format = getCardFormat(card.formatId);
    const item = document.createElement('article');
    item.className = `box-card ${format.className}`;
    item.innerHTML = `<span>${format.icon}</span><strong>${escapeHtml(card.title)}</strong><p>${escapeHtml(card.body)}</p><div><button type="button" data-open>Open</button><button type="button" data-remove>Remove</button></div>`;
    item.querySelector<HTMLButtonElement>('[data-open]')?.addEventListener('click', () => openCard(card));
    item.querySelector<HTMLButtonElement>('[data-remove]')?.addEventListener('click', () => void removeCard(card.id));
    return item;
  }));
  elements.emptyBoxes.hidden = cards.length > 0;
}

async function removeCard(id: string): Promise<void> {
  savedCards = savedCards.filter((card) => card.id !== id);
  if (activeCardId === id) { activeCardId = null; lastSavedFingerprint = null; }
  await storage.setItem(STORAGE_KEYS.cards, JSON.stringify(savedCards));
  renderBoxes();
  renderHome();
}

function escapeHtml(value: string): string {
  const span = document.createElement('span');
  span.textContent = value;
  return span.innerHTML;
}

function queueDraftSave(): void {
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => void storage.setItem(STORAGE_KEYS.draft, JSON.stringify(draft)), 300);
}

function parseDraft(value: unknown): Draft | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<Draft>;
  if (typeof item.title !== 'string' || typeof item.body !== 'string' || typeof item.date !== 'string') return null;
  if (!CARD_FORMATS.some((format) => format.id === item.formatId)) return null;
  return item as Draft;
}

function parseCard(value: unknown): SavedCard | null {
  const draftValue = parseDraft(value);
  if (!draftValue || !value || typeof value !== 'object') return null;
  const item = value as Partial<SavedCard>;
  if (typeof item.id !== 'string' || typeof item.createdAt !== 'number' || typeof item.updatedAt !== 'number') return null;
  return { ...draftValue, id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt };
}

async function loadState(): Promise<void> {
  const [draftRaw, cardsRaw] = await Promise.all([storage.getItem(STORAGE_KEYS.draft), storage.getItem(STORAGE_KEYS.cards)]);
  if (draftRaw) draft = parseDraft(JSON.parse(draftRaw)) ?? draft;
  if (cardsRaw) {
    const parsed: unknown = JSON.parse(cardsRaw);
    if (Array.isArray(parsed)) savedCards = parsed.map(parseCard).filter((card): card is SavedCard => card !== null);
  }
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.style.setProperty('--shell-bg', theme.colors.background);
  root.style.setProperty('--shell-fg', theme.colors.text);
  root.style.setProperty('--shell-primary', theme.colors.primary);
  root.style.backgroundColor = theme.colors.background;
  document.body.style.backgroundColor = theme.colors.background;
  document.body.style.color = theme.colors.text;
  elements.app.style.backgroundColor = theme.colors.background;
}

function bindEvents(): void {
  [elements.titleInput, elements.bodyInput, elements.dateInput].forEach((input) => input.addEventListener('input', syncDraft));
  elements.composeButton.addEventListener('click', createCard);
  elements.menuButton.addEventListener('click', () => switchView('boxes'));
  elements.boxesButton.addEventListener('click', () => switchView('boxes'));
  elements.backButton.addEventListener('click', () => switchView('home'));
  elements.boxesBackButton.addEventListener('click', () => switchView('home'));
  elements.saveButton.addEventListener('click', () => void saveCard().catch(() => showToast('Save failed', 'error')));
  elements.publishButton.addEventListener('click', () => void publishCard().catch(() => showToast('Publish failed', 'error')));
  elements.searchInput.addEventListener('input', renderBoxes);
  window.addEventListener('beforeunload', () => themeSubscription?.close());
}

async function start(): Promise<void> {
  installCardArtwork();
  bindEvents();
  if (runtimeHasDomain(THEME_DOMAIN)) {
    try { themeGet().then(applyTheme).catch(() => undefined); themeSubscription = themeOnChanged(applyTheme); } catch { themeSubscription = null; }
  }
  if (runtimeHasDomain(STORAGE_DOMAIN)) {
    try {
      await loadState();
    } catch {
      savedCards = [];
      draft = blankDraft();
    }
  }
  renderFormatShelf();
  applyDraft();
  renderHome();
}

void start();
