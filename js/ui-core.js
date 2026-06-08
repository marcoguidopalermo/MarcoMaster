/* ============================================================
   UTILITIES
   ============================================================ */
function q(sel,mode){ return mode==='all'?[...document.querySelectorAll(sel)]:document.querySelector(sel); }
function esc(s){ return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function cap(s){ return s.charAt(0).toUpperCase()+s.slice(1); }
function scoreClass(v){ return v<=4?'low':v<=7?'mid':'high'; }
function applyTheme(){ document.documentElement.setAttribute('data-theme', S.theme||'dark'); }
function toggleTheme(){ S.theme=(S.theme==='light')?'dark':'light'; applyTheme(); save(false); }

/* ---------- generic drag-reorder (mouse + touch long-press), no library ----------
   Drag an item by its handle to reorder a vertical list. Uses Pointer Events so
   mouse, touch and pen are handled uniformly; touch needs a brief long-press so a
   normal swipe still scrolls the page. While dragging it just moves DOM nodes; on
   drop it reads the new order and calls onCommit(orderedIds) ONCE — the caller
   reorders its data, saves, and re-renders.
     container : element holding the rows
     itemSel   : selector for each reorderable item (carries data-<idKey>)
     idKey     : dataset key holding the id (e.g. 'pmdrag' → data-pmdrag)
     handleSel : selector for the drag handle inside an item
     onCommit  : (orderedIds:string[]) => void                                    */
function makeReorderable(container, itemSel, idKey, handleSel, onCommit){
  if(!container) return;
  // siblings = the live, DIRECT children of THIS container that are reorderable
  // items (so insertBefore always operates on real children — that's what gives
  // visible movement). Order is read straight back from this same live list.
  const siblings=()=>[...container.children].filter(c=>c.matches(itemSel));
  container.querySelectorAll(itemSel).forEach(item=>{
    const handle=item.querySelector(handleSel); if(!handle) return;
    handle.style.touchAction='none';   // own the gesture so a touch-drag doesn't scroll
    handle.ondragstart=()=>false;      // no native drag image / selection
    let pid=null, startY=0, dragging=false, pressTimer=null;
    const noSelect=on=>{ document.body.style.userSelect=on?'none':''; document.body.style.webkitUserSelect=on?'none':''; };
    const begin=()=>{ dragging=true; item.classList.add('dragging'); document.body.style.cursor='grabbing'; };
    /* move the dragged item live among its siblings based on pointer Y */
    const moveTo=y=>{
      const before=siblings().find(s=>{ if(s===item) return false; const r=s.getBoundingClientRect(); return y < r.top + r.height/2; });
      if(before){ if(item.nextElementSibling!==before) container.insertBefore(item, before); }
      else if(container.lastElementChild!==item) container.appendChild(item);
    };
    const finish=()=>{
      if(pressTimer){ clearTimeout(pressTimer); pressTimer=null; }
      try{ handle.releasePointerCapture(pid); }catch(_){}
      noSelect(false); document.body.style.cursor='';
      if(dragging){ dragging=false; item.classList.remove('dragging'); onCommit(siblings().map(s=>s.dataset[idKey])); }
    };
    handle.onpointerdown=e=>{
      if(e.button>0) return;             // ignore right/middle click
      e.preventDefault();                // stop the browser starting a text selection
      pid=e.pointerId; startY=e.clientY;
      noSelect(true);
      try{ handle.setPointerCapture(pid); }catch(_){}
      if(e.pointerType!=='mouse') pressTimer=setTimeout(()=>{ pressTimer=null; begin(); }, 200);  // long-press on touch
    };
    handle.onpointermove=e=>{
      if(!dragging){
        if(e.pointerType==='mouse'){ if(Math.abs(e.clientY-startY)>4) begin(); }
        else if(pressTimer && Math.abs(e.clientY-startY)>12){ clearTimeout(pressTimer); pressTimer=null; }  // moved before hold → scroll
        if(!dragging) return;
      }
      e.preventDefault();
      moveTo(e.clientY);
    };
    handle.onpointerup=finish;
    handle.onpointercancel=finish;
  });
}

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

