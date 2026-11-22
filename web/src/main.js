import { ARRIVAL_SLOTS, ARRIVAL_TOLERANCE_MINUTES } from './arrival-slots.mjs';
import { warsawDate } from './schedule-date.mjs';
import './style.css';
import './theme.css';
import './history.css';
import './access.css';
import './premium.css';
import { createWorkspace } from './workspace.mjs';
import { setupNotifications, notifyScheduleChanges } from './notifications.mjs';

const SHEET = 'https://docs.google.com/spreadsheets/d/1uvvJ1tJE3WTqsjZ9tk5TcRg1zMnQeX50VjUw_P5LmgY/edit';
const CACHE_KEY = 'trainboard-schedule-v4-delays';
const TAB_KEY = 'trainboard-tab';
const REFRESH_INTERVAL = 3 * 60 * 1000;
const PLAN_REFRESH_INTERVAL = 3 * 60 * 1000;
const root = document.querySelector('#app');

const labels = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long',
});
const timestamps = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Warsaw', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});
const clockFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit',
});

// ---------- helpers ----------

// Format check AND real-calendar check (2026-13-45 and 2026-02-31 are rejected).
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const time = Date.parse(value + 'T12:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().startsWith(value);
}

function validSnapshot(value) {
  return Boolean(value) && validDate(value.date) && Array.isArray(value.trains);
}

const dateOverride = new URLSearchParams(location.search).get('date');
const requestedDate = validDate(dateOverride) ? dateOverride : null;
const activeDate = () => requestedDate ?? warsawDate();

function dateLabel(date) {
  const time = Date.parse(date + 'T12:00:00Z');
  return Number.isFinite(time) ? labels.format(new Date(time)) : '—';
}

function timestamp(value) {
  const time = Date.parse(value);
  return value && Number.isFinite(time) ? timestamps.format(new Date(time)) : '—';
}

function clockTime(value) {
  const time = Date.parse(value);
  return value && Number.isFinite(time) ? clockFormat.format(new Date(time)) : null;
}

// "каждую минуту / каждые 2 минуты / каждые 5 минут"
function every(minutes) {
  const last = minutes % 10;
  const lastTwo = minutes % 100;
  if (minutes === 1) return 'каждую минуту';
  if (last === 1 && lastTwo !== 11) return `каждые ${minutes} минуту`;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return `каждые ${minutes} минуты`;
  return `каждые ${minutes} минут`;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function readSchedule() {
  try {
    const data = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return validSnapshot(data) ? data : null;
  } catch {
    return null;
  }
}

function rememberSchedule(data) {
  saved = data;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // Keep the current result available when browser storage is disabled or full.
  }
}

// ---------- state ----------

let page = 'today';
let selectedDate = activeDate();
let saved = readSchedule();
let snapshot = saved?.date === selectedDate ? saved : null;
let status = snapshot ? 'stale' : 'loading';
let reason = snapshot ? 'offline' : null;
let activeRequest = null;
let lastAttempt = 0;
let serverStatus = null;
let lastTodayHtml = '';

// ---------- schedule loading ----------

// Re-render the "today" page only when its HTML actually changed.
function renderToday() {
  if (page !== 'today') return;
  if (todayPage() === lastTodayHtml && root.firstElementChild) return;
  render();
}

function selectToday(date) {
  if (date === selectedDate) return;
  activeRequest?.controller.abort();
  activeRequest = null;
  selectedDate = date;
  snapshot = saved?.date === date ? saved : null;
  status = snapshot ? 'stale' : 'loading';
  reason = snapshot ? 'offline' : null;
  lastAttempt = 0;
  renderToday();
}

async function loadServerStatus() {
  try {
    const response = await fetch('/api/schedule/status', { cache: 'no-store' });
    if (!response.ok) return; // keep the previous value instead of wiping it
    serverStatus = await response.json();
    renderToday();
  } catch {
    // The status line is optional.
  }
}

