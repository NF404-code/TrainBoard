import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const src=await readFile(new URL('./worker.js',import.meta.url),'utf8');
const worker=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
const {selectNearestAlert,handlePairing,recordDelivery,expireOwnCard}=worker;
const now=Math.floor(Date.parse('2026-11-22T08:00:00Z')/1000); // 09:00 Warsaw
const card=(key,arrivalClock,kind='live',ts=now-20)=>({key,kind,arrivalClock,ts,photo:{heading:key}});
const group=-1004399050706;

test('exactly one nearest upcoming changed train is selected',()=>{
  const q=[card('later','11:00'),card('nearest','09:06'),card('middle','09:40')];
  assert.equal(selectNearestAlert(q,now)?.key,'nearest');
});
test('live change wins a tie with a planned-change card',()=>{
  const q=[card('plan','09:05','plan'),card('live','09:05','live')];
  assert.equal(selectNearestAlert(q,now)?.key,'live');
});
test('outages, expired events and departed trains are never sent',()=>{
  const q=[card('outage','09:01','outage'),card('old-feed','09:02','live',now-12*60),card('departed','06:00','plan')];
  assert.equal(selectNearestAlert(q,now),null);
});
test('initial pairing is completely silent',async()=>{
  const calls=[],s={};
  const api=async(method,opts)=>{
    calls.push(method);
    assert.equal(method,'getUpdates');
    return [{update_id:5,message:{
      chat:{id:group,type:'supergroup'},from:{id:876976709,is_bot:false},
      text:'/trainboard_start@assistantbratishka_bot',
      entities:[{type:'bot_command',offset:0,length:39}],date:now
    }}];
  };
  const saved=[];
  assert.equal(await handlePairing(api,s,async force=>saved.push(force),now),true);
  assert.deepEqual(calls,['getUpdates']);
  assert.equal(s.enabled,true);
  assert.equal(s.chat.id,group);
  assert.deepEqual(s.queue,[]);
  assert.deepEqual(saved,[true]);
});
test('stop pairing does not send a text or a test card',async()=>{
  const s={enabled:true,chat:{id:group,thread:null}};
  const calls=[];
  const api=async method=>{
    calls.push(method);
    return [{update_id:8,message:{
      chat:{id:group,type:'supergroup'},from:{id:876976709,is_bot:false},
      text:'/trainboard_stop@assistantbratishka_bot',
      entities:[{type:'bot_command',offset:0,length:38}],date:now
    }}];
  };
  assert.equal(await handlePairing(api,s,async()=>{},now),true);
  assert.equal(s.enabled,false);
  assert.deepEqual(calls,['getUpdates']);
});
test('successful new photo persists its message ID and removes previous bot photo',async()=>{
  const s={chat:{id:group,thread:null},ownMessage:{chat:{id:group,thread:null},id:100,at:now-60},pendingDelete:[]};
  const calls=[],writes=[];
  const api=async(method,args)=>{calls.push([method,args]);return true};
  await recordDelivery(api,s,async force=>writes.push({force,id:s.ownMessage?.id}),s.chat,{message_id:101},now);
  assert.equal(s.ownMessage.id,101);
  assert.deepEqual(calls,[['deleteMessage',{chat_id:group,message_id:100}]]);
  assert.deepEqual(s.pendingDelete,[]);
  assert.equal(writes[0].id,101);
});
test('failed cleanup preserves retry information and does not delete user messages',async()=>{
  const s={chat:{id:group,thread:null},ownMessage:{chat:{id:group,thread:null},id:100,at:now-10}};
  const api=async()=>{throw new Error('temporary failure')};
  await recordDelivery(api,s,async()=>{},s.chat,{message_id:101},now);
  assert.equal(s.ownMessage.id,101);
  assert.equal(s.pendingDelete.length,1);
  assert.equal(s.pendingDelete[0].id,100);
});
test('old bot card is removed before Telegram 48h deletion deadline',async()=>{
  const s={chat:{id:group,thread:null},ownMessage:{chat:{id:group,thread:null},id:100,at:now-47*3600-10}};
  let called=0;
  await expireOwnCard(async()=>{called++;return true},s,now);
  assert.equal(called,1);
  assert.equal(s.ownMessage,null);
});
