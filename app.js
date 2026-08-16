const WORDS = (window.WORDS_PARTS || []).flat();
const STORAGE_KEY = 'b1-vocab-progress-v2';
const LEGACY_KEY = 'b1-vocab-known-v1';
const DAY = 24*60*60*1000;

let progress = loadProgress();
let browseFilter = 'all';
let browsePage = 0;
let currentModalIndex = null;
let session = [];
let sessionPos = 0;
let revealed = false;
let currentDirection = 'de-en';

function now(){ return Date.now(); }
function keyFor(e,i){ return e.k || e.w || String(i); }
function stateFor(i){
  const k = keyFor(WORDS[i],i);
  if(!progress[k]) progress[k] = {level:0,due:0,wrong:0,seen:0,star:false,last:0};
  return progress[k];
}
function saveProgress(){ localStorage.setItem(STORAGE_KEY,JSON.stringify(progress)); }
function loadProgress(){
  try{
    const p = JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');
    if(p && typeof p === 'object') return p;
  }catch(e){}
  const p = {};
  try{
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY)||'{}');
    if(legacy && typeof legacy === 'object'){
      WORDS.forEach((e,i)=>{
        const k = keyFor(e,i);
        if(legacy[k]) p[k] = {level:4,due:now()+14*DAY,wrong:0,seen:1,star:false,last:now()};
      });
    }
  }catch(e){}
  return p;
}
function escapeHtml(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function statusOf(i){
  const s=stateFor(i);
  if(!s.seen) return 'new';
  if(s.level>=4) return s.due && s.due<=now() ? 'due' : 'mastered';
  if(s.due && s.due<=now()) return 'due';
  return 'learning';
}
function getStats(){
  let n=0,l=0,d=0,m=0;
  WORDS.forEach((_,i)=>{const st=statusOf(i); if(st==='new')n++; else if(st==='learning')l++; else if(st==='due')d++; else if(st==='mastered')m++;});
  return {new:n,learning:l,due:d,mastered:m};
}
function updateStats(){
  const s=getStats(), total=WORDS.length, pct=total?Math.round(100*s.mastered/total):0;
  document.getElementById('dueTop').textContent=s.due;
  document.getElementById('masteredTop').textContent=s.mastered;
  document.getElementById('totalTop').textContent=total;
  document.getElementById('masterBar').style.width=pct+'%';
  document.getElementById('statNew').textContent=s.new;
  document.getElementById('statLearning').textContent=s.learning;
  document.getElementById('statDue').textContent=s.due;
  document.getElementById('statMastered').textContent=s.mastered;
  document.getElementById('masterPct').textContent=pct+'%';
  document.getElementById('progressMasterBar').style.width=pct+'%';
}
function speak(text){
  if(!('speechSynthesis' in window)) return toast('Speech is not supported in this browser.');
  speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(text); u.lang='de-DE'; u.rate=.88; speechSynthesis.speak(u);
}
function cleanSpeak(e){return e.k || e.w.split(',')[0];}
function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1800);}

function switchTab(name){
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.id==='panel-'+name));
  if(name==='browse') renderBrowse();
  if(name==='difficult') renderDifficult();
  if(name==='progress') updateStats();
}
document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));

