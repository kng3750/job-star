const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const request=require('supertest');
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs/promises'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {randomBytes,randomUUID,createHash}=require('node:crypto');
const {createApp:createStar}=require('../server/app');
const centralPath=process.env.CENTRAL_PROJECT_PATH||path.resolve(__dirname,'../../../job-counseling-main/job-counseling-main');
let database,db,central,star,centralServer,starServer,sec,cfg,origin,userId,centralCookie,adminCookie,adminCsrf;
const password='Integration-test-123456',clientSecret=randomBytes(32).toString('base64url');
const hash=v=>createHash('sha256').update(v).digest('hex');
const cookies=r=>(r.headers['set-cookie']||[]).map(c=>c.split(';')[0]).join('; ');
const post=(route,body,cookie)=>{let r=request(central).post(route).set('Origin',origin);if(cookie)r=r.set('Cookie',cookie);return r.send(body);};
const listen=app=>new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
async function login(id,p=password){
 const r=await post('/api/auth/login',{login:id,password:p});assert.equal(r.status,200,JSON.stringify(r.body));return cookies(r);
}
async function me(cookie){return (await request(central).get('/api/auth/me').set('Cookie',cookie)).body;}
async function sso(cookie=centralCookie){
 const begin=await request(star).get('/login');assert.equal(begin.status,302);
 const authUrl=new URL(begin.headers.location);
 const code=await request(central).get(authUrl.pathname+authUrl.search).set('Cookie',cookie);
 assert.equal(code.status,302,JSON.stringify(code.body));
 const callbackUrl=new URL(code.headers.location);
 const done=await request(star).get(callbackUrl.pathname+callbackUrl.search).set('Cookie',cookies(begin));
 assert.equal(done.status,302,JSON.stringify(done.body));assert.equal(done.headers.location,'/app');
 return cookies(done).split('; ').filter(c=>c.startsWith('jobstar-session=')).join('; ');
}
const clientHeader=(secret=clientSecret,id='job-star')=>'Basic '+Buffer.from(id+':'+secret).toString('base64');
async function codeRequest(){
 const verifier=randomBytes(32).toString('base64url');
 const q=new URLSearchParams({client_id:'job-star',redirect_uri:cfg.redirectUri,response_type:'code',scope:'job-star',state:randomBytes(32).toString('hex'),code_challenge:Buffer.from(hash(verifier),'hex').toString('base64url'),code_challenge_method:'S256'});
 const r=await request(central).get('/oauth/authorize?'+q).set('Cookie',centralCookie);
 assert.equal(r.status,302,JSON.stringify(r.body));
 return {code:new URL(r.headers.location).searchParams.get('code'),verifier,q};
}
before(async()=>{
 process.env.ID_ENCRYPTION_KEY=randomBytes(32).toString('base64');process.env.ID_LOOKUP_KEY=randomBytes(32).toString('base64');
 sec=await import(pathToFileURL(path.join(centralPath,'server/security.js')));
 const {createApp}=await import(pathToFileURL(path.join(centralPath,'server/app.js')));
 database=new PGlite();await database.exec(await fs.readFile(path.join(centralPath,'server/schema.sql'),'utf8'));await database.exec(await fs.readFile(path.join(centralPath,'server/sso-schema.sql'),'utf8'));
 db={query:(...args)=>database.query(...args),connect:async()=>({query:(...args)=>database.query(...args),release(){}})};
 central=createApp({db});centralServer=await listen(central);origin='http://127.0.0.1:'+centralServer.address().port;process.env.APP_ORIGIN=origin;
 cfg={origin:'',authOrigin:origin,clientId:'job-star',clientSecret,redirectUri:'',production:false};
 star=createStar({config:cfg,generator:async(feature,input)=>{
  if(input.fail)throw Object.assign(new Error('upstream'),{statusCode:502});
  return {feature,title:'테스트 생성',result:'테스트 결과 <img src=x onerror=alert(1)>'};
 }});
 starServer=await listen(star);cfg.origin='http://127.0.0.1:'+starServer.address().port;cfg.redirectUri=cfg.origin+'/auth/callback';
 await db.query('INSERT INTO sso_clients(id,secret_hash,redirect_uri) VALUES($1,$2,$3)',['job-star',hash(clientSecret),cfg.redirectUri]);
 await db.query("INSERT INTO users(id,login_cipher,login_lookup,password_hash,name,role,status) VALUES($1,$2,$3,$4,'통합 관리자','admin','approved')",[randomUUID(),sec.encrypt('admin.test'),sec.lookup('admin.test'),await sec.hashPassword(password)]);
 adminCookie=await login('admin.test');adminCsrf=(await me(adminCookie)).csrfToken;
});
after(async()=>{await Promise.all([new Promise(r=>centralServer.close(r)),new Promise(r=>starServer.close(r))]);await database.close();});
test('public files cannot expose protected workflows and prompts',async()=>{
 for(const route of ['/app','/script.js','/assets/app.js'])assert.equal((await request(star).get(route)).status,302);
 for(const route of ['/prompts.js','/private/index.html','/server/gemini.js','/api/_gemini'])assert.equal((await request(star).get(route)).status,404);
 assert.deepEqual((await request(star).get('/api/health')).body,{status:'ok'});
 assert.equal((await request(star).post('/api/generate').send({})).status,401);
});
test('signup and approval live only in central system',async()=>{
 await post('/api/auth/register',{login:'shared.user',password,confirmPassword:password,name:'통합 사용자'});
 const user=(await db.query('SELECT * FROM users WHERE login_lookup=$1',[sec.lookup('shared.user')])).rows[0];userId=user.id;
 assert.equal(user.status,'pending');assert.equal((await post('/api/auth/login',{login:'shared.user',password})).status,403);
 assert.equal((await request(central).patch('/api/admin/users/'+userId).set('Origin',origin).set('Cookie',adminCookie).set('X-CSRF-Token',adminCsrf).send({status:'approved'})).status,200);
 centralCookie=await login('shared.user');assert.equal((await request(central).get('/app').set('Cookie',centralCookie)).status,200);
});
test('unauthenticated SSO returns to central login and preserves exact authorize request',async()=>{
 const begin=await request(star).get('/login'),url=new URL(begin.headers.location);
 const r=await request(central).get(url.pathname+url.search);assert.equal(r.status,302);
 const returnTo=new URL(r.headers.location,origin).searchParams.get('returnTo');assert.equal(returnTo,url.pathname+url.search);
 const logged=await post('/api/auth/login',{login:'shared.user',password,returnTo});assert.equal(logged.body.redirect,returnTo);
 const bad=await post('/api/auth/login',{login:'shared.user',password,returnTo:'https://evil.example/'});assert.equal(bad.body.redirect,'/app');
});
test('PKCE SSO creates centrally stored site session; Star never receives member keys',async()=>{
 const cookie=await sso();
 const r=await request(star).get('/api/auth/me').set('Cookie',cookie);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.name,'통합 사용자');assert.equal(r.body.role,'user');
 assert.equal((await request(star).get('/app').set('Cookie',cookie)).status,200);
 assert.equal((await request(star).get('/admin').set('Cookie',cookie)).status,403);
 const rows=(await db.query('SELECT * FROM service_sessions')).rows;assert.ok(rows.length>0);
 assert.ok(!rows.some(row=>row.token_hash===cookie.split('=')[1]));
 assert.equal((await request(star).get('/assets/app.js').set('Cookie',cookie)).headers['cache-control'],'no-store');
 assert.doesNotMatch(await fs.readFile(path.join(__dirname,'../server/auth.js'),'utf8'),/ID_ENCRYPTION_KEY|ID_LOOKUP_KEY|DATABASE_URL/);
});
test('all six generated workflows require current session and CSRF; upstream error has no fallback',async()=>{
 const cookie=await sso(),details=(await request(star).get('/api/auth/me').set('Cookie',cookie)).body;
 for(const feature of ['counselingLog','interviewQA','interviewFeedback','followUpPlan','caseClosure','strategyPivot']){
  const r=await request(star).post('/api/generate').set('Origin',cfg.origin).set('Cookie',cookie).set('X-CSRF-Token',details.csrfToken).send({feature,input:{participantInfo:'테스트'}});
  assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.feature,feature);
 }
 assert.equal((await request(star).post('/api/generate').set('Origin',cfg.origin).set('Cookie',cookie).send({})).status,403);
 const fail=await request(star).post('/api/generate').set('Origin',cfg.origin).set('Cookie',cookie).set('X-CSRF-Token',details.csrfToken).send({feature:'counselingLog',input:{fail:true}});
 assert.equal(fail.status,502);assert.equal(fail.body.result,undefined);assert.match(fail.body.error,/호출 실패/);
});
test('redirect substitution, missing PKCE, wrong state and absent client auth are blocked',async()=>{
 const c=await codeRequest();c.q.set('redirect_uri','https://evil.example/callback');
 assert.equal((await request(central).get('/oauth/authorize?'+c.q).set('Cookie',centralCookie)).status,400);
 c.q.set('redirect_uri',cfg.redirectUri);c.q.delete('code_challenge');
 assert.equal((await request(central).get('/oauth/authorize?'+c.q).set('Cookie',centralCookie)).status,400);
 assert.equal((await request(central).post('/oauth/token').type('form').send({grant_type:'authorization_code',code:c.code,code_verifier:c.verifier,redirect_uri:cfg.redirectUri,client_id:'job-star'})).status,401);
 const begin=await request(star).get('/login');
 assert.equal((await request(star).get('/auth/callback?code='+c.code+'&state=wrong').set('Cookie',cookies(begin))).status,400);
});
test('authorization code is single use and wrong verifier consumes it',async()=>{
 const c=await codeRequest();
 const exchange=(code,verifier)=>request(central).post('/oauth/token').set('Authorization',clientHeader()).type('form').send({grant_type:'authorization_code',code,code_verifier:verifier,redirect_uri:cfg.redirectUri});
 assert.equal((await exchange(c.code,c.verifier)).status,200);
 assert.equal((await exchange(c.code,c.verifier)).status,400);
 const bad=await codeRequest();assert.equal((await exchange(bad.code,randomBytes(32).toString('base64url'))).status,400);
 assert.equal((await exchange(bad.code,bad.verifier)).status,400);
});
test('tokens are bound to registered client and invalid client secret is rejected',async()=>{
 const cookie=await sso(),token=cookie.split('=')[1];
 await db.query('INSERT INTO sso_clients(id,secret_hash,redirect_uri) VALUES($1,$2,$3)',['other-client',hash(clientSecret),'https://other.example/auth/callback']);
 const r=await request(central).post('/oauth/introspect').set('Authorization',clientHeader(clientSecret,'other-client')).type('form').send({token});
 assert.equal(r.body.active,false);
 assert.equal((await request(central).post('/oauth/introspect').set('Authorization',clientHeader('incorrect')).type('form').send({token})).status,401);
});
test('Job Star logout revokes central session plus every linked Star token',async()=>{
 const a=await sso(),b=await sso(),csrf=(await request(star).get('/api/auth/me').set('Cookie',a)).body.csrfToken;
 assert.equal((await request(star).post('/api/auth/logout').set('Origin',cfg.origin).set('Cookie',a).set('X-CSRF-Token',csrf).send({})).status,200);
 assert.equal((await request(central).get('/api/auth/me').set('Cookie',centralCookie)).status,401);
 assert.equal((await request(star).get('/api/auth/me').set('Cookie',b)).status,401);
 centralCookie=await login('shared.user');
});
test('central logout and suspension invalidate Job Star on its next request',async()=>{
 const a=await sso(),csrf=(await me(centralCookie)).csrfToken;
 await request(central).post('/api/auth/logout').set('Origin',origin).set('Cookie',centralCookie).set('X-CSRF-Token',csrf).send({});
 assert.equal((await request(star).get('/api/auth/me').set('Cookie',a)).status,401);
 centralCookie=await login('shared.user');const b=await sso();
 await request(central).patch('/api/admin/users/'+userId).set('Origin',origin).set('Cookie',adminCookie).set('X-CSRF-Token',adminCsrf).send({status:'suspended'});
 assert.equal((await request(star).get('/api/auth/me').set('Cookie',b)).status,401);
 await request(central).patch('/api/admin/users/'+userId).set('Origin',origin).set('Cookie',adminCookie).set('X-CSRF-Token',adminCsrf).send({status:'approved'});
 centralCookie=await login('shared.user');
});
test('central password reset invalidates all related sessions; absolute expiry is shared',async()=>{
 const a=await sso();
 await db.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[sec.digest(centralCookie.split('=')[1])]);
 assert.equal((await request(star).get('/api/auth/me').set('Cookie',a)).status,401);
 centralCookie=await login('shared.user');const b=await sso();
 const issue=await request(central).post('/api/admin/users/'+userId+'/reset-password').set('Origin',origin).set('Cookie',adminCookie).set('X-CSRF-Token',adminCsrf).send({});
 assert.equal(issue.status,200);
 const r=await post('/api/auth/reset-password',{token:issue.body.url.split('#')[1],password:'New-shared-password-1234',confirmPassword:'New-shared-password-1234'});assert.equal(r.status,200);
 assert.equal((await request(star).get('/api/auth/me').set('Cookie',b)).status,401);
});
test('central outage fails closed; no member DB or fallback is used by Star',async()=>{
 const broken=createStar({config:cfg,fetchImpl:async()=>{throw new Error('offline');}});
 const r=await request(broken).get('/api/auth/me').set('Cookie','jobstar-session='+randomBytes(32).toString('base64url'));
 assert.equal(r.status,503);assert.match(r.body.error,/인증 서버 연결 실패/);
 const js=await fs.readFile(path.join(__dirname,'../private/script.js'),'utf8');assert.match(js,/호출 실패/);assert.doesNotMatch(js,/localStorage|sessionStorage|innerHTML/);
});

