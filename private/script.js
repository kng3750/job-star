const FEATURE_META={
 counselingLog:{title:'상담일지 자동 생성',desc:'참여자 정보와 상담 내용을 정식 상담일지로 작성합니다.'},
 interviewQA:{title:'면접 예상 질문 및 답변 생성',desc:'지원 직무에 맞춘 면접 질문과 답변을 준비합니다.'},
 interviewFeedback:{title:'모의 면접 답변 피드백',desc:'답변의 강점과 개선점을 확인합니다.'},
 followUpPlan:{title:'취업 후 사후관리 계획',desc:'취업 초기 적응을 위한 계획을 작성합니다.'},
 caseClosure:{title:'사례 종결 요약 보고서',desc:'참여 과정과 성과를 보고서로 정리합니다.'},
 strategyPivot:{title:'취업 전략 전환',desc:'구직 과정과 어려움을 바탕으로 다음 전략을 수립합니다.'}
};
const forms=document.querySelectorAll('.feature-form'),nav=document.querySelectorAll('.nav-item');
const output=document.getElementById('result-output'),status=document.getElementById('result-status');
const copy=document.getElementById('btn-copy'),clear=document.getElementById('btn-clear');
let active='counselingLog',latest='',csrf='',ready=false,requestId=0,controller,leaving=false;
function setStatus(text,type=''){status.textContent=text;status.className='result-status'+(type?' is-'+type:'');}
function setResult(text){
 latest=text||'';output.replaceChildren();
 const el=document.createElement(latest?'div':'p');el.className=latest?'result-content':'result-placeholder';
 el.textContent=latest||'왼쪽에서 업무를 선택하고 내용을 입력한 뒤 생성 버튼을 눌러 주세요.';output.append(el);
 copy.disabled=!latest;clear.disabled=!latest;
}
function cancel(){requestId++;controller?.abort();controller=null;}
function lock(){
 ready=false;cancel();setResult('');forms.forEach(f=>{f.reset();f.querySelector('.btn-generate').disabled=true;});
}
async function session(){
 if(leaving)return;const ticket=requestId;
 const r=await fetch('/api/auth/me',{signal:AbortSignal.timeout(10000)}),me=await r.json().catch(()=>({}));
 if(ticket!==requestId||leaving)return;
 if(r.status===401){lock();location.replace('/login');return;}
 if(!r.ok)throw new Error(me.error||'중앙 로그인 확인에 실패했습니다.');
 csrf=me.csrfToken;ready=true;
 document.getElementById('session-name').textContent=me.name;
 document.getElementById('central-admin').hidden=me.role!=='admin';
 document.getElementById('api-status-text').textContent='중앙 로그인 확인됨';
 document.getElementById('api-status-dot').className='api-status-dot is-ok';
 forms.forEach(f=>f.querySelector('.btn-generate').disabled=false);
}
function switchFeature(feature){
 if(!FEATURE_META[feature])return;cancel();active=feature;setResult('');setStatus('');
 nav.forEach(n=>n.classList.toggle('is-active',n.dataset.feature===feature));
 forms.forEach(f=>{f.hidden=f.dataset.feature!==feature;f.classList.toggle('is-active',!f.hidden);const b=f.querySelector('.btn-generate');if(b.dataset.originalText)b.textContent=b.dataset.originalText;b.disabled=!ready;});
 document.getElementById('feature-title').textContent=FEATURE_META[feature].title;
 document.getElementById('feature-desc').textContent=FEATURE_META[feature].desc;
}
nav.forEach(n=>n.onclick=()=>switchFeature(n.dataset.feature));
forms.forEach(form=>form.addEventListener('submit',async e=>{
 e.preventDefault();if(!ready)return;
 cancel();const id=requestId;controller=new AbortController();const current=controller;
 setResult('');setStatus('Gemini가 문서를 작성하고 있습니다…','loading');
 const button=form.querySelector('.btn-generate');button.dataset.originalText||=button.textContent;button.textContent='생성 중…';button.disabled=true;
 const input=Object.fromEntries([...form.querySelectorAll('input,textarea,select')].filter(x=>x.name).map(x=>[x.name,x.value.trim()]));
 try{
  const r=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},
   body:JSON.stringify({feature:active,input}),signal:AbortSignal.any([current.signal,AbortSignal.timeout(55000)])});
  const data=await r.json().catch(()=>({}));if(id!==requestId)return;
  if(r.status===401){lock();location.replace('/login');return;}
  if(!r.ok)throw new Error(data.error||'생성 API 요청에 실패했습니다.');
  if(typeof data.result!=='string'||!data.result.trim()||data.feature!==active)throw new Error('생성 API 응답이 올바르지 않습니다.');
  setResult(data.result);setStatus('「'+FEATURE_META[active].title+'」 생성이 완료되었습니다.','ok');
 }catch(error){
  if(id!==requestId)return;setResult('');
  setStatus('호출 실패: '+(error.name==='TimeoutError'?'응답 시간이 초과되었습니다. 다시 시도해 주세요.':error.message),'error');
 }finally{if(id===requestId){button.textContent=button.dataset.originalText;button.disabled=!ready;controller=null;}}
}));
copy.onclick=async()=>{if(!latest||!ready)return;try{await navigator.clipboard.writeText(latest);setStatus('결과가 복사되었습니다.','ok');}catch{setStatus('복사에 실패했습니다. 결과를 직접 선택해 주세요.','error');}};
clear.onclick=()=>{cancel();setResult('');setStatus('');};
document.getElementById('logout').onclick=async()=>{
 leaving=true;const savedCsrf=csrf;lock();setStatus('통합 로그아웃 중…','loading');
 try{
  const r=await fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':savedCsrf},body:'{}',signal:AbortSignal.timeout(10000)});
  if(!r.ok&&r.status!==401)throw new Error('중앙 로그아웃에 실패했습니다. 통합 로그아웃 버튼을 다시 눌러 주세요.');
  location.replace('/signed-out.html');
 }catch(e){leaving=false;setStatus(e.message,'error');}
};
window.addEventListener('pagehide',lock);
window.addEventListener('pageshow',e=>{if(e.persisted){lock();session().catch(e=>setStatus(e.message,'error'));}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!controller)session().catch(e=>{lock();setStatus(e.message,'error');});});
switchFeature(active);session().catch(e=>{lock();setStatus(e.message,'error');});

