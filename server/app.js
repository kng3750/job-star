const express=require('express');
const path=require('node:path');
const {createAuth}=require('./auth');
const {generateFeature,getGeminiApiKey,getGeminiModel}=require('./gemini');
function createApp({config,fetchImpl,generator=generateFeature}={}){
 const app=express(),auth=createAuth({config,fetchImpl});
 app.disable('x-powered-by');
 app.use((req,res,next)=>{
  res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
   'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
  if(process.env.NODE_ENV==='production'||process.env.VERCEL)res.set('Strict-Transport-Security','max-age=31536000');next();
 });
 app.use(express.json({limit:'100kb'}));
 const privateDir=path.join(__dirname,'../private');
 app.get(['/','/index.html'],(req,res)=>res.redirect('/app'));
 app.get('/login',auth.start);
 app.get('/auth/callback',auth.callback);
 app.get('/app',auth.authenticate,(req,res)=>res.sendFile('index.html',{root:privateDir}));
 app.get(['/script.js','/assets/app.js'],auth.authenticate,(req,res)=>res.sendFile('script.js',{root:privateDir}));
 app.get('/register',(req,res)=>res.redirect(auth.config().authOrigin+'/register'));
 app.get('/password',auth.authenticate,(req,res)=>res.redirect(auth.config().authOrigin+'/password'));
 app.get('/admin',auth.authenticate,(req,res)=>{
  if(req.user.role!=='admin')return res.status(403).json({error:'관리자만 이용할 수 있습니다.'});
  res.redirect(auth.config().authOrigin+'/admin');
 });
 app.get('/api/auth/me',auth.authenticate,(req,res)=>res.json({name:req.user.name,role:req.user.role,csrfToken:auth.csrf(req.sessionToken),accountUrl:auth.config().authOrigin}));
 app.post('/api/auth/logout',auth.authenticate,auth.logout);
 app.get('/api/health',(req,res)=>res.json({status:'ok'}));
 app.get('/api/admin/health',auth.authenticate,(req,res)=>{
  if(req.user.role!=='admin')return res.status(403).json({error:'관리자만 이용할 수 있습니다.'});
  res.json({status:'ok',authentication:'central',hasApiKey:Boolean(getGeminiApiKey()),model:getGeminiModel()});
 });
 app.post('/api/generate',auth.authenticate,async(req,res)=>{
  if(!req.is('application/json'))return res.status(415).json({error:'JSON 요청이 필요합니다.'});
  const data=await generator(req.body?.feature,req.body?.input);
  res.json(data);
 });
 app.use(express.static(path.join(__dirname,'../public'),{index:false,dotfiles:'deny',maxAge:0}));
 app.use((req,res)=>res.status(404).json({error:'페이지를 찾을 수 없습니다.'}));
 app.use((err,req,res,next)=>{
  if(res.headersSent)return next(err);
  const status=err.type==='entity.parse.failed'?400:err.type==='entity.too.large'?413:err.status||err.statusCode||503;
  if(status>=500)console.error('Job Star request failed:',err.code||err.name);
  const message=status>=500?(req.path==='/api/generate'?'문서 생성 API 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.':'인증 서버 연결 실패 또는 설정 오류입니다. 잠시 후 다시 시도해 주세요.'):err.message;
  res.status(status).json({error:message});
 });
 return app;
}
module.exports={createApp};

