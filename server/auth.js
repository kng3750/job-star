const {createHash,randomBytes,timingSafeEqual}=require('node:crypto');
const digest=value=>createHash('sha256').update(value).digest('hex');
const failure=(status,message)=>Object.assign(new Error(message),{status});
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const cookie=(req,name)=>(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';
function readConfig(provided){
 const c=provided||{origin:process.env.APP_ORIGIN,authOrigin:process.env.AUTH_SERVER_ORIGIN,clientId:process.env.AUTH_CLIENT_ID,clientSecret:process.env.AUTH_CLIENT_SECRET,redirectUri:process.env.AUTH_REDIRECT_URI,production:process.env.NODE_ENV==='production'||Boolean(process.env.VERCEL)};
 if(!c.origin||!c.authOrigin||!c.clientId||!c.clientSecret||c.clientSecret.length<43||!c.redirectUri)throw failure(503,'통합 로그인 서버 설정이 필요합니다.');
 for(const value of [c.origin,c.authOrigin]){
  const url=new URL(value);
  if(url.origin!==value||url.username||url.password||
   (url.protocol!=='https:'&&!(c.production===false&&url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))))throw failure(503,'통합 로그인 주소 설정이 올바르지 않습니다.');
 }
 if(c.redirectUri!==c.origin+'/auth/callback')throw failure(503,'로그인 복귀 주소 설정이 올바르지 않습니다.');
 return c;
}
function createAuth({config,fetchImpl=fetch}={}){
 const cfg=()=>readConfig(config);
 const names=c=>({session:c.production?'__Host-jobstar-session':'jobstar-session',flow:c.production?'__Host-jobstar-flow':'jobstar-flow'});
 function setCookie(res,name,value,seconds,sameSite,production){
  res.append('Set-Cookie',name+'='+value+'; Path=/; HttpOnly; SameSite='+sameSite+'; Max-Age='+seconds+(production?'; Secure':''));
 }
 const getToken=req=>cookie(req,names(cfg()).session);
 const clear=(res)=>{const c=cfg();setCookie(res,names(c).session,'',0,'Lax',c.production);};
 async function backchannel(path,body){
  const c=cfg();let response;
  try{response=await fetchImpl(c.authOrigin+path,{method:'POST',headers:{
   Authorization:'Basic '+Buffer.from(encodeURIComponent(c.clientId)+':'+encodeURIComponent(c.clientSecret)).toString('base64'),
   'Content-Type':'application/x-www-form-urlencoded'
  },body:new URLSearchParams(body).toString(),redirect:'error',signal:AbortSignal.timeout(7000)});}
  catch{throw failure(503,'인증 서버 연결 실패. 잠시 후 다시 시도해 주세요.');}
  let result;try{result=await response.json();}catch{throw failure(503,'인증 서버 응답에 실패했습니다.');}
  if(!response.ok){
   if(response.status===429)throw failure(429,'요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
   throw failure(503,'중앙 인증 설정 또는 연결을 확인해 주세요.');
  }return result;
 }
 async function start(req,res){
  const c=cfg(),oauth=await import('oauth4webapi');
  const verifier=oauth.generateRandomCodeVerifier();
  const flow=Date.now()+'.'+verifier;
  const state=digest('sso-flow:'+flow);
  const target=new URL(c.authOrigin+'/oauth/authorize');
  target.search=new URLSearchParams({client_id:c.clientId,redirect_uri:c.redirectUri,response_type:'code',scope:'job-star',
   state,code_challenge:await oauth.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256'}).toString();
  setCookie(res,names(c).flow,flow,600,'Lax',c.production);
  res.redirect(target.href);
 }
 async function callback(req,res){
  const c=cfg(),oauth=await import('oauth4webapi'),flow=cookie(req,names(c).flow);
  setCookie(res,names(c).flow,'',0,'Lax',c.production);
  const [when,verifier]=flow.split('.');
  if(!/^\d{13}$/.test(when||'')||Date.now()-Number(when)>600000||Number(when)>Date.now()+5000||!/^[A-Za-z0-9_-]{43}$/.test(verifier||''))throw failure(400,'로그인 요청이 만료되었습니다. 다시 로그인해 주세요.');
  const as={issuer:c.authOrigin,authorization_endpoint:c.authOrigin+'/oauth/authorize',token_endpoint:c.authOrigin+'/oauth/token'};
  const client={client_id:c.clientId};let tokens;
  try{
   const url=new URL(req.originalUrl,c.origin);
   const params=oauth.validateAuthResponse(as,client,url,digest('sso-flow:'+flow));
   const response=await oauth.authorizationCodeGrantRequest(as,client,oauth.ClientSecretBasic(c.clientSecret),params,c.redirectUri,verifier,{
    [oauth.allowInsecureRequests]:!c.production,[oauth.customFetch]:fetchImpl,signal:AbortSignal.timeout(7000)
   });
   tokens=await oauth.processAuthorizationCodeResponse(as,client,response);
  }catch(error){console.error('SSO callback:',error.code||error.name);throw failure(400,'통합 로그인 확인에 실패했습니다. 다시 로그인해 주세요.');}
  if(!/^[A-Za-z0-9_-]{43}$/.test(tokens.access_token))throw failure(503,'잘못된 세션 응답입니다.');
  const me=await backchannel('/oauth/introspect',{token:tokens.access_token});
  if(me.active!==true||me.aud!==c.clientId)throw failure(401,'로그인 승인을 확인할 수 없습니다.');
  // Cross-site OAuth callback redirects must carry this cookie to /app.
  // Mutating requests still require exact Origin and a session-bound CSRF token.
  setCookie(res,names(c).session,tokens.access_token,Math.max(0,Math.min(28800,me.exp-Math.floor(Date.now()/1000))),'Lax',c.production);
  res.redirect('/app');
 }
 async function authenticate(req,res,next){
  try{
   const c=cfg(),token=getToken(req);
   if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw failure(401,'로그인이 필요합니다.');
   if(!['GET','HEAD'].includes(req.method)){
    if(req.headers.origin!==c.origin||!same(req.headers['x-csrf-token'],digest('jobstar-csrf:'+token)))throw failure(403,'요청 인증에 실패했습니다. 새로고침해 주세요.');
   }
   const me=await backchannel('/oauth/introspect',{token,operation:req.path==='/api/generate'?'generate':'read'});
   if(me.active!==true||me.aud!==c.clientId){clear(res);throw failure(401,'로그인이 만료되었거나 승인이 해제되었습니다.');}
   req.user=me;req.sessionToken=token;next();
  }catch(e){
   if(e.status===401&&!req.path.startsWith('/api/'))return res.redirect('/login');
   next(e);
  }
 }
 async function logout(req,res){
  await backchannel('/oauth/revoke',{token:req.sessionToken});clear(res);res.json({ok:true});
 }
 return {start,callback,authenticate,logout,config:cfg,csrf:token=>digest('jobstar-csrf:'+token)};
}
module.exports={createAuth,readConfig};