async function refresh(force = false) {
  selectToday(activeDate());
  if (activeRequest) return;

  const date = selectedDate;
  const controller = new AbortController();
  const request = { controller };
  activeRequest = request;
  lastAttempt = Date.now();
  renderToday();

  const timeout = setTimeout(() => controller.abort(), 22000);
  try {
    const params = new URLSearchParams();
    // `!(age < limit)` is also true when checkedAt is missing/invalid (age is NaN).
    const age = snapshot ? Date.now() - Date.parse(snapshot.checkedAt) : Infinity;
    if (force || !(age < REFRESH_INTERVAL - 5000)) params.set('refresh', '1');
    if (requestedDate) params.set('date', requestedDate);
    const query = params.toString(); // URLSearchParams.size is missing in Safari < 17

    const response = await fetch('/api/schedule' + (query ? '?' + query : ''), {
      cache: 'no-store', signal: controller.signal,
    });
    if (!response.ok) throw new Error('Schedule HTTP ' + response.status);
    const result = await response.json();
    void loadServerStatus();
    if (activeRequest !== request || activeDate() !== date) return;

    const invalid = result.requestedDate !== date
      || !['fresh', 'stale'].includes(result.status)
      || (result.status === 'fresh' && !result.snapshot)
      || (result.snapshot && (!validSnapshot(result.snapshot) || result.snapshot.date !== date));
    if (invalid) throw new Error('Invalid schedule response');

    const cachedForToday = saved?.date === date ? saved : null;
    snapshot = result.snapshot || cachedForToday;
    status = result.status;
    reason = result.reason;
    if (result.status === 'fresh' && result.snapshot) void notifyScheduleChanges(cachedForToday, result.snapshot);
    if (result.snapshot && (!cachedForToday || result.status === 'fresh' ||
        result.snapshot.checkedAt >= cachedForToday.checkedAt)) {
      rememberSchedule(result.snapshot);
    } else if (cachedForToday && result.status === 'stale') {
      snapshot = cachedForToday;
    }
  } catch {
    if (activeRequest !== request || activeDate() !== date) return;
    snapshot = saved?.date === date ? saved : null;
    status = 'stale';
    reason = 'offline';
  } finally {
    clearTimeout(timeout);
    if (activeRequest === request) {
      activeRequest = null;
      if (activeDate() !== date) void refresh();
      else renderToday();
    }
  }
}

// ---------- views ----------

function trainCard(train, stale) {
  const { number, depart, time, scheduledTime, delayMinutes, station, arrivalDate, previousFeed, targetArrival } = train;
  const updateKnown = Number.isFinite(delayMinutes);
  const old = stale || previousFeed || (updateKnown && snapshot?.realtimeStatus !== 'fresh');
  const changed = updateKnown && delayMinutes !== 0;
  const statusClass = old ? 'amber' : delayMinutes > 0 ? 'red' : delayMinutes < 0 ? 'green' : 'blue';
  const statusText = previousFeed ? 'Предыдущий выпуск' : old ? 'Устарело'
    : delayMinutes > 0 ? `+${delayMinutes} мин`
    : delayMinutes < 0 ? `−${Math.abs(delayMinutes)} мин`
    : updateKnown ? 'Без изменений' : 'Изменения неизвестны';
  const arrivalDay = arrivalDate && arrivalDate !== selectedDate ? ' · ' + esc(dateLabel(arrivalDate)) : '';
  return `<article class="train">
    <div class="train-top"><div><div class="train-number">LEO EXPRESS · ${number ? '№ ' + esc(number) : 'Номер не указан'}</div>
      <div class="train-route">Kraków Główny → Варшава</div></div>
      <span class="pill ${statusClass}">${statusText}</span>
    </div>
    <div class="times"><div><div class="time">${esc(depart)}</div><div class="time-label">Отправление</div></div>
      <span class="arrow" aria-hidden="true">→</span>
      <div class="time-right"><div class="time ${changed ? 'time-changed' : ''}">${esc(time)}</div><div class="time-label">${changed ? `План ${esc(scheduledTime)} · ` : ''}Прибытие${arrivalDay}</div></div>
    </div>
    <div class="train-bottom"><span class="station">${esc(station)}</span><span>Ориентир ${esc(targetArrival)}</span></div>
  </article>`;
}

