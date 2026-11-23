const SOURCE = '/api/schedule';
const REFRESH_MS = 30_000;
const slots = [
  {id:'early', name:'Ранний'},
  {id:'morning', name:'Утренний'},
  {id:'afternoon', name:'Дневной'},
  {id:'evening', name:'Вечерний'}
];
const $ = selector => document.querySelector(selector);
const state = $('#state'), stateText = $('#state-text'), cards = $('#cards');
const todayLabel = $('#today'), checked = $('#checked'), refreshButton = $('#refresh');
const counter = $('#counter');
const warsawDate = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const showDate = () => new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Warsaw',weekday:'long',day:'numeric',month:'long'}).format(new Date());
const showStamp = value => {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Warsaw',hour:'2-digit',minute:'2-digit',day:'numeric',month:'short'}).format(new Date(value));
};
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};
let loading = false, lastDate = warsawDate();
function status(kind, message) {
  state.className = 'state ' + kind;
  stateText.textContent = message;
}
function placeholder(message) {
  cards.replaceChildren(el('div','empty', message));
  counter.textContent = '—';
}
function trainCard(train, slotName, fresh) {
  const card = el('article','card');
  const top = el('div','card-top');
  const num = [train.number].filter(Boolean).join('');
  top.append(el('span','slot',slotName), el('span','train-number', num ? '№ '+num : 'Номер не указан'));
  card.append(top);
  const time = typeof train.time === 'string' ? train.time : (typeof train.targetArrival === 'string' ? train.targetArrival : '—');
  card.append(el('div','arrive', /^\d{2}:\d{2}$/.test(time) ? time : '—'));
  card.append(el('div','station', typeof train.station==='string' && train.station ? train.station : 'Станция не подтверждена'));
  const details = el('div','details');
  const platform = typeof train.platform==='string' || typeof train.platform==='number' ? String(train.platform) : '—';
  const track = typeof train.track==='string' || typeof train.track==='number' ? String(train.track) : '—';
  details.append(el('span','', 'Платформа: '+platform+' · Путь: '+track));
  if (fresh && Number.isFinite(train.delayMinutes) && train.delayMinutes !== 0) {
    const delay = train.delayMinutes;
    details.append(el('span','delay',(delay>0?'+':'')+delay+' мин'));
  }
  card.append(details);
  return card;
}
function render(data) {
  const snapshot = data?.snapshot;
  if (!snapshot || !Array.isArray(snapshot.trains)) throw new Error('Некорректный ответ расписания');
  const date = warsawDate();
  if (snapshot.date !== date) {
    placeholder('В источнике нет расписания на сегодня. Старые данные скрыты.');
    status('stale','Нет подтверждённого расписания на сегодня');
    checked.textContent = 'Проверка: '+showStamp(snapshot.checkedAt);
    return;
  }
  const fresh = data.fromStorage === true && data.status === 'fresh';
  const realtime = snapshot.realtimeStatus === 'fresh';
  if (fresh) {
    status('fresh', realtime ? 'Расписание и оперативные изменения актуальны' : 'Плановое расписание актуально; задержки не подтверждены');
  } else {
    status('stale','Сохранённое расписание устарело — проверьте источник');
  }
  checked.textContent = 'Проверка: '+showStamp(snapshot.realtimeCheckedAt || snapshot.checkedAt);
  const trains = snapshot.trains.filter(t=>t && typeof t==='object');
  const groups = [];
  for (const slot of slots) {
    const train = trains.find(t=>t.slotId === slot.id);
    if (train) groups.push({train,name:slot.name});
  }
  for (const train of trains) if (!slots.some(slot=>slot.id===train.slotId))
    groups.push({train,name:'Поезд'});
  if (!groups.length) {
    placeholder('На выбранную дату подтверждённые поезда не найдены.');
    return;
  }
  counter.textContent = groups.length+' из '+slots.length;
  cards.replaceChildren(...groups.map(({train,name})=>trainCard(train,name,fresh && realtime)));
}
async function load() {
  if (loading) return;
  loading = true;
  refreshButton.disabled = true;
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(), 15000);
  try {
    todayLabel.textContent = showDate();
    if (lastDate !== warsawDate()) {
      lastDate = warsawDate();
      placeholder('Новый день. Получаем свежее расписание…');
    }
    const response = await fetch(SOURCE,{cache:'no-store',signal:controller.signal,headers:{Accept:'application/json'}});
    if (!response.ok) throw new Error('HTTP '+response.status);
    const data = await response.json();
    render(data);
  } catch (error) {
    status('error','Источник расписания недоступен');
    placeholder('Не удалось проверить данные. Попробуйте «Обновить» позже.');
    checked.textContent = 'Проверка: недоступна';
    console.warn('TrainBoard refresh failed:', error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timeout);
    loading = false;
    refreshButton.disabled = false;
  }
}
refreshButton.addEventListener('click',()=>void load());
document.addEventListener('visibilitychange',()=>{if(!document.hidden) void load()});
setInterval(()=>{if(!document.hidden) void load()},REFRESH_MS);
if('serviceWorker' in navigator) window.addEventListener('load',()=>{void navigator.serviceWorker.register('/sw.js').catch(()=>{})});
void load();


