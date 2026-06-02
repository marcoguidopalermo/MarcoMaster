/* ============================================================
   UTILITIES
   ============================================================ */
function q(sel,mode){ return mode==='all'?[...document.querySelectorAll(sel)]:document.querySelector(sel); }
function esc(s){ return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function cap(s){ return s.charAt(0).toUpperCase()+s.slice(1); }
function scoreClass(v){ return v<=4?'low':v<=7?'mid':'high'; }
function applyTheme(){ document.documentElement.setAttribute('data-theme', S.theme||'dark'); }
function toggleTheme(){ S.theme=(S.theme==='light')?'dark':'light'; applyTheme(); save(false); }

/* ============================================================
   ROUTER
   ============================================================ */
const PAGES={
  today:{render:renderToday,bind:bindToday},
  plan:{render:renderPlan,bind:bindPlan},
  insights:{render:renderInsights,bind:bindInsights},
  recurring:{render:renderRecurring,bind:bindRecurring},
  projects:{render:renderProjects,bind:bindProjects},
  review:{render:renderReview,bind:bindReview},
  scorecard:{render:renderScorecard,bind:bindScorecard},
  board:{render:renderBoard,bind:bindBoard},
  parking:{render:renderParking,bind:bindParking},
  rules:{render:renderRules,bind:bindRules},
  followups:{render:renderFollowups,bind:bindFollowups},
  shutdown:{render:renderShutdown,bind:bindShutdown},
  settings:{render:renderSettings,bind:bindSettings},
};
let current='today';

function rerender(){
  const main=q('#main');
  // remember scroll + focused field so live typing doesn't jump
  const active=document.activeElement;
  const tag=active?.dataset?(active.dataset.focus||active.dataset.state||active.dataset.rev||active.dataset.sd||active.dataset.rule):null;
  const selStart=active?.selectionStart;
  const scroll=window.scrollY;

  main.innerHTML=PAGES[current].render();
  injectTomorrowFlag();
  PAGES[current].bind();
  updateNavBadge();

  // restore focus
  if(tag!=null){
    const re=q(`[data-focus="${tag}"],[data-state="${tag}"],[data-rev="${tag}"],[data-sd="${tag}"],[data-rule="${tag}"]`);
    if(re){ re.focus(); try{ re.setSelectionRange(selStart,selStart); }catch(e){} }
  }
  window.scrollTo(0,scroll);
}

/* nav definition: daily essentials always shown; rest behind "More" */
const NAV_DAILY=[
  ['today','◎','Today'],
  ['plan','▦','Time Blocker'],
  ['shutdown','☾','Night'],
];
const NAV_MORE=[
  ['projects','◳','Projects'],
  ['followups','↪','Follow-ups'],
  ['recurring','↻','Recurring Tasks'],
  ['insights','◈','MarcoInsights'],
  ['review','▤','Weekly CEO Review'],
  ['scorecard','◧','Life Scorecard'],
  ['board','⊞','Priority Board'],
  ['parking','⊟','Parking Lot'],
  ['rules','§','Rules / Future Self'],
];
function renderNav(){
  const showMore=S.settings&&S.settings.showMore;
  const link=([page,ic,label])=>`<button class="navbtn ${current===page?'active':''}" data-page="${page}"><span class="ic">${ic}</span>${label}${page==='today'?'<span class="badge" id="navTodayBadge" style="display:none">0</span>':''}</button>`;
  let html=NAV_DAILY.map(link).join('');
  html+=`<button class="navbtn nav-more-toggle ${showMore?'open':''}" id="navMoreToggle"><span class="ic">${showMore?'▾':'▸'}</span>More</button>`;
  if(showMore){
    html+=`<div class="nav-more">${NAV_MORE.map(link).join('')}</div>`;
  }
  html+=link(['settings','⚙','Settings']);
  const c=q('#navLinks'); c.innerHTML=html;
  q('#navLinks .navbtn','all').forEach(btn=>{ if(btn.dataset.page) btn.onclick=()=>go(btn.dataset.page); });
  const mt=q('#navMoreToggle'); if(mt) mt.onclick=()=>{ S.settings.showMore=!showMore; save(false); renderNav(); };
  updateNavBadge();
}

function go(page){
  current=page;
  renderNav();
  const main=q('#main');
  main.innerHTML=PAGES[page].render();
  injectTomorrowFlag();
  PAGES[page].bind();
  updateNavBadge();
  window.scrollTo(0,0);
}

/* surface "tomorrow's first move" at top of Today */
function injectTomorrowFlag(){
  if(current!=='today') return;
  // pull yesterday's shutdown firstMove
  const keys=Object.keys(S.days).sort();
  const ti=keys.indexOf(todayKey());
  let prev=null;
  for(let i=keys.length-1;i>=0;i--){ if(keys[i]<todayKey()){ prev=S.days[keys[i]]; break; } }
  const move=prev?.shutdown?.firstMove;
  if(move && move.trim()){
    const head=q('.focus-hero');
    if(head){
      const flag=document.createElement('div');
      flag.className='tomorrow-flag';
      flag.innerHTML=`<span class="lab">↳ Last night you said tomorrow's first move is</span>${esc(move)}`;
      head.parentNode.insertBefore(flag,head);
    }
  }
}

function updateNavBadge(){
  const d=day();
  const remaining=RESET_STEPS.filter(s=>!d.reset[s[0]]).length;
  const badge=q('#navTodayBadge');
  if(remaining>0 && remaining<RESET_STEPS.length){ badge.style.display=''; badge.textContent=remaining; }
  else if(remaining===RESET_STEPS.length){ badge.style.display=''; badge.textContent=RESET_STEPS.length; }
  else badge.style.display='none';
}

/* ============================================================
   RESET BUTTON  — no shame, just "next right action"
   ============================================================ */
function openReset(){
  const m=q('#resetModal');
  const d=day();
  m.innerHTML=`
    <div class="modal">
      <span class="modal-close" id="resetClose">×</span>
      <h3>Reset</h3>
      <p class="intro">You fell off for a bit. That's fine — the system doesn't keep score against you. Just answer five things and you're back in.</p>
      <div class="qf"><label>What is the next right action?</label>
        <input type="text" id="rs_next" placeholder="The single smallest move that gets you going"></div>
      <div class="qf"><label>What is today's workout?</label>
        <input type="text" id="rs_workout" placeholder="Even 20 minutes counts"></div>
      <div class="qf"><label>What is today's #1 business win?</label>
        <input type="text" id="rs_biz" placeholder="One outcome"></div>
      <div class="qf"><label>What can be parked?</label>
        <input type="text" id="rs_park" placeholder="Anything you can let go of right now"></div>
      <div class="qf"><label>What needs to be simplified?</label>
        <input type="text" id="rs_simplify" placeholder="What got too complicated?"></div>
      <div class="btn-row" style="margin-top:20px">
        <button class="btn" id="rs_apply">Apply & go to Today</button>
        <button class="btn ghost" id="rs_cancel">Cancel</button>
      </div>
    </div>`;
  m.classList.add('show');
  q('#resetClose').onclick=closeReset;
  q('#rs_cancel').onclick=closeReset;
  q('#rs_apply').onclick=()=>{
    const next=q('#rs_next').value.trim();
    const workout=q('#rs_workout').value.trim();
    const biz=q('#rs_biz').value.trim();
    const park=q('#rs_park').value.trim();
    const d=day();
    if(workout) d.workout=workout;
    if(biz) d.focus.biz=biz;
    if(next) d.focus.lev = next; // next right action -> seed leverage line
    if(next) d.focus.not = d.focus.not || 'Everything except the next right action';
    if(park){ S.board.parking.push({id:b(),txt:park}); }
    save();
    closeReset();
    go('today');
    toast('Back in. One step at a time.');
  };
}
function closeReset(){ q('#resetModal').classList.remove('show'); }

