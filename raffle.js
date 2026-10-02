'use strict';
const API = 'https://script.google.com/macros/s/AKfycbwwoZnAoiftITok6hGpFkKGzaRX4WqshVEbbHL1d_DwRKrmm3LHBDayZfaDtc0aO-In/exec';
const DEMO = new URLSearchParams(location.search).get('demo') === '1';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = { pass:'', events:[], extra:[], sheet:null, preview:null, active:null, busy:false };
const PENDING_KEY = DEMO ? 'raffle_demo_pending' : 'raffle_pending_v1';
const storage = DEMO ? sessionStorage : localStorage;
const uuid = () => crypto.randomUUID();
function readStored(key, fallback) { try { return JSON.parse(storage.getItem(key)) || fallback; } catch (_) { return fallback; } }
function store(key, value) { storage.setItem(key, JSON.stringify(value)); }
function pending() { return readStored(PENDING_KEY, null); }
function clearPending(requestId) { if (pending()?.requestId === requestId) storage.removeItem(PENDING_KEY); }
function message(text, error=false) { $('message').textContent=text; $('message').className='message'+(error?' error':''); }
function busy(on) { state.busy=on; document.querySelectorAll('#main button, #main input, #main select').forEach(el=>el.disabled=on); if(!on) { document.querySelectorAll('#events input').forEach(el=>{if(state.events.some(e=>e.code===el.value && e.duplicate)) el.disabled=true;}); syncCreate(); } }
async function api(payload) {
  if (DEMO) return demoApi(payload);
  const controller = new AbortController(), timer = setTimeout(()=>controller.abort(), 65000);
  try {
    const response = await fetch(API, {method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...payload,pass:state.pass}),signal:controller.signal});
    if(!response.ok) throw new Error('連線未完成');
    const res=await response.json();
    if(res.status!=='success') { const err=new Error(res.message || '操作失敗'); err.definite=res.status!=='uncertain'; throw err; }
    return res;
  } finally { clearTimeout(timer); }
}
function sources() { return [...document.querySelectorAll('#events input:checked')].map(el=>({event:el.value})).concat(state.extra); }
function invalidate() { state.preview=null; $('review').classList.add('hidden'); $('reviewEmpty').classList.remove('hidden'); syncCreate(); }
function syncCreate() {
  const missing=[];
  if(!$('raffleName').value.trim()) missing.push('填寫抽獎活動名稱');
  if(!$('acknowledge').checked) missing.push('勾選名單確認');
  const hint=state.busy?'處理中，請稍候…':!state.preview?.ready?'請先檢查名單，確認至少有一位符合資格。':missing.length?'還差一步：請'+missing.join('、')+'。':'資料已齊全，可以建立抽獎活動。';
  $('createHint').textContent=hint;
  $('create').disabled=state.busy || !state.preview?.ready || missing.length>0;
}
function showPending() {
  const p=pending();
  $('retryPending').classList.toggle('hidden',!p);
  if(p) message('有一筆尚未確認完成的操作。請按「確認／重試上次操作」取回同一次結果，避免另抽一次。',true);
}
async function loadSaved() {
  const res=await api({action:'adminRaffleList'});
  $('saved').innerHTML='<option value="">選擇活動，繼續抽獎或查看結果</option>'+res.raffles.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.name)+' · '+r.total+' 人 · '+esc(r.created)+'</option>').join('');
  if(state.active) $('saved').value=state.active.id;
}
async function login(event) {
  event?.preventDefault();
  state.pass=$('password').value; $('loginBtn').disabled=true; $('loginMessage').textContent='';
  try {
    const [events,list]=await Promise.all([api({action:'adminEvents'}),api({action:'adminRaffleList'})]);
    state.events=events.events.slice().reverse();
    $('events').innerHTML=state.events.map(ev=>'<label class="event-option"><input type="checkbox" value="'+esc(ev.code)+'"'+(ev.duplicate?' disabled':'')+'><span><strong>'+esc(ev.name || ev.code)+'</strong><small>'+esc(ev.date || '未填日期')+' · '+esc(ev.code)+(ev.duplicate?' · 代碼重複，請先修正':'')+'</small></span></label>').join('') || '<p class="muted">尚未登錄場次，可以使用下方的試算表名單。</p>';
    $('saved').innerHTML='<option value="">選擇活動，繼續抽獎或查看結果</option>'+list.raffles.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.name)+' · '+r.total+' 人 · '+esc(r.created)+'</option>').join('');
    sessionStorage.setItem('raffle_pass',state.pass);
    $('password').value=''; $('login').classList.add('hidden'); $('main').classList.remove('hidden');
    const last=readStored('raffle_last',null);
    if(last && list.raffles.some(r=>r.id===last)) renderActive(await api({action:'adminRaffleGet',id:last}));
    showPending();
  } catch(err) { $('loginMessage').textContent=err.message || '連線失敗，請重試'; }
  finally { $('loginBtn').disabled=false; }
}
async function readTabs() {
  if(state.busy) return; busy(true); state.sheet=null; $('externalFields').classList.add('hidden');
  try {
    const res=await api({action:'adminRaffleTabs',sheetId:$('sheetUrl').value});
    state.sheet=res; $('sheetTab').innerHTML=res.tabs.map(t=>'<option>'+esc(t)+'</option>').join('');
    $('sourceLabel').value=res.name.slice(0,120); $('externalFields').classList.remove('hidden'); message('已讀到試算表，請選擇名單分頁再加入。');
  } catch(err) { message(err.message || '無法讀取分頁',true); }
  finally { busy(false); }
}
function renderExtras() {
  $('externalList').innerHTML=state.extra.map((s,i)=>'<li><span>'+esc(s.label)+'<br><small class="muted">'+esc(s.sheetName)+'</small></span><button data-remove="'+i+'">移除</button></li>').join('');
}
async function preview() {
  if(state.busy) return;
  if(pending()) { showPending(); return; }
  if(!sources().length) { message('請先選擇至少一份名單。',true); return; }
  invalidate(); busy(true); message('正在讀取並合併報名名單…');
  try {
    const res=await api({action:'adminRafflePreview',sources:sources()});
    state.preview=res; $('reviewEmpty').classList.add('hidden'); $('review').classList.remove('hidden'); $('eligible').textContent=res.stats.eligible;
    $('counts').innerHTML=[['報名資料',res.stats.rows],['退款／無效訂單',res.stats.excluded],['缺姓名／手機異常',res.stats.invalid],['重複合併',res.stats.duplicates]].map(([k,v])=>'<div class="count">'+k+'<b>'+v+'</b></div>').join('');
    $('sourceSummary').innerHTML=res.sources.map(s=>'<div class="source-stat"><strong>'+esc(s.label)+'</strong><p>'+s.rows+' 筆資料 · '+s.eligibleRows+' 筆符合資格（去重前） · 排除 '+(s.excluded+s.invalid)+' 筆</p></div>').join('');
    $('issuesTitle').textContent='待確認資料（'+res.issues.length+' 項）'; $('issuesBox').classList.toggle('hidden',!res.issues.length);
    $('issues').innerHTML=res.issues.map(i=>'<div class="issue"><b>'+esc(i.source)+' · 第 '+i.row+' 列 · '+esc(i.name)+(i.phoneTail?' · 手機末三碼 '+esc(i.phoneTail):'')+'</b>'+esc(i.message)+'</div>').join('');
    $('issuesBox').open=!!res.issues.length; $('acknowledge').checked=false;
    message(res.ready?'名單已合併。請核對人數與待確認資料，再建立抽獎活動。':'沒有符合資格的人，請先修正來源名單。',!res.ready);
  } catch(err) { message(err.message || '檢查失敗，請重試',true); }
  finally { busy(false); }
}
async function mutate(payload) {
  if(state.busy) return;
  const animate=payload.action==='adminRaffleDraw' && !pending();
  // 先可靠保存操作識別碼才送出。回應遺失或重開頁面，可重取同一結果。
  try { store(PENDING_KEY,payload); } catch (_) { message('瀏覽器無法保存操作狀態，請允許網站儲存資料後再試。',true); return; }
  busy(true); $('stageLabel').textContent='正在確認並保存結果…'; $('drawing').querySelector('.stage').classList.add('busy');
  if(animate) {try{window.RaffleMotion?.start({eventName:state.active?.name || '',prize:payload.prize,count:payload.count,demo:DEMO});}catch(_){window.RaffleMotion?.abort();}}
  try {
    const res=await api(payload); clearPending(payload.requestId); renderActive(res); $('retryPending').classList.add('hidden');
    message(payload.action==='adminRaffleCreate'?'抽獎名單已固定保存，可以開始設定獎項。':'得獎結果已保存。重整頁面仍能查看同一結果。');
    if(animate) {try{await window.RaffleMotion?.reveal({...res.draws.find(d=>d.requestId===payload.requestId),animation:res.animation});}catch(_){window.RaffleMotion?.abort();}}
    try { await loadSaved(); } catch(_) { /* 已成功保存，活動列表稍後可重新載入。 */ }
  } catch(err) {
    window.RaffleMotion?.abort();
    if(err.definite) { clearPending(payload.requestId); message(err.message,true); if(payload.action==='adminRaffleCreate') invalidate(); }
    else showPending();
  } finally { $('drawing').querySelector('.stage').classList.remove('busy'); busy(false); $('retryPending').classList.toggle('hidden',!pending()); }
}
function renderActive(res) {
  state.active=res; store('raffle_last',res.id); $('setup').classList.add('hidden'); $('drawing').classList.remove('hidden');
  $('activeName').textContent=res.name; $('activeMeta').textContent='名單確認於 '+res.created+' · 共 '+res.stats.eligible+' 人 · 已抽 '+res.revision+' 輪';
  $('remaining').textContent='尚有 '+res.remaining+' 人可抽獎'; $('quantity').max=Math.min(50,res.remaining);
  const last=res.draws.at(-1); $('stageLabel').textContent=last?'恭喜本輪得獎者':'下一份好運，會是誰？'; $('stagePrize').textContent=last?.prize || '準備好了嗎？';
  $('winners').innerHTML=last?last.winners.map(w=>'<div class="winner"><strong>'+esc(w.name)+'</strong><small>手機末三碼 '+esc(w.phoneTail)+'</small></div>').join(''):'<span class="stage-symbol" aria-hidden="true">✧</span>';
  $('history').innerHTML=res.draws.slice().reverse().map((d,i)=>'<div class="round"><h3>第 '+(res.draws.length-i)+' 輪 · '+esc(d.prize)+' <small>'+esc(d.time)+'</small></h3><p>'+d.winners.map(w=>esc(w.name)+'（'+esc(w.phoneTail)+'）').join('、')+'</p></div>').join('') || '<p class="muted">還沒有抽出結果。</p>';
  const p=pending(); if(p && (p.action==='adminRaffleCreate' && p.requestId===res.id || p.action==='adminRaffleDraw' && p.id===res.id && res.draws.some(d=>d.requestId===p.requestId))) clearPending(p.requestId);
  $('retryPending').classList.toggle('hidden',!pending());
}
async function open(id) {
  if(!id || state.busy) return; busy(true);
  try { renderActive(await api({action:'adminRaffleGet',id})); message('已載入保存的抽獎名單與得獎結果。'); showPending(); }
  catch(err) { message(err.message,true); } finally { busy(false); }
}
function csvCell(v) { let s=String(v??''); if(/^[\s]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s="'"+s; return '"'+s.replace(/"/g,'""')+'"'; }
async function exportWinners() {
  if(state.busy || !state.active) return; busy(true);
  try {
    const res=await api({action:'adminRaffleExport',id:state.active.id});
    const text='\ufeff'+res.rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a'); a.href=url; a.download=res.name.replace(/[\\/:*?"<>|]/g,'_')+'_得獎名單.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    message('已下載得獎名單，包含完整姓名與手機。');
  } catch(err) { message(err.message,true); } finally { busy(false); }
}
$('message').insertAdjacentHTML('afterend','<button id="retryPending" class="hidden">確認／重試上次操作</button>');
$('loginForm').addEventListener('submit',login);
$('events').addEventListener('change',invalidate); $('raffleName').addEventListener('input',syncCreate); $('acknowledge').addEventListener('change',syncCreate);
$('loadTabs').addEventListener('click',readTabs);
$('sheetUrl').addEventListener('input',()=>{state.sheet=null; $('externalFields').classList.add('hidden');});
$('addSource').addEventListener('click',()=>{ if(!state.sheet) return; const s={sheetId:state.sheet.sheetId,sheetName:$('sheetTab').value,label:$('sourceLabel').value.trim() || state.sheet.name}; if(state.extra.some(e=>e.sheetId===s.sheetId && e.sheetName===s.sheetName)){ message('這份名單已加入。',true); return; } state.extra.push(s); renderExtras(); invalidate(); });
$('externalList').addEventListener('click',event=>{ const btn=event.target.closest('[data-remove]'); if(btn){state.extra.splice(Number(btn.dataset.remove),1);renderExtras();invalidate();} });
$('preview').addEventListener('click',preview);
$('create').addEventListener('click',()=>{ if(state.busy) return; if(pending()){showPending();return;} if(!state.preview?.ready || !$('acknowledge').checked) return; if(!$('raffleName').value.trim()){syncCreate();$('raffleName').focus();return;} mutate({action:'adminRaffleCreate',requestId:uuid(),name:$('raffleName').value.trim(),sources:sources(),token:state.preview.token,acknowledged:true}); });
$('draw').addEventListener('click',()=>{
  if(pending()){showPending();return;} if(!state.active) return;
  const prize=$('prize').value.trim(),count=Number($('quantity').value);
  if(!prize || !Number.isInteger(count) || count<1 || count>50 || count>state.active.remaining){message('請填獎項及正確名額，不能超過剩餘可抽人數。',true);return;}
  mutate({action:'adminRaffleDraw',requestId:uuid(),id:state.active.id,revision:state.active.revision,prize,count});
});
$('retryPending').addEventListener('click',()=>{ const p=pending(); if(p) mutate(p); });
$('openSaved').addEventListener('click',()=>open($('saved').value)); $('refresh').addEventListener('click',()=>open(state.active?.id));
$('new').addEventListener('click',()=>{if(pending()){showPending();return;}state.active=null; storage.removeItem('raffle_last'); $('drawing').classList.add('hidden'); $('setup').classList.remove('hidden'); $('raffleName').value='';invalidate(); $('message').classList.add('hidden');});
$('export').addEventListener('click',exportWinners);
$('previewAnimation').addEventListener('click',async()=>{
  if(state.busy || !state.active) return;
  if(!window.RaffleMotion) {message('動畫元件尚未載入，請重新整理頁面。',true);return;}
  busy(true);
  try {
    const count=Math.min(3,Math.max(1,Math.floor(Number($('quantity').value)||1))),prize=$('prize').value.trim() || '示範獎項';
    window.RaffleMotion.start({eventName:'動畫預覽｜虛構得獎資料',prize,count,demo:true});
    const candidates=demoCandidates(),winners=candidates.slice(0,count),requestId='preview';
    await window.RaffleMotion.reveal({prize,requestId,winners,animation:{requestId,candidates,winners}});
  } catch(_){window.RaffleMotion.abort();message('動畫播放失敗，抽獎名單與結果未變動。',true);}
  finally {busy(false);}
});
function project(on){document.body.classList.toggle('projecting',on);$('exitProjection').classList.toggle('hidden',!on);window.scrollTo(0,0);}
$('projection').addEventListener('click',()=>project(true)); $('exitProjection').addEventListener('click',()=>project(false)); document.addEventListener('keydown',e=>{if(e.key==='Escape') project(false);});
$('logout').addEventListener('click',()=>{sessionStorage.removeItem('raffle_pass');localStorage.removeItem('admin_pass');state.pass='';location.reload();});

function demoCandidates() {return ['王＊美','林＊文','陳＊安','李＊婷','黃＊傑','吳＊雯','許＊安','張＊文'].map((name,i)=>({key:'demo'+i,name,phoneTail:String(101+i)}));}
// 示範使用虛構資料，不呼叫正式 API，也不寫入試算表。
async function demoApi(p) {
  await new Promise(r=>setTimeout(r,180));
  const demo=readStored('raffle_demo_data',{});
  const good=r=>({status:'success',...r});
  if(p.action==='adminEvents') return good({events:[{code:'cb-onsite',name:'CB 班・現場',date:'2026/10/03'},{code:'cb-online',name:'CB 班・線上',date:'2026/10/03'}]});
  if(p.action==='adminRaffleTabs') return good({sheetId:'demo-online-spreadsheet',name:'線上報名名單',tabs:['線上報名','候補']});
  if(p.action==='adminRafflePreview') return good({token:'demo-token',ready:true,stats:{rows:12,excluded:2,invalid:1,duplicates:1,eligible:8},sources:p.sources.map((s,i)=>({label:s.label || (s.event==='cb-onsite'?'CB 班・現場':'CB 班・線上'),rows:i?4:8,eligibleRows:i?3:6,excluded:i?1:1,invalid:i?0:1})),issues:[{source:'示範名單',row:8,name:'測試學員',phoneTail:'',message:'暫不納入：手機不完整，請回原名單修正'}]});
  if(p.action==='adminRaffleList') return good({raffles:Object.values(demo).map(d=>({id:d.id,name:d.name,created:d.created,total:d.stats.eligible}))});
  if(p.action==='adminRaffleCreate') {
    if(!demo[p.requestId]) {demo[p.requestId]={id:p.requestId,name:p.name,created:new Date().toLocaleString('zh-TW'),stats:{eligible:8},remaining:8,revision:0,draws:[]};store('raffle_demo_data',demo);}
    return good(demo[p.requestId]);
  }
  const d=demo[p.id]; if(!d) throw new Error('找不到示範活動');
  if(p.action==='adminRaffleGet') return good(d);
  if(p.action==='adminRaffleDraw') {
    if(!d.draws.some(x=>x.requestId===p.requestId)) {
      if(d.remaining<p.count || d.revision!==p.revision) {const err=new Error('剩餘人數或結果已變動，請重新載入');err.definite=true;throw err;}
      const names=['王＊美','林＊文','陳＊安','李＊婷','黃＊傑','吳＊雯','許＊安','張＊文'];const start=8-d.remaining;
      d.draws.push({requestId:p.requestId,prize:p.prize,count:p.count,time:new Date().toLocaleString('zh-TW'),winners:Array.from({length:p.count},(_,i)=>({name:names[start+i],phoneTail:String(101+start+i)}))});d.revision++;d.remaining-=p.count;store('raffle_demo_data',demo);
    }
    const index=d.draws.findIndex(x=>x.requestId===p.requestId),before=d.draws.slice(0,index).reduce((n,x)=>n+x.count,0),candidates=demoCandidates().slice(before);
    return good({...d,animation:{requestId:p.requestId,candidates,winners:candidates.slice(0,d.draws[index].count)}});
  }
  if(p.action==='adminRaffleExport') return good({name:d.name,rows:[['獎項','姓名（示範）','手機末三碼','抽出時間'],...d.draws.flatMap(x=>x.winners.map(w=>[x.prize,w.name,w.phoneTail,x.time]))]});
  throw new Error('示範模式不支援此操作');
}
if(DEMO){$('demoBanner').classList.remove('hidden');document.querySelectorAll('a[href="admin.html"],a[href="console.html"]').forEach(a=>a.href+='?demo=1');$('password').value='demo';login();}
else {try{const saved=sessionStorage.getItem('raffle_pass') || localStorage.getItem('admin_pass');if(saved){$('password').value=saved;login();}}catch(_){}}
