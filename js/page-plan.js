/* ============================================================
   PLAN PAGE — time-block grid for today's projects
   Hybrid: real hours, but blocks cascade when bumped.
   ============================================================ */
let planSelected=null;   // id of task picked for click-to-place
let planView='day';      // 'day' | 'week' | 'month'
let planDate=null;       // dateKey being viewed in Day view (null => today)

function curPlanDate(){ return planDate||todayKey(); }
function planDateShift(n){
  const [y,m,d]=curPlanDate().split('-').map(Number);
  const dt=new Date(y,m-1,d); dt.setDate(dt.getDate()+n);
  planDate=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');
  if(planDate===todayKey()) planDate=null;
}

function renderPlan(){
  const tabs=`
    <div class="plan-tabs">
      ${['day','week','month'].map(v=>`<button class="plan-tab ${planView===v?'active':''}" data-planview="${v}">${cap(v)}</button>`).join('')}
    </div>`;
  if(planView==='week') return planHead()+tabs+renderWeekView();
  if(planView==='month') return planHead()+tabs+renderMonthView();
  return planHead()+tabs+renderDayView();
}
function planHead(){
  return `
  <div class="phead compact">
    <div class="kicker">Time Blocker</div>
    <h2>Time Blocker</h2>
  </div>`;
}

/* The bare hour grid + positioned blocks for one date. Single grid implementation
   shared by the Time Blocker Day view and the project-task scheduler modal.
   opts: { droppable, hint, selectedSlot, previewMins, previewLabel } */
function planGridInner(dk, opts){
  opts=opts||{};
  const ws=(S.settings&&S.settings.dayStart)||8, we=(S.settings&&S.settings.dayEnd)||21;
  const ROW=56;   // px per hour row
  const isToday=(dk===todayKey());
  const now=new Date(); const nowH=now.getHours()+now.getMinutes()/60;
  const sel=opts.selectedSlot;
  // background hour rows (clickable slots)
  let rows='';
  for(let h=ws; h<=we; h++){
    const isNow=(isToday && h===Math.floor(nowH));
    rows+=`
      <div class="hourrow ${isNow?'now':''}">
        <div class="hourlabel">${fmtHour(h)}</div>
        <div class="hourslot ${opts.droppable?'droppable':''} ${sel===h?'over':''}" data-slot="${h}">
          ${opts.droppable?`<div class="drop-hint">${opts.hint||('drop · '+fmtHour(h))}</div>`:''}
        </div>
      </div>`;
  }
  // scheduled blocks, absolutely positioned over the column, sized by duration
  let blocks='';
  scheduledOn(dk).forEach(e=>{
    const t=e.t;
    const top=(t.start-ws)*ROW;
    const height=Math.max(24,(t.mins/60)*ROW - 4);
    blocks+=planBlock(t, top, height);
  });
  // ghost "preview" block showing where the task being scheduled would land
  if(opts.previewMins && sel!=null){
    const top=(sel-ws)*ROW; const height=Math.max(24,(opts.previewMins/60)*ROW-4);
    blocks+=`<div class="planblock preview" style="top:${top}px;height:${height}px">
      <div class="pb-main"><span class="pb-txt">${esc(opts.previewLabel||'New block')}</span>
      <span class="pb-time">${fmtHour(sel)} · ${fmtDuration(opts.previewMins)}</span></div></div>`;
  }
  const gridHeight=(we-ws+1)*ROW;
  // "now" line
  let nowLine='';
  if(isToday && nowH>=ws && nowH<=we+1){
    nowLine=`<div class="now-line" style="top:${(nowH-ws)*ROW}px"></div>`;
  }
  return `
  <div class="card flush plan-grid" style="position:relative">
    <div class="hourrows">${rows}</div>
    <div class="block-layer" style="height:${gridHeight}px">${blocks}${nowLine}</div>
  </div>`;
}

