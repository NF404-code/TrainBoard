import { normalizeImport, payloadHash } from './import-payload.mjs';
const NOTES_KEY = 'trainboard-notes-with-history-v2';
const LEGACY_KEY = 'trainboard-notes-v1';
const NO_DATE = '1970-01-01T00:00:00.000Z';
const stamp = () => new Date().toISOString();
const roleName = role => ({ admin: 'Владелец', member: 'Участник', viewer: 'Читатель' })[role];

function displayDate(value) {
  if (value === NO_DATE) return 'Дата не записана';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('ru-RU', { timeZone: 'Europe/Warsaw' })
    : 'Дата не записана';
}

// crypto.randomUUID() exists only in secure contexts. `vite --host 0.0.0.0` opened
// from a phone over http://192.168.x.x is NOT one, so notes could not be created there.
function uuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function localData() {
  const value = localStorage.getItem(NOTES_KEY);
  if (value) {
    let saved;
    try { saved = JSON.parse(value); } catch { saved = null; } // a SyntaxError message is useless to the user
    if (!Array.isArray(saved?.notes) || !Array.isArray(saved?.history)) throw new Error('Локальные записи не удалось прочитать. Скачайте копию для восстановления.');
    return saved;
  }
  let old;
  try { old = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]'); } catch { old = null; }
  if (!Array.isArray(old)) throw new Error('Старые записи не удалось прочитать. Скачайте копию для восстановления.');
  const notes = old.filter(n => n && typeof n === 'object').map(n => ({ ...n, id: String(n.id), archived: !!n.archived, createdAt: n.createdAt || (Number.isFinite(Number(n.id)) ? new Date(Number(n.id)).toISOString() : NO_DATE) }));
  return { notes, history: notes.map(n => ({ id: 'legacy-' + n.id, noteId: n.id, action: 'Сохранено ранее', type: n.type, body: n.body, at: n.createdAt })) };
}

