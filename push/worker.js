// TrainBoard Web Push Worker. Deploy separately from Telegram worker.
// Required secrets: PUSH_PROXY_SECRET, VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, VAPID_SUBJECT.
// Required KV binding: PUSH_STATE. Cron trigger every 2 minutes.
const UPSTREAM='https://trainboard-freeman.patientbrownie8.chatgpt.site/api/schedule?stored=1';
const enc=new TextEncoder();
const b64url=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const un64=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(s.length/4)*4,'=')),c=>c.charCodeAt(0));
const concat=(...arr)=>{const out=new Uint8Array(arr.reduce((n,v)=>n+v.length,0));let i=0;for(const x of arr){out.set(x,i);i+=x.length;}return out;};
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const day=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).format(Date.now());
async function digest(value){return b64url(await crypto.subtle.digest('SHA-256',enc.encode(value)));}
async function equalSecret(a,b){if(!a||!b)return false;const x=enc.encode(a),y=enc.encode(b);if(x.length!==y.length)return false;let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;}
function safeEndpoint(value){
  try {
    if(typeof value!=='string'||value.length>2048)return false;
    const u=new URL(value),h=u.hostname.toLowerCase();
    const allowed=h==='fcm.googleapis.com'||h==='updates.push.services.mozilla.com'||h==='web.push.apple.com'||
      h.endsWith('.push.apple.com')||h.endsWith('.notify.windows.com')||h.endsWith('.push.services.mozilla.com');
    return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&allowed;
  }catch{return false;}
}
function validSub(s){
  return s&&typeof s==='object'&&safeEndpoint(s.endpoint)&&
    typeof s.keys?.p256dh==='string'&&typeof s.keys?.auth==='string'&&
    /^[a-zA-Z0-9_-]{80,120}$/.test(s.keys.p256dh)&&/^[a-zA-Z0-9_-]{18,40}$/.test(s.keys.auth)&&
    un64(s.keys.p256dh).length===65&&un64(s.keys.auth).length===16;
}
async function hkdf(key,salt,info,n){
  const ik=await crypto.subtle.importKey('raw',key,'HKDF',false,['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},ik,n*8));
}
async function vapid(env,audience){
  const pub=un64(env.VAPID_PUBLIC_KEY),priv=un64(env.VAPID_PRIVATE_KEY);
  if(pub.length!==65||pub[0]!==4||priv.length!==32)throw new Error('bad-vapid-key');
  const jwk={kty:'EC',crv:'P-256',x:b64url(pub.slice(1,33)),y:b64url(pub.slice(33,65)),d:b64url(priv),ext:false};
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const now=Math.floor(Date.now()/1000);
  const header=b64url(enc.encode(JSON.stringify({typ:'JWT',alg:'ES256'})));
  const payload=b64url(enc.encode(JSON.stringify({aud:audience,exp:now+3600,sub:env.VAPID_SUBJECT})));
  const unsigned=header+'.'+payload;
  const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,enc.encode(unsigned));
  return unsigned+'.'+b64url(signature);
}
async function encryptPush(subscription,notification){
  const client=un64(subscription.keys.p256dh),auth=un64(subscription.keys.auth);
  const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const server=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey));
  const remote=await crypto.subtle.importKey('raw',client,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:remote},pair.privateKey,256));
  const info=concat(enc.encode('WebPush: info\0'),client,server);
  const ikm=await hkdf(shared,auth,info,32);
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const cek=await hkdf(ikm,salt,enc.encode('Content-Encoding: aes128gcm\0'),16);
  const nonce=await hkdf(ikm,salt,enc.encode('Content-Encoding: nonce\0'),12);
  const cipherKey=await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['encrypt']);
  const plain=concat(enc.encode(JSON.stringify(notification)),new Uint8Array([2]));
  if(plain.length>3993)throw new Error('payload-too-large');
  const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,tagLength:128},cipherKey,plain));
  const record=new Uint8Array(4);new DataView(record.buffer).setUint32(0,4096);
  return concat(salt,record,new Uint8Array([65]),server,encrypted);
}
async function deliver(env,s,notice){
  const u=new URL(s.endpoint);
  const payload=await encryptPush(s,notice);
  const jwt=await vapid(env,u.origin);
  const response=await fetch(s.endpoint,{method:'POST',headers:{
    'TTL':'3600','Urgency':'normal','Content-Encoding':'aes128gcm',
    'Content-Type':'application/octet-stream',
    'Authorization':'vapid t='+jwt+', k='+env.VAPID_PUBLIC_KEY
  },body:payload,signal:AbortSignal.timeout(10000),redirect:'error'});
  return response.status;
}
function normalizeTrain(t){
  if(!t||typeof t!=='object'||!t.slotId)return null;
  const result={id:String(t.slotId),number:typeof t.number==='string'?t.number:null,
    time:typeof t.time==='string'?t.time:null,
    delay:Number.isFinite(t.delayMinutes)?t.delayMinutes:null,
    platform:t.platform==null?null:String(t.platform),
    track:t.track==null?null:String(t.track),
    status:typeof t.status==='string'?t.status:null};
  return result;
}
function changesBetween(old,next){
  if(!old||old.day!==next.day)return [];
  const prev=new Map(old.trains.map(t=>[t.id,t]));
  const current=new Map(next.trains.map(t=>[t.id,t]));
  const out=[];
  for(const [id,t] of current){
    const p=prev.get(id);
    if(!p){out.push('Добавлен поезд '+(t.number||id));continue;}
    const changed=['number','time','delay','platform','track','status'].filter(k=>p[k]!=null&&t[k]!=null&&p[k]!==t[k]);
    if(changed.length)out.push('Поезд '+(t.number||id)+': '+changed.map(k=>({
      number:'номер',time:'прибытие',delay:'задержка',platform:'платформа',track:'путь',status:'статус'
    })[k]).join(', '));
  }
  for(const [id,t] of prev)if(!current.has(id))out.push('Убран поезд '+(t.number||id));
  return out;
}
async function checkSchedule(env){
  const res=await fetch(UPSTREAM,{headers:{Accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!res.ok)throw new Error('schedule-fetch-'+res.status);
  const raw=await res.text();
  if(raw.length>1000000)throw new Error('schedule-too-large');
  const data=JSON.parse(raw),sn=data?.snapshot;
  if(data.fromStorage!==true||data.status!=='fresh'||sn?.date!==day()||!Array.isArray(sn.trains))throw new Error('schedule-not-fresh');
  const checked=Date.parse(sn.realtimeCheckedAt||sn.checkedAt);
  if(!Number.isFinite(checked)||Math.abs(Date.now()-checked)>10*60*1000)throw new Error('schedule-check-overdue');
  const next={day:sn.date,trains:sn.trains.map(normalizeTrain).filter(Boolean)};
  const old=await env.PUSH_STATE.get('push:baseline','json');
  const changes=changesBetween(old,next);
  await env.PUSH_STATE.put('push:baseline',JSON.stringify(next));
  if(!changes.length)return {changes:0,delivered:0};
  const notice={title:'TrainBoard · изменения поездов',body:changes.slice(0,7).join('\n')+(changes.length>7?'\nИ другие изменения':''),
    tag:'trainboard-'+next.day};
  let cursor,delivered=0,attempted=0;
  do{
    const page=await env.PUSH_STATE.list({prefix:'push:sub:',limit:200,...(cursor?{cursor}:{})});
    // Bounded fanout; next cron still compares a fresh baseline, so large deployments
    // should use a queue instead. This service targets small groups (<= 1000).
    const keys=page.keys.slice(0,Math.max(0,1000-attempted));
    for(let i=0;i<keys.length;i+=20){
      const batch=keys.slice(i,i+20);
      await Promise.all(batch.map(async entry=>{
        const s=await env.PUSH_STATE.get(entry.name,'json').catch(()=>null);
        if(!validSub(s)){await env.PUSH_STATE.delete(entry.name);return;}
        try{
          const status=await deliver(env,s,notice);
          if(status===404||status===410)await env.PUSH_STATE.delete(entry.name);
          if(status>=200&&status<300)delivered++;
        }catch(e){console.warn('push-delivery-failed',e?.message);}
      }));
    }
    attempted+=keys.length;
    cursor=page.list_complete?null:page.cursor;
  }while(cursor&&attempted<1000);
  return {changes:changes.length,delivered};
}
export default {
  async fetch(req,env){
    const path=new URL(req.url).pathname;
    if(!['/config','/subscribe','/unsubscribe'].includes(path))return json({error:'not-found'},404);
    if(!await equalSecret(req.headers.get('X-TrainBoard-Push-Key'),env.PUSH_PROXY_SECRET))return json({error:'unauthorized'},401);
    if(!env.PUSH_STATE||!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY||!env.VAPID_SUBJECT)return json({error:'not-configured'},503);
    if(path==='/config'&&req.method==='GET')return json({publicKey:env.VAPID_PUBLIC_KEY});
    if(!['/subscribe','/unsubscribe'].includes(path)||req.method!=='POST')return json({error:'method-not-allowed'},405);
    const raw=await req.text();
    if(raw.length>4096)return json({error:'too-large'},413);
    let sub;try{sub=JSON.parse(raw);}catch{return json({error:'invalid-json'},400);}
    if(!validSub(sub))return json({error:'invalid-subscription'},400);
    const key='push:sub:'+await digest(sub.endpoint);
    if(path==='/subscribe')await env.PUSH_STATE.put(key,JSON.stringify({endpoint:sub.endpoint,keys:{p256dh:sub.keys.p256dh,auth:sub.keys.auth}}));
    else await env.PUSH_STATE.delete(key);
    return json({ok:true});
  },
  async scheduled(_controller,env){
    try {const s=await checkSchedule(env);console.log('push-scan',JSON.stringify(s));}
    catch(e){console.error('push-scan-error',e?.message);}
  }
};
export {validSub,changesBetween,normalizeTrain};