function chooseDeck(mode,size){
  const all=WORDS.map((_,i)=>i), t=now();
  let pool=[];
  if(mode==='new') pool=all.filter(i=>!stateFor(i).seen);
  else if(mode==='difficult') pool=all.filter(i=>stateFor(i).wrong>0).sort((a,b)=>stateFor(b).wrong-stateFor(a).wrong);
  else if(mode==='starred') pool=all.filter(i=>stateFor(i).star);
  else if(mode==='all') pool=all;
  else {
    const due=all.filter(i=>stateFor(i).seen && stateFor(i).due<=t).sort((a,b)=>stateFor(a).due-stateFor(b).due);
    const hard=all.filter(i=>stateFor(i).wrong>0 && !due.includes(i)).sort((a,b)=>stateFor(b).wrong-stateFor(a).wrong);
    const fresh=shuffle(all.filter(i=>!stateFor(i).seen));
    const rest=shuffle(all.filter(i=>stateFor(i).seen && !due.includes(i) && !hard.includes(i)));
    pool=[...due,...hard,...fresh,...rest];
  }
  if(mode==='all'||mode==='new') shuffle(pool);
  return pool.slice(0,size);
}
function startSession(opts={}){
  const mode=opts.mode||document.getElementById('studyMode').value;
  const size=opts.size||Number(document.getElementById('sessionSize').value);
  currentDirection=opts.direction||document.getElementById('direction').value;
  session=opts.indices ? opts.indices.slice() : chooseDeck(mode,size);
  sessionPos=0; revealed=false;
  switchTab('learn');
  renderCard(mode);
}
function renderCard(mode='study'){
  const mount=document.getElementById('cardMount');
  const count=document.getElementById('sessionCount');
  const bar=document.getElementById('sessionBar');
  if(!session.length){
    mount.innerHTML='<div class="session-empty">No words are available for this study mode yet.</div>';
    count.textContent='0 / 0';bar.style.width='0%';document.getElementById('sessionLabel').textContent='Nothing to review';return;
  }
  if(sessionPos>=session.length){
    mount.innerHTML='<div class="session-empty"><strong>Session complete.</strong><br><br><button class="btn primary" id="anotherSession">Start another smart review</button></div>';
    count.textContent=session.length+' / '+session.length;bar.style.width='100%';document.getElementById('sessionLabel').textContent='Finished';
    document.getElementById('anotherSession').onclick=()=>startSession({mode:'smart'}); updateStats(); return;
  }
  const i=session[sessionPos], e=WORDS[i], s=stateFor(i);
  const de=escapeHtml(e.k), forms=e.w!==e.k?escapeHtml(e.w):'', en=escapeHtml(e.en||'Meaning not available');
  const front=currentDirection==='de-en'?de:en;
  const frontLabel=currentDirection==='de-en'?'German':'English';
  const answerMain=currentDirection==='de-en'?en:de;
  const answerLabel=currentDirection==='de-en'?'English':'German';
  document.getElementById('sessionLabel').textContent=mode==='smart'?'Smart review':mode.replace(/^./,c=>c.toUpperCase());
  count.textContent=(sessionPos+1)+' / '+session.length;bar.style.width=(100*sessionPos/session.length)+'%';
  mount.innerHTML=`<div class="flashcard">
    <div class="card-top"><div class="card-label">${frontLabel}</div><button class="star ${s.star?'on':''}" id="cardStar" title="Star word">${s.star?'★':'☆'}</button></div>
    <div class="card-main">
      <div class="headword">${front}</div>
      ${currentDirection==='de-en'&&forms?`<div class="forms">${forms}</div>`:''}
      <div class="answer ${revealed?'show':''}" id="answer">
        <div class="card-label">${answerLabel}</div><div class="meaning">${answerMain}</div>
        ${currentDirection==='en-de'&&forms?`<div class="forms">${forms}</div>`:''}
        <div class="example-box"><div class="example-title">Goethe example</div><div class="example-text">${escapeHtml(e.e)}</div></div>
        <div class="card-actions"><button class="btn small" id="speakWord">🔊 Word</button><button class="btn small" id="speakExample">🔊 Example</button></div>
      </div>
    </div>
  </div>
  <button class="btn primary reveal-btn" id="revealBtn" style="display:${revealed?'none':'block'}">Show answer</button>
  <div class="ratings ${revealed?'show':''}" id="ratings">
    <button class="rate again" data-rating="again">Again<small>soon</small></button>
    <button class="rate hard" data-rating="hard">Hard<small>short interval</small></button>
    <button class="rate good" data-rating="good">Good<small>remembered</small></button>
    <button class="rate easy" data-rating="easy">Easy<small>longer interval</small></button>
  </div>`;
  document.getElementById('cardStar').onclick=()=>{s.star=!s.star;saveProgress();renderCard(mode);};
  const rb=document.getElementById('revealBtn'); if(rb) rb.onclick=()=>revealCard();
  const sw=document.getElementById('speakWord'); if(sw) sw.onclick=()=>speak(cleanSpeak(e));
  const se=document.getElementById('speakExample'); if(se) se.onclick=()=>speak(e.e);
  document.querySelectorAll('.rate').forEach(b=>b.onclick=()=>rateCard(b.dataset.rating,mode));
}
function revealCard(){revealed=true;const a=document.getElementById('answer'),r=document.getElementById('ratings'),b=document.getElementById('revealBtn');if(a)a.classList.add('show');if(r)r.classList.add('show');if(b)b.style.display='none';}
function rateCard(rating,mode){
  if(!revealed) return;
  const i=session[sessionPos], s=stateFor(i), t=now(); s.seen=(s.seen||0)+1;s.last=t;
  if(rating==='again'){s.level=Math.max(1,(s.level||0)-1);s.wrong=(s.wrong||0)+1;s.due=t+10*60*1000; if(session.length<60) session.push(i);}
  if(rating==='hard'){s.level=Math.max(1,s.level||1);s.wrong=(s.wrong||0)+1;s.due=t+DAY;}
  if(rating==='good'){s.level=Math.min(5,(s.level||0)+1);const days=[0,1,3,7,14,30][s.level]||30;s.due=t+days*DAY;}
  if(rating==='easy'){s.level=Math.min(5,(s.level||0)+2);const days=[0,2,5,10,21,45][s.level]||45;s.due=t+days*DAY;}
  saveProgress();sessionPos++;revealed=false;updateStats();renderCard(mode);
}