function scheduleNotice() {
  if (status === 'loading') return '<div class="notice" role="status">Загружаем расписание Leo Express…</div>';

  const reasons = {
    'offline': 'Не удалось связаться с сервисом расписания.',
    'source-unavailable': 'Источник расписания временно недоступен.',
    'date-uncovered': 'Выпуск расписания не покрывает выбранную дату.',
    'feed-old': 'Источник опубликовал этот выпуск более трёх суток назад.',
    'storage-unavailable': 'Серверная копия расписания временно недоступна.',
    'check-overdue': 'Сохранённое расписание давно не проверялось.',
  };
  if (status === 'stale') {
    const warning = reasons[reason] || 'Расписание не удалось подтвердить.';
    const detail = snapshot
      ? ` Показано сохранённое расписание на ${esc(dateLabel(snapshot.date))}. Последняя проверка ${esc(timestamp(snapshot.checkedAt))}.`
      : ' Время рейсов на сегодня недоступно.';
    return `<div class="notice warn" role="status">${warning}${detail}</div>`;
  }
  return '';
}

function todayPage() {
  const trains = snapshot?.date === selectedDate ? snapshot.trains : [];
  const missing = ARRIVAL_SLOTS.filter(slot => !trains.some(train => train.slotId === slot.id));
  const noOvernight = snapshot && status === 'fresh' && !snapshot.priorServiceDateCovered && missing.some(slot => slot.id === 'early');
  const listed = noOvernight ? missing.filter(slot => slot.id !== 'early') : missing;

  const missingNotice = snapshot && status === 'fresh' && listed.length
    ? `<div class="notice warn">Подходящие рейсы Leo Express не найдены для прибытия около ${listed.map(slot => esc(slot.time + ' · ' + slot.station)).join('; ')}.</div>` : '';
  const overnightNotice = noOvernight
    ? '<div class="notice warn">Для прибытия около 06:47 не найден ночной рейс. Может отсутствовать расписание за предыдущий день.</div>' : '';
  const realtimeNotice = snapshot && status === 'fresh' && ['stale', 'unavailable'].includes(snapshot.realtimeStatus)
    ? `<div class="notice warn">Оперативные изменения ${snapshot.realtimeStatus === 'stale' ? 'устарели' : 'временно недоступны'}. ${snapshot.realtimeUpdatedAt ? 'Последнее подтверждение: ' + esc(timestamp(snapshot.realtimeUpdatedAt)) + '.' : 'Показано плановое время.'}</div>` : '';

  const checkedTime = clockTime(serverStatus?.planCheckedAt) || clockTime(snapshot?.checkedAt);
  const serverNotice = checkedTime ? `<div class="notice" role="status">Проверено в: ${esc(checkedTime)}</div>` : '';

  const todayLink = requestedDate ? '<a class="secondary" href="/">Сегодня</a>' : '';
  // Offer the button only where permission can still be requested.
  const canAsk = 'Notification' in globalThis && Notification.permission === 'default';
  const notificationRow = canAsk
    ? '<div class="notification-row"><span>Уведомления об изменениях при открытом приложении</span><button id="enable-notifications" class="secondary">Включить</button></div>' : '';

  return `<div class="heading"><div><h2>${requestedDate ? 'Расписание' : 'Сегодня'}</h2><p class="sub">${esc(dateLabel(selectedDate))} · Автообновление ${every(REFRESH_INTERVAL / 60000)}</p></div>
    <div class="heading-actions">${todayLink}<button id="refresh" class="icon-button" aria-label="Обновить расписание" ${activeRequest ? 'disabled' : ''}>↻</button></div></div>
    ${scheduleNotice()}${missingNotice}${overnightNotice}${serverNotice}${realtimeNotice}
    ${notificationRow}
    <div class="train-list">${trains.map(train => trainCard(train, status === 'stale')).join('')}</div>
    <div class="foot">Рейсы Leo Express из Kraków Główny подбираются по ближайшему времени прибытия в пределах ${ARRIVAL_TOLERANCE_MINUTES} минут от ориентира.<br>Изменённое время показывается по фиду обновлений и может поступать с задержкой.<br>
      При открытом приложении оперативные изменения проверяются ${every(REFRESH_INTERVAL / 60000)}; их фактическая скорость зависит от внешнего фида.<br>Плановое расписание перепроверяется ${every(PLAN_REFRESH_INTERVAL / 60000)}.<br>
      Фоновая облачная проверка — раз в час, даже когда приложение закрыто.<br>
      Данные PKP PLK и Koleje Mazowieckie · <a href="https://mkuran.pl/gtfs/" target="_blank" rel="noopener noreferrer">GTFS Mikołaja Kuranowskiego</a>.
      <br><a href="https://www.leoexpress.com/pl/dokad-jezdzimy/rozklady-jazdy/pociag/pociag-praga-krakow-warszawa" target="_blank" rel="noopener noreferrer">Расписание Leo Express</a>
    </div>`;
}

