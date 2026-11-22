import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHmac, randomUUID } from 'node:crypto';
const directory=await mkdtemp(join(tmpdir(),'copilote-billing-'));
process.env.COPILOTE_DB_PATH=join(directory,'test.sqlite');
process.env.BILLING_ENABLED='true';process.env.NODE_ENV='test';
process.env.TRIAL_IDENTITY_SECRET='test-only-stable-identity-secret-12345';
const {db}=await import('../accounts.js');
await import('../billing.js');
const {verifyEmail,acceptDocuments}=await import('../registration.js');
const {reserve,settle,quotaStatus,grant,meteredClient,meterContext}=await import('../quotas.js');
const {verifiedEvent,processEvent}=await import('../payments.js');
const {limitRequests}=await import('../security.js');
after(async()=>{db.close();await rm(directory,{recursive:true});});
function account(email=randomUUID()+'@example.test',verified=true) {
  const id=Number(db.prepare('INSERT INTO users(email,salt,password_hash,billing_reference) VALUES(?,?,?,?)').run(email,'salt','hash',randomUUID()).lastInsertRowid);
  acceptDocuments(id);if(verified)verifyEmail(id);return id;
}
const request=(id,path='/api/answer',extra={})=>({user:{id},path,body:{},...extra});
const audio=(id,seconds)=>reserve(request(id,'/api/transcribe',{audioSeconds:seconds}),'audio',{model:'gpt-4o-transcribe'});
const finish=r=>settle(r,{usage:{prompt_tokens:10,completion_tokens:10}});
test('un essai par adresse, après vérification, sans remise à zéro après suppression',()=>{
  const email=randomUUID()+'@example.test',id=account(email,false);
  assert.throws(()=>reserve(request(id),'chat',{model:'gpt-4.1-mini'}),e=>e.status===403);
  verifyEmail(id);assert.equal(quotaStatus(id).remaining_seconds,900);
  verifyEmail(id);assert.equal(quotaStatus(id).allowances.length,1);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  const recreated=account(email);
  assert.equal(quotaStatus(recreated).remaining_seconds,0);
});
test('les cinq questions gratuites et les réservations simultanées sont plafonnées',()=>{
  const id=account();
  for(let i=0;i<5;i++)finish(reserve(request(id),'chat',{model:'gpt-4.1-mini',max_completion_tokens:100}));
  assert.throws(()=>reserve(request(id),'chat',{model:'gpt-4.1-mini'}),e=>e.status===402);
  const other=account();const first=audio(other,600);
  assert.throws(()=>audio(other,301),e=>e.status===402);
  settle(first,null,'failed');assert.equal(quotaStatus(other).remaining_seconds,900);
});
test('le décompte vocal et écrit évite le double débit, les reçus restent privés et uniques',()=>{
  const id=account(),other=account();const receipt=audio(id,30);finish(receipt);
  const voiced=reserve(request(id,'/api/training/feedback',{body:{speech_receipts:[receipt.id]}}),'chat',{model:'gpt-4.1-mini'});finish(voiced);
  assert.equal(quotaStatus(id).remaining_seconds,870);
  finish(reserve(request(id,'/api/training/feedback',{body:{speech_receipts:[receipt.id]}}),'chat',{model:'gpt-4.1-mini'}));
  assert.equal(quotaStatus(id).remaining_seconds,810);
  finish(reserve(request(other,'/api/training/feedback',{body:{speech_receipts:[receipt.id]}}),'chat',{model:'gpt-4.1-mini'}));
  assert.equal(quotaStatus(other).remaining_seconds,840);
});
test('les paramètres modifiés en base s’appliquent immédiatement et le plafond quotidien couvre les offres cumulées',()=>{
  const id=account(),now=Date.now();grant(id,'pro','test:'+id,now-1000,now+86400000);
  finish(audio(id,1800));assert.throws(()=>audio(id,1),e=>e.status===429);
  db.prepare("UPDATE plans SET daily_audio_minutes=31 WHERE id='pro'").run();
  finish(audio(id,30));assert.equal(quotaStatus(id).daily_audio_seconds,1830);
  db.prepare("UPDATE plans SET daily_audio_minutes=30 WHERE id='pro'").run();
  db.prepare('UPDATE entitlements SET ends=? WHERE user_id=?').run(now-1,id);
  assert.throws(()=>audio(id,1),e=>e.status===402||e.status===429);
});
test('un budget insuffisant empêche réellement l’appel fournisseur',async()=>{
  const id=account();db.prepare('UPDATE usage SET state=state').run();
  db.prepare("UPDATE plans SET cost_limit_usd=0 WHERE id='free'").run();
  let calls=0;const fn=async()=>{calls++;return {usage:{prompt_tokens:1,completion_tokens:1}};};
  const client=meteredClient({chat:{completions:{create:fn}},audio:{transcriptions:{create:fn}},responses:{create:fn},images:{edit:fn}});
  await assert.rejects(()=>meterContext.run(request(id),()=>client.chat.completions.create({model:'gpt-4.1'})),e=>e.status===402);
  assert.equal(calls,0);db.prepare("UPDATE plans SET cost_limit_usd=1 WHERE id='free'").run();
});
test('les limites de fréquence survivent à la recréation du middleware',()=>{
  const req={ip:'test-ip',method:'POST',baseUrl:'/api',route:{path:'/login'}},res={set(){},status(code){this.code=code;return this;},json(){}};
  let count=0;const options={limit:1,windowMs:60000};
  limitRequests(options)(req,res,()=>count++);limitRequests(options)(req,res,()=>count++);
  assert.equal(count,1);assert.equal(res.code,429);
});
test('signature Stripe : corps altéré, signature fausse et expiration refusés',()=>{
  const body=Buffer.from('{"id":"evt_1"}'),now=Date.now(),t=Math.floor(now/1000),secret='whsec_test';
  const sig=createHmac('sha256',secret).update(t+'.').update(body).digest('hex');
  assert.equal(verifiedEvent(body,`t=${t},v1=${sig}`,secret,now).id,'evt_1');
  assert.equal(verifiedEvent(Buffer.from('{}'),`t=${t},v1=${sig}`,secret,now),null);
  assert.equal(verifiedEvent(body,`t=${t},v1=wrong`,secret,now),null);
  assert.equal(verifiedEvent(body,`t=${t},v1=${sig}`,secret,now+301000),null);
});
test('Pass payé : livraison idempotente, pas de crédit avant confirmation du paiement',async()=>{
  const id=account(),ref=db.prepare('SELECT billing_reference FROM users WHERE id=?').get(id).billing_reference;
  db.prepare("UPDATE plans SET stripe_price_id='price_sprint' WHERE id='sprint'").run();
  const checkout={id:'cs_test_sprint',mode:'payment',payment_status:'paid',currency:'eur',metadata:{copilote_reference:ref},line_items:{data:[{price:{id:'price_sprint'}}]}};
  let calls=0;const provider=async()=>{calls++;return checkout;};
  const event={id:'evt_sprint',type:'checkout.session.completed',created:Math.floor(Date.now()/1000),data:{object:{id:checkout.id}}};
  await processEvent(event,provider);await processEvent(event,provider);
  assert.equal(calls,1);assert.equal(db.prepare("SELECT count(*) n FROM entitlements WHERE user_id=? AND plan_id='sprint'").get(id).n,1);
  checkout.id='cs_test_pending';checkout.payment_status='unpaid';
  await processEvent({...event,id:'evt_unpaid',data:{object:{id:checkout.id}}},provider);
  assert.equal(db.prepare("SELECT count(*) n FROM entitlements WHERE user_id=? AND plan_id='sprint'").get(id).n,1);
});
test('abonnement : période payée, renouvellement sans report et événement ancien ignoré',async()=>{
  const id=account(),ref=db.prepare('SELECT billing_reference FROM users WHERE id=?').get(id).billing_reference,now=Math.floor(Date.now()/1000);
  db.prepare("UPDATE plans SET stripe_price_id='price_pro' WHERE id='pro'").run();
  const subscription={id:'sub_test',customer:'cus_test',status:'active',metadata:{copilote_reference:ref},latest_invoice:{status:'paid'},items:{data:[{price:{id:'price_pro'},current_period_start:now-100,current_period_end:now+86400}]}};
  const event={id:'evt_sub',type:'invoice.paid',created:now,data:{object:{subscription:'sub_test'}}};
  await processEvent(event,async()=>subscription);
  const initial=db.prepare("SELECT id FROM entitlements WHERE user_id=? AND plan_id='pro'").get(id).id;
  finish(audio(id,60));
  await processEvent({...event,id:'evt_sub_duplicate_semantic'},async()=>subscription);
  assert.equal(db.prepare("SELECT count(*) n FROM entitlements WHERE user_id=? AND plan_id='pro'").get(id).n,1);
  subscription.status='canceled';
  await processEvent({...event,id:'evt_cancel',type:'customer.subscription.deleted',created:now+2,data:{object:{id:'sub_test'}}},async()=>subscription);
  subscription.status='active';
  await processEvent({...event,id:'evt_old',created:now+1},async()=>subscription);
  assert.equal(db.prepare('SELECT active FROM entitlements WHERE id=?').get(initial).active,0);
  subscription.items.data[0].current_period_start=now-50;
  subscription.items.data[0].current_period_end=now+31*86400;
  await processEvent({...event,id:'evt_renewal',created:now+3},async()=>subscription);
  const current=quotaStatus(id).allowances.find(x=>x.plan_id==='pro');
  assert.notEqual(current.id,initial);assert.equal(current.remaining_seconds,400*60);assert.equal(current.used.seconds,0);
});