document.getElementById('startSession').onclick=()=>startSession();
document.getElementById('quickStart').onclick=()=>startSession({mode:'smart'});
document.getElementById('studyDifficult').onclick=()=>startSession({mode:'difficult'});

function filteredIndices(){
  const q=document.getElementById('searchInput').value.trim().toLowerCase();
  return WORDS.map((_,i)=>i).filter(i=>{
    const e=WORDS[i], st=statusOf(i), s=stateFor(i);
    const hit=!q || `${e.w} ${e.k} ${e.en||''} ${e.e}`.toLowerCase().includes(q);
    if(!hit)return false;
    if(browseFilter==='all')return true;if(browseFilter==='starred')return s.star;
    return st===browseFilter;
  });
}
function renderBrowse(){
  const idxs=filteredIndices(), per=60, pages=Math.max(1,Math.ceil(idxs.length/per)); browsePage=Math.min(browsePage,pages-1);
  const slice=idxs.slice(browsePage*per,(browsePage+1)*per);
  document.getElementById('resultCount').textContent=`${idxs.length.toLocaleString()} words`;
  const list=document.getElementById('wordList');
  if(!slice.length) list.innerHTML='<div class="empty">No matching words.</div>'; else list.innerHTML=slice.map(rowHtml).join('');
  list.querySelectorAll('.word-row').forEach(r=>r.onclick=()=>openModal(Number(r.dataset.i)));
  const pager=document.getElementById('pager');
  pager.innerHTML=pages>1?`<button class="btn small" id="prevPage" ${browsePage===0?'disabled':''}>Previous</button><span class="btn small" style="cursor:default">${browsePage+1} / ${pages}</span><button class="btn small" id="nextPage" ${browsePage>=pages-1?'disabled':''}>Next</button>`:'';
  const p=document.getElementById('prevPage'),n=document.getElementById('nextPage');if(p)p.onclick=()=>{browsePage--;renderBrowse();scrollTo({top:0,behavior:'smooth'})};if(n)n.onclick=()=>{browsePage++;renderBrowse();scrollTo({top:0,behavior:'smooth'})};
}
function rowHtml(i){
  const e=WORDS[i],st=statusOf(i),label=st==='new'?'New':st==='learning'?'Learning':st==='due'?'Due':'Mastered';
  return `<div class="word-row" data-i="${i}"><div><div class="word-de">${stateFor(i).star?'★ ':''}${escapeHtml(e.k)}</div>${e.w!==e.k?`<div class="word-forms">${escapeHtml(e.w)}</div>`:''}</div><div class="word-en">${escapeHtml(e.en||'')}</div><span class="badge ${st}">${label}</span></div>`;
}
document.getElementById('searchInput').addEventListener('input',()=>{browsePage=0;renderBrowse()});
document.querySelectorAll('#browseFilters .chip').forEach(c=>c.onclick=()=>{document.querySelectorAll('#browseFilters .chip').forEach(x=>x.classList.remove('active'));c.classList.add('active');browseFilter=c.dataset.filter;browsePage=0;renderBrowse();});