function renderDayView(){
  const dk=curPlanDate();
  const isToday=(dk===todayKey());
  const dt=dateFromKey(dk);
  const dateLabel=isToday?'Today':dt.toLocaleDateString('en-CA',{weekday:'long',month:'long',day:'numeric'});
  const pool=poolUnscheduled();          // all unscheduled time-block tasks
  return `
  <div class="date-nav">
    <button class="date-arrow" id="planPrev">◀</button>
    <div class="date-cur ${isToday?'today':''}">${dateLabel}</div>
    <button class="date-arrow" id="planNext">▶</button>
    ${!isToday?`<button class="btn ghost sm" id="planToday">Today</button>`:''}
    <button class="btn ghost sm" id="interruptBtn" style="margin-left:auto">⏱ Push</button>
    <button class="btn ghost sm" id="clearSched">↺ Clear</button>
  </div>

  <div class="plan-wrap">
    <div class="grid-col">
      ${planGridInner(dk, {droppable:!!planSelected})}
    </div>

    <div class="unsched-col">
      <div class="card">
        <div class="card-h"><h3>Needs scheduling</h3><span class="sub">${pool.length}</span></div>
        ${planSelected?`<div class="place-banner">Tap an hour to place on ${isToday?'today':shortDate(dk)} ↞ <span id="cancelPlace">cancel</span></div>`:''}
        <div class="unsched-list">
          ${pool.length?pool.map(e=>`
            <div class="unsched-item ${planSelected===e.t.id?'picked':''}" draggable="true" data-drag="${e.t.id}" data-pick="${e.t.id}">
              <span class="dot">▣</span>
              <span class="utxt">${esc(e.t.txt)}</span>
              <span class="umins">${fmtDuration(e.t.mins)}</span>
            </div>`).join(''):'<div class="empty">Nothing to schedule ✓</div>'}
        </div>
        <div class="task-add" style="margin-top:14px">
          <input type="text" id="planQuickAdd" placeholder="Add a task...">
          <button class="btn sm" id="planQuickAddBtn">+</button>
        </div>
      </div>
    </div>
  </div>
  `;
}