test("le point HTTP webhook vérifie le corps brut sans session utilisateur",async()=>{
 const express=(await import("express")).default;
 const {registerPaymentsWebhook}=await import("../payments.js");
 process.env.STRIPE_SECRET_KEY="sk_test_fixture";process.env.STRIPE_WEBHOOK_SECRET="whsec_fixture";process.env.APP_BASE_URL="http://localhost:3100";
 const app=express();registerPaymentsWebhook(app);
 const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
 try{
   const body=JSON.stringify({id:"evt_http",type:"test.ignored",created:Math.floor(Date.now()/1000)}),time=Math.floor(Date.now()/1000);
   const signature=createHmac("sha256","whsec_fixture").update(time+"."+body).digest("hex");
   const post=signature=>fetch("http://127.0.0.1:"+server.address().port+"/api/billing/webhook",{method:"POST",headers:{"Content-Type":"application/json","stripe-signature":signature},body});
   assert.equal((await post("wrong")).status,400);
   assert.equal((await post(`t=${time},v1=${signature}`)).status,204);
   assert.equal((await post(`t=${time},v1=${signature}`)).status,204);
   assert.equal(db.prepare("SELECT count(*) n FROM stripe_events WHERE id='evt_http'").get().n,1);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test("l’e-mail de vérification arrive au SMTP local avec un secret seulement haché en base",async()=>{
 const {createServer}=await import("node:net");
 const {createHash}=await import("node:crypto");
 const {sendVerification}=await import("../registration.js");
 let message="",receiving=false;
 const server=createServer(socket=>{
   socket.write("220 localhost SMTP test\r\n");
   let pending="";
   socket.on("data",data=>{
     pending+=data.toString();
     for(;;){const index=pending.indexOf("\r\n");if(index<0)break;const line=pending.slice(0,index);pending=pending.slice(index+2);
       if(receiving){if(line==="."){receiving=false;socket.write("250 accepted\r\n");}else message+=line+"\r\n";}
       else if(/^EHLO|^HELO/.test(line))socket.write("250 localhost\r\n");
       else if(/^DATA/.test(line)){receiving=true;socket.write("354 send data\r\n");}
       else if(/^QUIT/.test(line)){socket.end("221 bye\r\n");}
       else socket.write("250 ok\r\n");
     }
   });
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const keys=["SMTP_HOST","SMTP_PORT","SMTP_FROM","SMTP_USER","SMTP_PASSWORD","APP_BASE_URL"],before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{SMTP_HOST:"127.0.0.1",SMTP_PORT:String(server.address().port),SMTP_FROM:"Test <test@example.test>",SMTP_USER:"",SMTP_PASSWORD:"",APP_BASE_URL:"http://localhost:3100"});
 try {
   const id=account(undefined,false);assert.equal(await sendVerification(id),true);
   const token=message.replace(/=\r?\n/g,"").match(/verification\.html#([a-f0-9]{64})/)?.[1];assert.ok(token);
   const stored=db.prepare("SELECT token_hash FROM email_verifications WHERE user_id=?").get(id);
   assert.equal(stored.token_hash,createHash("sha256").update(token).digest("hex"));assert.notEqual(stored.token_hash,token);
 }finally{for(const k of keys){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}await new Promise(resolve=>server.close(resolve));}
});

test('Checkout Pass et abonnement : prix vérifié, consentement, réessai idempotent et portail privé',async()=>{
  const express=(await import('express')).default;
  const {createServer}=await import('node:http');
  const {createHash,randomBytes}=await import('node:crypto');
  const {registerBilling}=await import('../billing.js');
  const requests=[];let wrongPrice=true;
  const provider=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=new URLSearchParams(Buffer.concat(chunks).toString());
    requests.push({url:req.url,body,key:req.headers['idempotency-key']});
    res.setHeader('Content-Type','application/json');
    if(req.url.startsWith('/prices/'))res.end(JSON.stringify({active:true,currency:'eur',tax_behavior:'inclusive',unit_amount:wrongPrice?1:req.url.endsWith('pro')?2900:900,...(req.url.endsWith('pro')?{recurring:{interval:'month',interval_count:1}}:{})}));
    else res.end(JSON.stringify({url:'https://checkout.stripe.com/test-fixture'}));
  });
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  const previous=process.env.STRIPE_TEST_API_URL;
  process.env.STRIPE_TEST_API_URL='http://127.0.0.1:'+provider.address().port+'/';
  const app=express();app.use(express.json());registerBilling(app);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const login=id=>{
    const token=randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000);
    return 'copilote_session='+token;
  };
  const post=(path,cookie,body={})=>fetch('http://127.0.0.1:'+server.address().port+path,{method:'POST',headers:{'Content-Type':'application/json',cookie},body:JSON.stringify(body)});
  try {
    const id=account(),cookie=login(id),subscriptionUser=account(),other=login(subscriptionUser);
    assert.equal((await post('/api/billing/checkout',cookie,{plan:'sprint'})).status,400);
    assert.equal(requests.length,0);
    assert.equal((await post('/api/billing/checkout',cookie,{plan:'sprint',accept_cgv:true})).status,503);
    wrongPrice=false;
    for(let i=0;i<2;i++)assert.equal((await post('/api/billing/checkout',cookie,{plan:'sprint',accept_cgv:true})).status,200);
    const checkouts=requests.filter(r=>r.url==='/checkout/sessions');
    assert.equal(checkouts.length,2);assert.equal(checkouts[0].key,checkouts[1].key);
    assert.equal(checkouts[0].body.get('mode'),'payment');
    assert.equal(checkouts[0].body.get('line_items[0][price]'),'price_sprint');
    assert.equal(db.prepare("SELECT count(*) n FROM entitlements WHERE user_id=? AND plan_id='sprint'").get(id).n,0);
    assert.equal((await post('/api/billing/checkout',other,{plan:'pro',accept_cgv:true})).status,200);
    assert.equal(requests.at(-1).body.get('mode'),'subscription');
    assert.ok(requests.at(-1).body.get('subscription_data[metadata][copilote_reference]'));
    assert.equal((await post('/api/billing/portal',cookie)).status,404);
    db.prepare('INSERT INTO subscriptions(id,user_id,customer,plan,status,event_time) VALUES(?,?,?,?,?,?)').run('sub_portal',subscriptionUser,'cus_portal','pro','active',Date.now());
    assert.equal((await post('/api/billing/portal',other)).status,200);
    assert.equal(requests.at(-1).body.get('customer'),'cus_portal');
  }finally{
    if(previous===undefined)delete process.env.STRIPE_TEST_API_URL;else process.env.STRIPE_TEST_API_URL=previous;
    await Promise.all([new Promise(resolve=>server.close(resolve)),new Promise(resolve=>provider.close(resolve))]);
  }
});
