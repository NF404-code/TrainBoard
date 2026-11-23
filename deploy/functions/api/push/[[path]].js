// Same-origin proxy to the dedicated Cloudflare Web Push Worker.
// Never expose PUSH_PROXY_SECRET to the browser.
const service='https://trainboard-web-push.slavchenkoyurii.workers.dev';
export async function onRequest(context){
  const {request,env}=context;
  const url=new URL(request.url),method=request.method;
  const action=url.pathname.split('/').pop();
  if(!['config','subscribe','unsubscribe'].includes(action))return new Response('Not found',{status:404});
  if((action==='config'&&method!=='GET')||(action!=='config'&&method!=='POST'))return new Response('Method not allowed',{status:405});
  if(!env.PUSH_PROXY_SECRET)return Response.json({error:'push-not-configured'},{status:503});
  if(request.headers.get('content-length')&&Number(request.headers.get('content-length'))>4096)return new Response('Payload too large',{status:413});
  const body=method==='POST'?await request.text():undefined;
  if(body?.length>4096)return new Response('Payload too large',{status:413});
  try{
    const result=await fetch(service+'/'+action,{method,headers:{'X-TrainBoard-Push-Key':env.PUSH_PROXY_SECRET,
      ...(method==='POST'?{'Content-Type':'application/json'}:{})},body,redirect:'error',signal:AbortSignal.timeout(10000)});
    return new Response(result.body,{status:result.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }catch{return Response.json({error:'push-service-unreachable'},{status:502});}
}
