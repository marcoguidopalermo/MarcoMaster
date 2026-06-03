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
/* Two-tab app. Other render functions (projects, recurring, insights, board,
   parking, rules, scorecard, shutdown, settings, followups, plan) still exist in
   their files and are REUSED inside these two tabs — they just no longer have
   their own routes/nav. */
const PAGES={
  dashboard:{render:renderDashboard,bind:bindDashboard},
  journal:{render:renderJournal,bind:bindJournal},
  meetings:{render:renderMeetings,bind:bindMeetings},
  settings:{render:renderSettings,bind:bindSettings},
};
let current='dashboard';

function rerender(){
  const main=q('#main');
  // remember scroll + focused field so live typing doesn't jump
  const active=document.activeElement;
  const tag=active?.dataset?(active.dataset.focus||active.dataset.state||active.dataset.rev||active.dataset.sd||active.dataset.rule):null;
  const selStart=active?.selectionStart;
  const scroll=window.scrollY;

  main.setAttribute('data-page', current);   // lets CSS widen the dashboard only
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

/* two tabs: Dashboard (execution) + Journal (reflection) */
const NAV_DAILY=[
  ['dashboard','◧','Dashboard'],
  ['journal','✦','Journal'],
  ['meetings','👥','Meetings'],
  ['settings','⚙','Settings'],
];
function renderNav(){
  const link=([page,ic,label])=>`<button class="navbtn ${current===page?'active':''}" data-page="${page}"><span class="ic">${ic}</span>${label}</button>`;
  const c=q('#navLinks'); c.innerHTML=NAV_DAILY.map(link).join('');
  q('#navLinks .navbtn','all').forEach(btn=>{ if(btn.dataset.page) btn.onclick=()=>go(btn.dataset.page); });
}

function go(page){
  current=page;
  renderNav();
  const main=q('#main');
  main.setAttribute('data-page', page);   // lets CSS widen the dashboard only
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
  const badge=q('#navTodayBadge'); if(!badge) return;   // no badge in the two-tab nav
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
    go('dashboard');
    toast('Back in. One step at a time.');
  };
}
function closeReset(){ q('#resetModal').classList.remove('show'); }

