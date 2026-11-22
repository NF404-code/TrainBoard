let registration;

function say(message) {
  try { globalThis.alert?.(message); } catch { /* alert unavailable */ }
}

// Returns true when notifications are usable. With ask=true every failure path
// tells the user why (before, several paths returned silently after a button tap).
export async function setupNotifications(ask = false) {
  if (!('serviceWorker' in navigator)) {
    if (ask) say('В этом браузере уведомления приложения недоступны. Расписание продолжит обновляться при открытой странице.');
    return false;
  }

  try {
    registration ||= await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    if (!ask) return true;

    if (!('Notification' in globalThis)) {
      say('Этот браузер не поддерживает уведомления. На iPhone добавьте сайт на экран «Домой» и откройте его оттуда.');
      return false;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      say('Уведомления не разрешены. Настройку можно изменить в браузере.');
      return false;
    }

    if ('periodicSync' in registration) {
      try {
        await registration.periodicSync.register('trainboard-schedule', {
          minInterval: 30 * 60 * 1000
        });
      } catch {
        /* Browser may require an installed app and user engagement. */
      }
    }

    say('Уведомления включены для подтверждённых изменений расписания. При закрытом приложении фоновые проверки зависят от возможностей браузера.');
    return true;
  } catch {
    if (ask)
      say('В этом браузере уведомления приложения недоступны. Расписание продолжит обновляться при открытой странице.');
    return false;
  }
}

// Best-effort: callers use `void notifyScheduleChanges(...)`, so it must never reject.
export async function notifyScheduleChanges(previous, current) {
  try {
    if (
      !previous ||
      !current ||
      previous.date !== current.date ||
      current.realtimeStatus !== 'fresh' ||
      !Array.isArray(previous.trains) ||
      !Array.isArray(current.trains) ||
      globalThis.Notification?.permission !== 'granted'
    ) return;

    const changes = current.trains.filter(t => {
      const old = previous.trains.find(
        o => o.slotId === t.slotId && o.serviceDate === t.serviceDate
      );

      return old &&
        Number.isFinite(old.delayMinutes) &&
        Number.isFinite(t.delayMinutes) &&
        old.delayMinutes !== t.delayMinutes;
    });

    if (!changes.length) return;

    const worker = registration ||
      await navigator.serviceWorker?.getRegistration();
    if (!worker) return;

    await worker.showNotification('TrainBoard · изменение расписания', {
      body: changes.map(t => {
        const name = ['Leo Express', t.number].filter(Boolean).join(' ');
        return `${name}: ${t.time}, ${t.delayMinutes > 0 ? '+' : ''}${t.delayMinutes} мин`;
      }).join('\n'),
      tag: 'trainboard-schedule-' + current.date,
      renotify: true, // same tag replaces the old one; without this the update is silent
      icon: '/icon.svg',
      data: { url: '/' },
    });
  } catch {
    /* A failed notification must not break schedule refresh. */
  }
}