// TrainBoard public saved schedule proxy — standalone Cloudflare Pages Function.
// Fixed upstream; read-only, no secrets and no user supplied URLs.
const UPSTREAM = 'https://trainboard-freeman.patientbrownie8.chatgpt.site/api/schedule?stored=1';
const HEADERS = {
  'Cache-Control':'no-store',
  'Content-Type':'application/json; charset=utf-8',
  'X-Content-Type-Options':'nosniff'
};
function fail(message) {
  return new Response(JSON.stringify({error:message}),{status:502,headers:HEADERS});
}
export async function onRequestGet() {
  try {
    const upstream = await fetch(UPSTREAM,{
      method:'GET',
      headers:{Accept:'application/json'},
      redirect:'manual',
      signal:AbortSignal.timeout(12000)
    });
    if (upstream.status!==200) return fail('Источник расписания временно недоступен');
    const content = await upstream.text();
    if (content.length > 1_000_000) return fail('Ответ источника слишком велик');
    let data;
    try {data=JSON.parse(content)} catch {return fail('Источник вернул некорректные данные')}
    if (!data || typeof data!=='object'|| !data.snapshot || !Array.isArray(data.snapshot.trains))
      return fail('Расписание источника недоступно');
    return new Response(JSON.stringify(data),{status:200,headers:HEADERS});
  } catch {
    return fail('Не удалось получить расписание');
  }
}