// Persist the choice per browser. Never ask for permission on page load.
// A user who declined is not re-prompted: they must explicitly click Enable.
const pushToggle = $('#push-toggle');
const pushStatus = $('#push-status');
const PUSH_CHOICE_KEY = 'trainboard-push-choice-v1';
const pushChoice = () => {
  try { return localStorage.getItem(PUSH_CHOICE_KEY) || 'unset'; } catch { return 'unset'; }
};
const rememberPush = value => {
  try { localStorage.setItem(PUSH_CHOICE_KEY,value); } catch { /* private storage */ }
};
const pushReady = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
const decodeVapid = value => {
  const base64 = value.replace(/-/g,'+').replace(/_/g,'/');
  const bytes = atob(base64.padEnd(Math.ceil(base64.length/4)*4,'='));
  return Uint8Array.from(bytes,c=>c.charCodeAt(0));
};
async function pushConfig() {
  const response = await fetch('/api/push/config',{cache:'no-store'});
  if (!response.ok) throw new Error('Сервер push не подключён');
  const value = await response.json();
  if (!value?.publicKey || typeof value.publicKey !== 'string') throw new Error('Ключ push отсутствует');
  return value;
}
async function pushRequest(endpoint, subscription) {
  const response = await fetch('/api/push/'+endpoint,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(subscription),cache:'no-store'
  });
  if (!response.ok) throw new Error('Не удалось сохранить подписку на сервере');
}
async function refreshPushUI() {
  if (!pushReady()) {
    pushStatus.textContent='Push недоступен в этом браузере. На iPhone откройте сайт, добавленный на экран «Домой».';
    pushToggle.disabled=true;pushToggle.textContent='Недоступно';return;
  }
  const choice=pushChoice();
  const permission=Notification.permission;
  const registration=await navigator.serviceWorker.ready;
  const subscription=await registration.pushManager.getSubscription();
  const active=choice==='on' && permission==='granted' && !!subscription;
  pushToggle.disabled=false;
  pushToggle.textContent=active?'Выключить':'Включить';
  if(active)pushStatus.textContent='Разрешено на устройстве. Проверяем сервер…';
  else if(permission==='denied')pushStatus.textContent='Браузер заблокировал уведомления. Измените разрешение в настройках устройства.';
  else if(choice==='off')pushStatus.textContent='Вы выключили уведомления. Выбор сохранён.';
  else pushStatus.textContent='Уведомления выключены. Включение только по вашему выбору.';
  if(active) {
    try {
      const cfg=await pushConfig();
      await pushRequest('subscribe',subscription.toJSON());
      pushStatus.textContent='Подписка сохранена на сервере. Push работает без открытой страницы.';
    } catch {
      pushStatus.textContent='Разрешение есть, но сервер push недоступен. Фоновые уведомления пока не работают.';
    }
  }
}
pushToggle?.addEventListener('click',async()=>{
  pushToggle.disabled=true;
  try {
    const registration=await navigator.serviceWorker.ready;
    const subscription=await registration.pushManager.getSubscription();
    if(pushChoice()==='on' && subscription) {
      // If server removal fails, do not leave an active browser subscription.
      await pushRequest('unsubscribe',subscription.toJSON()).catch(()=>{});
      await subscription.unsubscribe();
      rememberPush('off');
    } else {
      // Do not trigger a browser permission prompt unless server is configured.
      const {publicKey}=await pushConfig();
      if(Notification.permission==='denied')throw new Error('Разрешение заблокировано в настройках браузера');
      const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
      if(permission!=='granted') {rememberPush('off');throw new Error('Разрешение не предоставлено');}
      const next=subscription || await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeVapid(publicKey)});
      try {await pushRequest('subscribe',next.toJSON());}
      catch(e){if(!subscription)await next.unsubscribe().catch(()=>{});throw e;}
      rememberPush('on');
    }
  } catch(e) {
    pushStatus.textContent=e instanceof Error?e.message:'Ошибка настройки push';
  } finally {
    await refreshPushUI().catch(()=>{pushToggle.disabled=false;});
  }
});
if(pushToggle) window.addEventListener('load',()=>{void refreshPushUI().catch(()=>{pushStatus.textContent='Не удалось проверить уведомления';pushToggle.disabled=false;pushToggle.textContent='Включить';})});
