const SOURCE = 'https://trainboard-freeman.patientbrownie8.chatgpt.site/api/schedule?stored=1';
export async function onRequestGet() {
  let result;
  const started=Date.now();
  try {
    const response=await fetch(SOURCE,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000),redirect:'manual'});
    const type=response.headers.get('content-type')||'unknown';
    const text=await response.text();
    let jsonOk=false, hasSnapshot=false, apiStatus='unknown';
    try {const data=JSON.parse(text);jsonOk=true;hasSnapshot=Array.isArray(data?.snapshot?.trains);apiStatus=typeof data?.status==='string'?data.status:'unknown'} catch {}
    result={fetchOk:true,status:response.status,type,chars:text.length,jsonOk,hasSnapshot,apiStatus,elapsedMs:Date.now()-started};
  } catch(error) {
    result={fetchOk:false,errorName:String(error?.name||'unknown').slice(0,70),errorMessage:String(error?.message||'unknown').slice(0,160),elapsedMs:Date.now()-started};
  }
  return Response.json(result,{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}