/* ---- WEEK / MONTH read-only overviews ---- */
function dayKeyOffset(n){
  const d=new Date(); d.setDate(d.getDate()+n);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
/* what's scheduled on a given date: time-block tasks with schedDate===k. No recurring. */
function agendaFor(k){
  return allTimeBlockTasks()
    .filter(e=>e.t.schedDate===k)
    .sort((a,b)=>(a.t.start||0)-(b.t.start||0))
    .map(e=>({txt:e.t.txt, time:e.t.start!=null?fmtHour(e.t.start):'', done:e.t.done}));
}
function renderWeekView(){
  const todayK=todayKey();
  let cols='';
  for(let i=0;i<7;i++){
    const k=dayKeyOffset(i);
    const dt=dateFromKey(k);
    const items=agendaFor(k);
    cols+=`
      <div class="wk-day ${k===todayK?'is-today':''}">
        <div class="wk-day-h">
          <span class="wk-dow">${DOW_NAMES[dt.getDay()]}</span>
          <span class="wk-date">${dt.getDate()}</span>
          ${k===todayK?'<span class="wk-now">today</span>':''}
        </div>
        <div class="wk-items">
          ${items.length?items.map(it=>`
            <div class="wk-item block">
              ${it.time?`<span class="wk-time">${it.time}</span>`:''}
              <span class="${it.done?'wk-done':''}">${esc(it.txt)}</span>
            </div>`).join(''):'<div class="wk-empty">—</div>'}
        </div>
      </div>`;
  }
  return `
  <p class="list-note" style="margin-top:0;margin-bottom:14px">Next 7 days — scheduled tasks only.</p>
  <div class="week-grid">${cols}</div>`;
}
function renderMonthView(){
  const now=new Date();
  const year=now.getFullYear(), month=now.getMonth();
  const first=new Date(year,month,1);
  const dim=new Date(year,month+1,0).getDate();
  const startDow=first.getDay();
  const todayK=todayKey();
  let cells='';
  // leading blanks
  for(let i=0;i<startDow;i++) cells+=`<div class="mo-cell blank"></div>`;
  for(let dnum=1;dnum<=dim;dnum++){
    const k=year+'-'+String(month+1).padStart(2,'0')+'-'+String(dnum).padStart(2,'0');
    const items=agendaFor(k);
    cells+=`
      <div class="mo-cell ${k===todayK?'is-today':''} ${dnum<now.getDate()?'past':''}">
        <span class="mo-num">${dnum}</span>
        ${items.length?`<span class="mo-dot block" title="${items.length} scheduled">●${items.length>1?items.length:''}</span>`:''}
      </div>`;
  }
  const monthName=now.toLocaleDateString('en-CA',{month:'long',year:'numeric'});
  return `
  <p class="list-note" style="margin-top:0;margin-bottom:14px">${monthName} — ● = scheduled tasks.</p>
  <div class="month-grid-head">${DOW_NAMES.map(d=>`<span>${d}</span>`).join('')}</div>
  <div class="month-grid">${cells}</div>`;
}

function planBlock(t, top, height){
  return `
  <div class="planblock scheduled" data-block="${t.id}" style="top:${top}px;height:${height}px">
    <div class="pb-main">
      <span class="pb-txt">${esc(t.txt)}</span>
      <span class="pb-time">${schedLabel(t)} · <span class="pb-dur" data-blockdur="${t.id}">${fmtDuration(t.mins)}</span></span>
    </div>
    <div class="pb-actions">
      <span class="pb-btn" data-bump="${t.id}" title="Unschedule">↧</span>
      <span class="pb-btn" data-pdone="${t.id}" title="Done">✓</span>
    </div>
  </div>`;
}

function hourOptions(sel,from,to){
  let o='';
  for(let h=from;h<=to;h++) o+=`<option value="${h}" ${h===sel?'selected':''}>${fmtHour(h)}</option>`;
  return o;
}

/* does placing task `id` (mins long) at `slot` overlap an existing block on date dk? */
function slotConflict(dk,id,slot,mins){
  const span=mins/60;
  return scheduledOn(dk).some(e=>{
    if(e.t.id===id) return false;
    const s=e.t.start, en=s+(e.t.mins/60);
    const ns=slot, nen=slot+span;
    return ns<en && nen>s;   // intervals overlap
  });
}
/* first non-conflicting half-hour slot at/after `fromHour` for a `mins`-long block
   on date `dk`, ignoring task `excludeId`. Returns `fromHour` unchanged if it's
   already free. Shared by the time blocker and the project-task scheduler. */
function firstFreeSlot(dk, fromHour, mins, excludeId){
  const we=(S.settings&&S.settings.dayEnd)||21;
  const span=mins/60;
  let slot=fromHour;
  while(slot+span<=we+1 && slotConflict(dk,excludeId,slot,mins)) slot+=0.5;
  return slot;
}
function placeProject(id,hour){
  const e=findTaskGlobal(id); if(!e) return;
  const t=e.t; const dk=curPlanDate();
  // find first non-conflicting slot at/after requested hour, half-hour granularity
  t.schedDate=dk; t.start=firstFreeSlot(dk, hour, t.mins, id);
  save(); planSelected=null; rerender();
}

function bindPlan(){
  // view tabs (always present)
  q('[data-planview]','all').forEach(el=>el.onclick=()=>{ planView=el.dataset.planview; rerender(); });
  if(planView!=='day') return;   // week/month are read-only

  // drag & drop
  q('[data-drag]','all').forEach(el=>{
    el.ondragstart=e=>{ e.dataTransfer.setData('text/plain',el.dataset.drag); el.classList.add('dragging'); };
    el.ondragend=()=>el.classList.remove('dragging');
  });
  q('[data-slot]','all').forEach(slot=>{
    slot.ondragover=e=>{ e.preventDefault(); slot.classList.add('over'); };
    slot.ondragleave=()=>slot.classList.remove('over');
    slot.ondrop=e=>{ e.preventDefault(); slot.classList.remove('over');
      const id=e.dataTransfer.getData('text/plain'); if(id) placeProject(id,+slot.dataset.slot);
    };
    // click-to-place (mobile / reliable fallback)
    slot.onclick=()=>{ if(planSelected) placeProject(planSelected,+slot.dataset.slot); };
  });
  // pick a project (tap)
  q('[data-pick]','all').forEach(el=>el.onclick=(e)=>{
    e.stopPropagation();
    planSelected = planSelected===el.dataset.pick ? null : el.dataset.pick;
    rerender();
  });
  const cp=q('#cancelPlace'); if(cp) cp.onclick=()=>{ planSelected=null; rerender(); };

  // date navigation
  const pp=q('#planPrev'); if(pp) pp.onclick=()=>{ planDateShift(-1); planSelected=null; rerender(); };
  const pn=q('#planNext'); if(pn) pn.onclick=()=>{ planDateShift(1); planSelected=null; rerender(); };
  const pt=q('#planToday'); if(pt) pt.onclick=()=>{ planDate=null; planSelected=null; rerender(); };

  // block actions — clear schedDate to send back to the pool
  q('[data-bump]','all').forEach(el=>el.onclick=(e)=>{
    e.stopPropagation();
    const found=findTaskGlobal(el.dataset.bump); if(found){ found.t.start=null; found.t.schedDate=null; save(); rerender(); }
  });
  // adjust duration on a scheduled block
  q('[data-blockdur]','all').forEach(el=>el.onclick=(e)=>{
    e.stopPropagation();
    openDurationPicker(el.dataset.blockdur);
  });
  q('[data-pdone]','all').forEach(el=>el.onclick=(e)=>{
    e.stopPropagation();
    const found=findTaskGlobal(el.dataset.pdone);
    if(found){
      const t=found.t; t.done=true;
      if(t.projectId && t.projTaskId){ const p=S.projects.find(x=>x.id===t.projectId); const pt2=p&&p.tasks.find(x=>x.id===t.projTaskId); if(pt2) pt2.done=true; }
      save(false); toast('Done ✓'); rerender();
    }
  });

  // toolbar
  const ib=q('#interruptBtn'); if(ib) ib.onclick=openInterrupt;
  const cs=q('#clearSched'); if(cs) cs.onclick=()=>{
    const dk=curPlanDate();
    scheduledOn(dk).forEach(e=>{ e.t.start=null; e.t.schedDate=null; });
    save(); toast('Cleared'); rerender();
  };

  // add task from plan (lands in today's list, unscheduled, in the pool)
  const qa=q('#planQuickAddBtn'); const doAdd=()=>{
    const i=q('#planQuickAdd'); const v=i.value.trim(); if(!v)return; addTask(v,'project'); rerender();
  };
  if(qa) qa.onclick=doAdd;
  const qi=q('#planQuickAdd'); if(qi) qi.onkeydown=e=>{ if(e.key==='Enter') doAdd(); };
}

/* ---------- interruption modal: push the day OR bump one block ---------- */
function openInterrupt(){
  const m=q('#resetModal'); const dk=curPlanDate(); const sched=scheduledOn(dk);
  m.innerHTML=`
    <div class="modal">
      <span class="modal-close" id="intClose">×</span>
      <h3>Something came up</h3>
      <p class="intro">Pick how to absorb it. The plan flexes — you don't blow up the whole day.</p>

      <div class="qf">
        <label>Option A — Push everything down</label>
        <div class="int-row">
          <span>Bump all upcoming blocks by</span>
          <select id="pushMins">
            <option value="15">15 min</option>
            <option value="30" selected>30 min</option>
            <option value="60">1 hour</option>
            <option value="90">90 min</option>
          </select>
          <button class="btn sm" id="doPush">Push day</button>
        </div>
      </div>

      <div class="qf" style="margin-top:18px">
        <label>Option B — Send one block back to the pool</label>
        ${sched.length?`<div class="int-blocks">
          ${sched.map(e=>`<button class="int-block" data-intbump="${e.t.id}">${fmtHour(e.t.start)} · ${esc(e.t.txt)}</button>`).join('')}
        </div>`:'<div class="empty">Nothing scheduled to bump yet.</div>'}
      </div>

      <div class="btn-row" style="margin-top:20px">
        <button class="btn ghost" id="intCancel">Close</button>
      </div>
    </div>`;
  m.classList.add('show');
  q('#intClose').onclick=closeReset;
  q('#intCancel').onclick=closeReset;
  const we=(S.settings&&S.settings.dayEnd)||21;
  q('#doPush').onclick=()=>{
    const mins=+q('#pushMins').value; const delta=mins/60;
    const now=new Date(); const nowH=now.getHours()+now.getMinutes()/60;
    const isToday=(dk===todayKey());
    scheduledOn(dk).forEach(e=>{ if(!isToday || e.t.start>=nowH){ e.t.start=Math.min(we, e.t.start+delta); } });
    save(); closeReset(); toast('Pushed '+mins+'m'); rerender();
  };
  q('[data-intbump]','all').forEach(el=>el.onclick=()=>{
    const found=findTaskGlobal(el.dataset.intbump); if(found){ found.t.start=null; found.t.schedDate=null; save(); closeReset(); toast('Back to pool'); rerender(); }
  });
}

/* ---------- duration picker modal (used in Time Blocker) ---------- */
function openDurationPicker(taskId){
  const found=findTaskGlobal(taskId); if(!found) return;
  const t=found.t;
  const m=q('#resetModal');
  m.innerHTML=`
    <div class="modal">
      <span class="modal-close" id="dpClose">×</span>
      <h3>Duration</h3>
      <p class="intro">How long for "${esc(t.txt)}"?</p>
      <div class="dur-pick" style="margin-bottom:14px">
        ${DURATION_PRESETS.map(mins=>`<button class="dur-btn ${t.mins===mins?'sel':''}" data-dpset="${mins}">${fmtDuration(mins)}</button>`).join('')}
      </div>
      <div class="dur-custom-row">
        <span class="dur-lab">Custom:</span>
        <input type="number" min="1" max="600" id="dpCustomInput" value="${!DURATION_PRESETS.includes(t.mins)?t.mins:''}" placeholder="minutes" class="num-in">
        <button class="btn sm" id="dpCustomSet">Set</button>
      </div>
    </div>`;
  m.classList.add('show');
  q('#dpClose').onclick=closeReset;
  q('[data-dpset]','all').forEach(el=>el.onclick=()=>{ t.mins=+el.dataset.dpset; save(); closeReset(); rerender(); });
  const setCustom=()=>{
    const ci=q('#dpCustomInput'); const n=parseInt(ci.value,10);
    if(!isNaN(n)&&n>0){ t.mins=n; save(); closeReset(); rerender(); }
  };
  const cs=q('#dpCustomSet'); if(cs) cs.onclick=setCustom;
  const ci=q('#dpCustomInput'); if(ci) ci.onkeydown=e=>{ if(e.key==='Enter') setCustom(); };
}