function download(data, label) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `trainboard-${label}-${stamp().slice(0, 10)}.json`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function createWorkspace({ render, isVisible, esc, timeoutMs = 20000 }) {
  let user = null, hasLoginKey = false, ownerAvailable = false, loading = true, remote = null, source = 'remote', view = 'active';
  let message = '', busy = false, team = null, secret = null, preview = null, importSnapshot = null, loadFailed = false;
  let draft = { body: '', type: 'Материал', visibility: 'public' };
  let lastLoad = 0, inFlight = false, pendingLoad = Promise.resolve();
  const fragment = new URLSearchParams(location.hash.slice(1));
  let inviteToken = fragment.get('invite');
  if (inviteToken) history.replaceState(null, '', location.pathname + location.search);
  const repaint = () => { if (isVisible()) render(); };
  const editing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

  function resetSession() { user = null; remote = null; team = null; secret = null; preview = null; importSnapshot = null; source = 'remote'; }

  // Every request has a timeout. Without it one hung fetch kept `inFlight` true forever:
  // load() and act() both await pendingLoad, so the whole screen froze with busy = true.
  async function api(path, data) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(path, { method: data ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401 && !path.endsWith('/login')) resetSession();
        throw new Error(result?.error || (result === null ? 'Сервис не ответил. Повторите попытку.' : 'Не удалось выполнить действие.'));
      }
      return result ?? {};
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Сервис не ответил вовремя. Повторите попытку.');
      if (error instanceof TypeError) throw new Error('Нет связи с сервисом. Повторите попытку.');
      throw error;
    } finally { clearTimeout(timer); }
  }

  async function load(force = false) {
    if (inFlight) { await pendingLoad; if (force) return load(true); return; }
    if (!force && Date.now() - lastLoad < 30000) return;
    inFlight = true; lastLoad = Date.now();
    let release;
    pendingLoad = new Promise(resolve => { release = resolve; });
    const before = JSON.stringify({ user, remote, message });
    try {
      const me = await api('/api/auth/me');
      if (user?.id !== me.user?.id) { remote = null; team = null; secret = null; preview = null; importSnapshot = null; draft = { body: '', type: 'Материал', visibility: 'public' }; }
      user = me.user ?? null; hasLoginKey = !!me.hasLoginKey; ownerAvailable = !!me.ownerAvailable;
      const notes = await api('/api/notes');
      // A 200 without notes/history used to be stored as-is and crashed page().
      if (!Array.isArray(notes.notes) || !Array.isArray(notes.history)) throw new Error('Сервис вернул неожиданный ответ. Повторите попытку.');
      remote = notes;
      if (loadFailed) { message = ''; loadFailed = false; } // a stale "offline" banner must not outlive the outage
    } catch (error) { message = error.message; loadFailed = true; }
    finally { loading = false; inFlight = false; release(); }
    if (force || (!editing() && before !== JSON.stringify({ user, remote, message }))) repaint();
  }
  async function act(fn) {
    if (busy) return;
    busy = true; message = ''; loadFailed = false;
    try { await pendingLoad; await fn(); } catch (error) { message = error.message; }
    finally { busy = false; repaint(); }
  }
  function saveLocal(data, note, action) {
    data.history.unshift({ id: uuid(), noteId: note.id, action, type: note.type, body: note.body, at: stamp() });
    localStorage.setItem(NOTES_KEY, JSON.stringify(data));
  }
  function getData() { return source === 'local' ? localData() : remote || { notes: [], history: [] }; }
  function accountPanel() {
    if (inviteToken) return `<form id="accept-invite" class="section-card"><h3>Приглашение в TrainBoard</h3><p>Укажите имя. После принятия получите личный ключ для входа с любого устройства без ChatGPT.</p><label>Ваше имя<input name="name" class="field" maxlength="80" required autocomplete="name"></label><button class="primary" ${busy ? 'disabled' : ''}>Принять приглашение</button><button type="button" id="cancel-invite" class="secondary">Отмена</button></form>`;
    if (!user) return `<details class="section-card"><summary>Вход владельца и участников</summary><p>Читать и добавлять записи можно без входа. Ключ нужен для входа в свой аккаунт и управления приложением.</p><form id="login-form"><label>Личный ключ<input name="key" type="password" class="field" autocomplete="current-password" required maxlength="80"></label><button class="primary" ${busy ? 'disabled' : ''}>Войти</button></form>${ownerAvailable ? '<button id="use-owner" class="secondary">Продолжить как владелец</button>' : ''}<p class="account-help"><a href="/signin-with-chatgpt?return_to=%2F%3Fowner%3D1" target="_top">Вход владельца через ChatGPT</a></p></details>`;
    return `<section class="section-card account-card"><div><strong>${esc(user.name)}</strong><span class="muted"> · ${esc(roleName(user.role))}</span></div><p>Все записи раздела «Новое» видны любому посетителю по ссылке.</p><div class="account-actions">${!hasLoginKey && user.platformOwner ? '<button id="owner-key" class="secondary">Создать личный ключ входа</button>' : hasLoginKey ? '<button id="rotate-key" class="secondary">Заменить ключ входа</button>' : ''}${user.role === 'admin' ? '<button id="manage-team" class="secondary">Приглашения · 4 места</button>' : ''}<button id="logout" class="secondary">Выйти</button></div></section>`;
  }
  function secretPanel() {
    return secret ? `<section class="section-card secret-panel"><h3>${secret.kind === 'invite' ? 'Одноразовое приглашение' : 'Ваш личный ключ входа'}</h3><p>${secret.kind === 'invite' ? 'Передайте ссылку только нужному человеку. Она действует 48 часов и принимается один раз.' : 'Сохраните ключ в менеджере паролей. Он показывается только сейчас и открывает доступ к вашим записям.'}</p><label>${secret.kind === 'invite' ? 'Ссылка приглашения' : 'Ключ входа'}<input id="secret-value" class="field" value="${esc(secret.value)}" readonly autocomplete="off"></label><div class="account-actions"><button id="copy-secret" class="secondary">Скопировать</button><button id="close-secret" class="primary">Сохранил</button></div></section>` : '';
  }
  function teamPanel() {
    if (!team || !Array.isArray(team.slots) || user?.role !== 'admin') return '';
    return `<section class="section-card"><h3>Приглашённые пользователи</h3><p>Любой посетитель по ссылке может читать и добавлять записи. Участник меняет свои записи, владелец может редактировать и архивировать любые. Ключи и управление аккаунтами доступны только владельцу.</p>${team.slots.map(slot => {
      const active = slot.active && !slot.revoked;
      const pending = slot.label && !slot.claimed_at && !slot.revoked && slot.expires_at > Date.now();
      return `<div class="team-slot"><strong>Место ${slot.slot}${slot.name ? ' · ' + esc(slot.name) : ''}</strong><p class="muted">${active ? esc(roleName(slot.role)) : pending ? 'Ожидает принятия · ' + esc(slot.label) : 'Свободно'}</p>${active ? `<label>Роль<select class="field" data-role-slot="${slot.slot}"><option value="member" ${slot.role === 'member' ? 'selected' : ''}>Участник</option><option value="viewer" ${slot.role === 'viewer' ? 'selected' : ''}>Читатель</option></select></label>` : `<form data-invite-slot="${slot.slot}"><label>Кому передадите приглашение<input name="label" class="field" required maxlength="80" placeholder="Имя или ваша пометка"></label><label>Роль<select name="role" class="field"><option value="member">Участник</option><option value="viewer">Читатель</option></select></label><button class="secondary" ${busy ? 'disabled' : ''}>${pending ? 'Заменить приглашение' : 'Создать приглашение'}</button></form>`}${active || pending ? `<button class="secondary revoke" data-revoke="${slot.slot}">Отозвать доступ</button>` : ''}</div>`;
    }).join('')}<button id="close-team" class="secondary">Закрыть</button></section>`;
  }
  function importPanel() {
    if (source !== 'local' || user?.role === 'viewer') return '';
    return `<section class="section-card"><h3>Перенос в общий раздел</h3><p>Записи, архив и история станут видны всем посетителям по ссылке. Оригиналы в этом браузере останутся. Одинаковые данные при повторе не дублируются.</p>${preview ? `<p>${preview.notes} записей · ${preview.history} событий истории · Доступны всем по ссылке</p><label class="confirm-line"><input type="checkbox" id="confirm-import"> Подтверждаю перенос и открытый доступ ко всем этим данным</label><div class="account-actions"><button id="confirm-transfer" class="primary" ${busy ? 'disabled' : ''}>Опубликовать и проверить</button><button id="cancel-transfer" class="secondary">Отмена</button></div>` : `<button id="preview-transfer" class="secondary" ${busy ? 'disabled' : ''}>Посмотреть перед переносом</button>`}</section>`;
  }
  function page() {
    let data = { notes: [], history: [] }, localError = '';
    try { data = getData(); } catch (error) { localError = error.message; }
    const canWrite = source === 'local' || (remote && remote.canCreate !== false && user?.role !== 'viewer');
    const showData = source === 'local' || !!remote;
    const items = data.notes.filter(n => view === 'active' ? !n.archived : n.archived);
    return `<div class="heading"><div><h2>Новое</h2><p class="sub">Материалы, замечания и просьбы</p></div></div>${message ? `<div class="notice warn" role="status">${esc(message)}</div>` : ''}${secretPanel()}${accountPanel()}${teamPanel()}<div class="source-actions"><button id="remote-source" class="secondary" ${source === 'remote' ? 'aria-pressed="true"' : ''}>Общая доска</button><button id="local-source" class="secondary" ${source === 'local' ? 'aria-pressed="true"' : ''}>Локальные записи</button></div><div class="notice">${source === 'local' ? 'Записи этого браузера. Перенос запускается только после вашего подтверждения.' : loading ? 'Загружаем общую доску…' : 'Все записи видны любому посетителю по ссылке · обновление каждые 30 секунд.'}</div>${localError ? `<div class="notice warn">${esc(localError)}</div><button id="export-local" class="secondary">Скачать исходную копию</button>` : importPanel()}${showData && !localError ? `${canWrite ? `<form id="note-form" class="section-card"><h3>Новая запись</h3><label>Тип<select name="type" class="field">${['Материал', 'Замечание', 'Просьба'].map(t => `<option ${draft.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>${source !== 'local' ? '<p class="muted">Запись будет видна всем по ссылке. Без входа вы сможете изменять её в этом браузере.</p>' : ''}<label>Текст<textarea name="body" class="field" maxlength="5000" required>${esc(draft.body)}</textarea></label><button class="primary full" ${busy ? 'disabled' : ''}>＋ Сохранить запись</button></form>` : ''}<div class="note-tabs"><button data-note-view="active" class="${view === 'active' ? 'selected' : ''}">Сохранённые</button><button data-note-view="archive" class="${view === 'archive' ? 'selected' : ''}">Архив</button></div><div class="notes">${items.length ? items.map(n => `<article class="note"><div class="note-top"><span class="pill blue">${esc(n.type)}</span><span class="muted">${source === 'local' ? 'На устройстве' : 'Видна всем'} · ${esc(displayDate(n.updatedAt || n.createdAt))}</span></div><p>${esc(n.body)}</p>${source === 'local' || n.canEdit ? `<div class="note-actions"><button data-edit="${esc(n.id)}">✎ Изменить</button><button data-archive="${esc(n.id)}">${n.archived ? 'Восстановить' : 'В архив'}</button></div>` : ''}</article>`).join('') : '<div class="empty">Здесь пока нет записей</div>'}</div><div class="history-head"><div><h3>История сохранений</h3><p class="sub">Добавления, изменения и архив</p></div><button id="export-notes" class="secondary">Копия</button></div><div class="history-list">${data.history.map(h => `<article class="history-item"><strong>${esc(h.action)}</strong><span> · ${esc(h.type)}</span><time>${esc(displayDate(h.at))}</time><p>${esc(h.body)}</p></article>`).join('') || '<div class="empty">История появится после сохранения</div>'}</div>` : ''}`;
  }
  function bind(root) {
    const on = (selector, event, handler) => root.querySelector(selector)?.addEventListener(event, handler);
    on('#use-owner', 'click', () => void act(async () => { await api('/api/auth/use-owner', {}); await load(true); }));
    on('#login-form', 'submit', e => { e.preventDefault(); const key = new FormData(e.currentTarget).get('key').trim(); void act(async () => { await api('/api/auth/login', { key }); source = 'remote'; await load(true); }); });
    on('#accept-invite', 'submit', e => { e.preventDefault(); const name = new FormData(e.currentTarget).get('name'); void act(async () => { const result = await api('/api/auth/accept', { token: inviteToken, name }); inviteToken = null; source = 'remote'; await load(true); secret = { kind: 'key', value: result.key }; }); });
    on('#cancel-invite', 'click', () => { inviteToken = null; repaint(); });
    on('#owner-key', 'click', () => void act(async () => { const result = await api('/api/auth/owner-key', {}); await load(true); secret = { kind: 'key', value: result.key }; }));
    on('#rotate-key', 'click', () => { if (confirm('Заменить личный ключ? Старый ключ и входы на других устройствах перестанут работать.')) void act(async () => { const result = await api('/api/auth/rotate-key', {}); secret = { kind: 'key', value: result.key }; }); });
    on('#logout', 'click', () => void act(async () => { await api('/api/auth/logout', {}); resetSession(); draft.body = ''; message = 'Вы вышли из аккаунта. Общая доска остаётся доступной.'; await load(true); }));
    on('#copy-secret', 'click', () => void act(async () => { try { await navigator.clipboard.writeText(secret.value); message = 'Скопировано.'; } catch { root.querySelector('#secret-value').select(); message = 'Выделено для копирования.'; } }));
    on('#close-secret', 'click', () => { secret = null; repaint(); });
    on('#manage-team', 'click', () => void act(async () => { team = await api('/api/team'); }));
    on('#close-team', 'click', () => { team = null; repaint(); });
    root.querySelectorAll('[data-invite-slot]').forEach(form => form.addEventListener('submit', e => {
      e.preventDefault(); const data = new FormData(form);
      void act(async () => { const result = await api('/api/team', { action: 'invite', slot: Number(form.dataset.inviteSlot), label: data.get('label'), role: data.get('role') }); secret = { kind: 'invite', value: location.origin + '/#invite=' + result.token }; team = await api('/api/team'); });
    }));
    root.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', () => { if (confirm('Отозвать приглашение и все входы этого пользователя? Его записи сохранятся.')) void act(async () => { await api('/api/team', { action: 'revoke', slot: Number(b.dataset.revoke) }); team = await api('/api/team'); }); }));
    root.querySelectorAll('[data-role-slot]').forEach(s => s.addEventListener('change', () => void act(async () => { await api('/api/team', { action: 'role', slot: Number(s.dataset.roleSlot), role: s.value }); team = await api('/api/team'); })));
    for (const [selector, value] of [['#local-source', 'local'], ['#remote-source', 'remote']]) on(selector, 'click', () => { source = value; preview = null; importSnapshot = null; draft.body = ''; message = ''; loadFailed = false; repaint(); if (source === 'remote') void load(true); });
    root.querySelectorAll('[data-note-view]').forEach(b => b.addEventListener('click', () => { view = b.dataset.noteView; repaint(); }));
    const form = root.querySelector('#note-form');
    form?.addEventListener('input', () => { const values = new FormData(form); draft = { body: values.get('body'), type: values.get('type'), visibility: 'public' }; });
    form?.addEventListener('submit', e => {
      e.preventDefault();
      // Read the form itself: autofill / dictation / paste do not always fire `input`, so `draft` can be stale.
      const values = new FormData(form);
      draft = { body: String(values.get('body') ?? ''), type: String(values.get('type') ?? 'Материал'), visibility: 'public' };
      if (!draft.body.trim()) return;
      const sending = { ...draft, body: draft.body.trim() };
      void act(async () => {
        if (source === 'local') { const data = localData(), note = { id: uuid(), type: sending.type, body: sending.body, archived: false, createdAt: stamp() }; data.notes.unshift(note); saveLocal(data, note, 'Создано'); }
        else { await api('/api/notes/session', {}); await api('/api/notes', { action: 'create', id: uuid(), ...sending }); }
        draft.body = ''; view = 'active'; if (source === 'remote') await load(true);
      });
    });
    root.querySelectorAll('[data-edit], [data-archive]').forEach(b => b.addEventListener('click', () => {
      const note = getData().notes.find(n => n.id === (b.dataset.edit || b.dataset.archive)); if (!note) return;
      const raw = b.dataset.edit ? prompt('Изменить запись:', note.body) : null;
      const body = raw === null ? null : raw.trim();
      if (b.dataset.edit && (!body || body.length > 5000 || body === note.body)) return;
      void act(async () => {
        if (source === 'local') { const data = localData(), target = data.notes.find(n => n.id === note.id); if (b.dataset.edit) target.body = body; else target.archived = !target.archived; target.updatedAt = stamp(); saveLocal(data, target, b.dataset.edit ? 'Изменено' : target.archived ? 'В архиве' : 'Восстановлено'); }
        else { try { await api('/api/notes', { action: b.dataset.edit ? 'edit' : 'archive', id: note.id, revision: note.revision, body, archived: !note.archived }); await load(true); } catch (error) { if (body) { draft.body = body; draft.type = note.type; draft.visibility = note.visibility; } throw error; } }
      });
    }));
    on('#export-notes', 'click', () => source === 'local' ? backupLocal() : download({ exportedAt: stamp(), ...remote }, 'server-copy'));
    on('#export-local', 'click', backupLocal);
    on('#preview-transfer', 'click', () => { const visibility = 'public'; void act(async () => {
      importSnapshot = { ...structuredClone(localData()), visibility };
      const normalized = normalizeImport(importSnapshot);
      if (new TextEncoder().encode(JSON.stringify(normalized)).length > 510 * 1024) throw new Error('Копия слишком большая для одного переноса. Оригиналы сохранены; скачайте резервную копию.');
      preview = { hash: await payloadHash(normalized), notes: normalized.notes.length, history: normalized.history.length, visibility };
    }); });
    on('#cancel-transfer', 'click', () => { preview = null; importSnapshot = null; repaint(); });
    on('#confirm-transfer', 'click', () => {
      if (!root.querySelector('#confirm-import').checked) { message = 'Отметьте подтверждение переноса.'; repaint(); return; }
      void act(async () => {
        if (await payloadHash(normalizeImport({ ...localData(), visibility: importSnapshot.visibility })) !== preview.hash) throw new Error('Локальные записи изменились. Отмените этот перенос и откройте предварительный просмотр заново.');
        // Save the exact original bytes before transmission; never remove or replace the source keys.
        try { localStorage.setItem('trainboard-import-backup-' + preview.hash, JSON.stringify({ rawV2: localStorage.getItem(NOTES_KEY), rawV1: localStorage.getItem(LEGACY_KEY), data: importSnapshot, savedAt: stamp() })); }
        catch { throw new Error('Не удалось сохранить резервную копию в браузере (нет места). Перенос отменён, данные не изменены. Скачайте копию вручную.'); }
        await api('/api/notes/session', {});
        const result = await api('/api/notes/import', { ...importSnapshot, confirmed: true, expectedHash: preview.hash });
        const receipt = await api('/api/notes/import-receipt?id=' + encodeURIComponent(result.receipt));
        if (receipt.payload_hash !== preview.hash || receipt.note_count !== preview.notes || receipt.history_count !== preview.history) throw new Error('Результат переноса ещё не подтверждён. Локальные данные сохранены.');
        message = `Проверено на сервере: ${receipt.note_count} записей и ${receipt.history_count} событий. Локальные оригиналы и резервная копия сохранены.`;
        preview = null; importSnapshot = null; source = 'remote'; await load(true);
      });
    });
  }
  function backupLocal() { try { download({ exportedAt: stamp(), rawV2: localStorage.getItem(NOTES_KEY), rawV1: localStorage.getItem(LEGACY_KEY), current: (() => { try { return localData(); } catch { return null; } })() }, 'local-copy'); } catch (error) { message = error.message; repaint(); } }
  async function init() {
    if (new URLSearchParams(location.search).get('owner') === '1') { try { await api('/api/auth/use-owner', {}); } catch {} history.replaceState(null, '', location.pathname); }
    // Timers/listeners first, so a slow first load cannot leave the board without background refresh.
    setInterval(() => { if (!busy && document.visibilityState !== 'hidden' && isVisible()) void load(); }, 5000);
    window.addEventListener('online', () => void load(true));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void load(true); });
    await load(true);
    if (inviteToken) { document.querySelector('[data-tab="notes"]')?.click(); }
  }
  return { page, bind, init };
}