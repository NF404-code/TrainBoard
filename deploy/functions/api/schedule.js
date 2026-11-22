// Cloudflare Pages Function. The upstream is fixed to prevent open proxy abuse.
// No production credentials or Cloudflare bindings are required for this read-only proxy.
const URL_SOURCE = 'https://trainboard-freeman.patientbrownie8.chatgpt.site/api/schedule?stored=1';
const headers = {
  'Cache-Control':'no-store',
  'Content-Type':'application/json; charset=utf-8',
  'X-Content-Type-Options':'nosniff'
};
const failure = (status, reason) => new Response(JSON.stringify({error:reason}), {status, headers});
export async function onRequestGet() {
  try {
    const upstream = await fetch(URL_SOURCE, {
      method:'GET',
      headers:{Accept:'application/json'},
      redirect:'error',
      signal:AbortSignal.timeout(15000)
    });
    if (!upstream.ok) return failure(502,'Источник недоступен');
    const body = await upstream.text();
    if (body.length > 1_000_000) return failure(502,'Слишком большой ответ источника');
    let data;
    try { data = JSON.parse(body); } catch { return failure(502,'Некорректный JSON источника'); }
    if (!data || typeof data !== 'object' || !data.snapshot || !Array.isArray(data.snapshot.trains)) {
      return failure(502,'Нет сохранённого расписания');
    }
    return new Response(JSON.stringify(data),{status:200,headers});
  } catch {
    return failure(502,'Не удалось проверить расписание');
  }
}