function premiumPage() {
  return `<section class="premium-panel" aria-label="Премия"><h2>Премия</h2>
    <a href="/premium-gorilla.jpeg" target="_blank" rel="noopener noreferrer" aria-label="Открыть фотографию в полном размере">
      <img class="premium-photo" src="/premium-gorilla.jpeg" alt="Горилла показывает средний палец"/>
    </a></section>`;
}

const workspace = createWorkspace({ render, isVisible: () => page === 'notes', esc });

function pageHtml() {
  if (page === 'today') return todayPage();
  if (page === 'premium') return premiumPage();
  return workspace.page();
}

function tab(id, label) {
  return `<button class="tab ${page === id ? 'active' : ''}" data-tab="${id}">${label}</button>`;
}

function render() {
  const scrollY = window.scrollY;
  const content = pageHtml();
  lastTodayHtml = page === 'today' ? content : '';

  root.innerHTML = `<main class="shell">
    <header class="top"><div class="brand"><div class="brand-icon leo-symbol"><img src="/leo-mark.svg" alt="Leo Express"/></div><div><h1 class="leo-title">Leo Express</h1></div></div></header>
    <nav class="tabs" aria-label="Разделы">${tab('today', 'Сегодня')}<a class="tab shifts-link" href="${SHEET}" target="_blank" rel="noopener noreferrer">Смены</a>${tab('notes', 'Новое')}${tab('premium', 'Премия')}</nav>
    ${content}
  </main>`;

  root.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
    page = button.dataset.tab;
    try { localStorage.setItem(TAB_KEY, page); } catch { /* storage unavailable */ }
    render();
    window.scrollTo(0, 0);
    checkSchedule();
  }));
  root.querySelector('#refresh')?.addEventListener('click', () => refresh(true));
  root.querySelector('#enable-notifications')?.addEventListener('click', async () => {
    await setupNotifications(true);
    renderToday();
  });
  if (page === 'notes') workspace.bind(root);
  window.scrollTo(0, scrollY); // keep scroll position across re-renders
}

// ---------- startup ----------

const savedTab = (() => {
  try { return localStorage.getItem(TAB_KEY); } catch { return null; }
})();
if (['today', 'notes', 'premium'].includes(savedTab)) page = savedTab;

function checkSchedule() {
  selectToday(activeDate());
  if (page === 'today' && document.visibilityState !== 'hidden' &&
      Date.now() - lastAttempt >= REFRESH_INTERVAL) void refresh();
}

render();
void workspace.init();
void setupNotifications();
checkSchedule();
setInterval(checkSchedule, 5 * 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkSchedule();
});
window.addEventListener('pageshow', checkSchedule);
window.addEventListener('online', () => {
  if (page === 'today') void refresh();
});