function difficultIndices(){return WORDS.map((_,i)=>i).filter(i=>stateFor(i).wrong>0).sort((a,b)=>stateFor(b).wrong-stateFor(a).wrong);}
function renderDifficult(){
  const idxs=difficultIndices(),list=document.getElementById('difficultList');
  if(!idxs.length){list.innerHTML='<div class="empty">No difficult words yet. Words appear here after you rate them Again or Hard.</div>';return;}
  list.innerHTML=idxs.slice(0,100).map(rowHtml).join('');list.querySelectorAll('.word-row').forEach(r=>r.onclick=()=>openModal(Number(r.dataset.i)));
}
function openModal(i){
  currentModalIndex=i;const e=WORDS[i],s=stateFor(i);
  document.getElementById('modalWord').textContent=e.k;document.getElementById('modalForms').textContent=e.w!==e.k?e.w:'';
  document.getElementById('modalEnglish').textContent=e.en||'';document.getElementById('modalExample').textContent=e.e;
  document.getElementById('modalStar').textContent=s.star?'★ Starred':'☆ Star';document.getElementById('detailModal').classList.add('open');
}
function closeModal(){document.getElementById('detailModal').classList.remove('open');currentModalIndex=null;}
document.getElementById('modalClose').onclick=closeModal;document.getElementById('detailModal').onclick=e=>{if(e.target.id==='detailModal')closeModal()};
document.getElementById('modalSpeak').onclick=()=>{if(currentModalIndex!==null)speak(cleanSpeak(WORDS[currentModalIndex]));};
document.getElementById('modalStar').onclick=()=>{if(currentModalIndex===null)return;const s=stateFor(currentModalIndex);s.star=!s.star;saveProgress();document.getElementById('modalStar').textContent=s.star?'★ Starred':'☆ Star';renderBrowse();renderDifficult();};
document.getElementById('modalStudy').onclick=()=>{if(currentModalIndex===null)return;const i=currentModalIndex;closeModal();startSession({indices:[i]});};
document.getElementById('modalMaster').onclick=()=>{if(currentModalIndex===null)return;const s=stateFor(currentModalIndex);s.level=4;s.seen=Math.max(1,s.seen||0);s.due=now()+14*DAY;s.last=now();saveProgress();updateStats();renderBrowse();renderDifficult();toast('Marked as mastered.');};

document.getElementById('exportBtn').onclick=()=>{
  const data=JSON.stringify({version:2,exported:new Date().toISOString(),progress},null,2),blob=new Blob([data],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='B1-Wortschatz-progress.json';a.click();URL.revokeObjectURL(url);
};
document.getElementById('importBtn').onclick=()=>document.getElementById('importFile').click();
document.getElementById('importFile').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{const x=JSON.parse(await f.text());progress=x.progress||x;if(!progress||typeof progress!=='object')throw new Error();saveProgress();updateStats();renderBrowse();renderDifficult();toast('Progress imported.');}catch(err){alert('That progress file could not be read.');}e.target.value='';});
document.getElementById('resetBtn').onclick=()=>{if(confirm('Reset all study progress, difficult-word history, and stars?')){progress={};saveProgress();updateStats();renderBrowse();renderDifficult();toast('Progress reset.');}};

document.addEventListener('keydown',e=>{
  if(document.activeElement&&['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName))return;
  if(!document.getElementById('panel-learn').classList.contains('active'))return;
  if(e.code==='Space'){e.preventDefault();revealCard();}
  if(e.key.toLowerCase()==='s'&&session[sessionPos]!==undefined)speak(cleanSpeak(WORDS[session[sessionPos]]));
  if(revealed&&['1','2','3','4'].includes(e.key)){const map={'1':'again','2':'hard','3':'good','4':'easy'};document.querySelector(`.rate[data-rating="${map[e.key]}"]`)?.click();}
});

updateStats();renderBrowse();renderDifficult();startSession({mode:'smart'});
