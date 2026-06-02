/* ---------- RECURRING (cadence manager, lives under More) ---------- */
let newRec={t:'',kind:'quick',mode:'everyN',every:1,dows:[],dom:1};

function scheduleEditor(scope, r){
  // scope: 'new' for the draft, or a recurring id for existing tasks
  const mode=recMode(r);
  const modeBtn=(m,lbl)=>`<button class="mode-pill ${mode===m?'sel':''}" data-sched="${scope}|mode|${m}">${lbl}</button>`;
  let detail='';
  if(mode==='everyN'){
    detail=`<div class="sched-detail">
      <span>every</span>
      <input type="number" min="1" max="365" class="num-in" data-sched="${scope}|every">
      <span>day(s)</span>
    </div>`;
  } else if(mode==='weekdays'){
    detail=`<div class="sched-detail dows">
      ${DOW_NAMES.map((d,i)=>`<button class="dow-pill ${(r.dows||[]).includes(i)?'sel':''}" data-sched="${scope}|dow|${i}">${d}</button>`).join('')}
    </div>`;
  } else {
    const isLast=(r.dom==='last');
    detail=`<div class="sched-detail">
      <span>on day</span>
      <input type="number" min="1" max="31" class="num-in" data-sched="${scope}|dom" ${isLast?'disabled':''}>
      <span>of each month</span>
      <button class="mode-pill ${isLast?'sel':''}" data-sched="${scope}|domlast">Last day</button>
    </div>`;
  }
  return `
    <div class="sched-modes">
      ${modeBtn('everyN','Every N days')}
      ${modeBtn('weekdays','Days of week')}
      ${modeBtn('monthDay','Day of month')}
    </div>
    ${detail}`;
}

function renderRecurring(){
  const list=[...S.recurring];
  const dueNow=dueRecurring().length;
  return `
  <div class="phead">
    <div class="kicker">Under the hood · auto-adds to your day</div>
    <h2>Recurring Tasks</h2>
    <p>Set how often something should come back and it auto-appears in your day when due. <span class="serif">"I do not trust memory. I trust systems."</span></p>
  </div>

  <div class="due-banner">
    <span class="due-num">${dueNow}</span>
    <span>recurring task${dueNow===1?'':'s'} due today${dueNow?' — already in your day':", you're clear"}</span>
  </div>

  <div class="rec-stack">
    ${list.length?list.map(r=>`
      <div class="rec-card ${recurringDue(r)?'due':''}">
        <div class="rec-top">
          <span class="rec-k ${r.kind==='quick'?'q':'p'}" data-reckind="${r.id}" title="quick / project — tap to toggle">${r.kind==='quick'?'⚡':'▣'}</span>
          <input type="text" class="rec-name" data-recname="${r.id}" value="${esc(r.t)}">
          <span class="rec-due ${recurringDue(r)?'now':''}">${nextDueLabel(r)}</span>
          <span class="rec-auto ${r.auto!==false?'on':''}" data-recauto="${r.id}" title="auto-add to day">${r.auto!==false?'auto ●':'auto ○'}</span>
          <span class="x" data-rdel="${r.id}">×</span>
        </div>
        <div class="rec-sched" data-recid="${r.id}">${scheduleEditor(r.id, r)}</div>
      </div>`).join(''):'<div class="empty">No recurring tasks. Add one below.</div>'}
  </div>

  <div class="card" style="margin-top:18px">
    <div class="card-h"><h3>Add Recurring Task</h3></div>
    <input type="text" id="newRecurring" value="${esc(newRec.t)}" placeholder="e.g. Water plants, Call accountant..." style="margin-bottom:12px">
    <div class="rec-kind-pick">
      <button class="kp-btn ${newRec.kind==='quick'?'sel':''}" data-newkind="quick">⚡ Quick task</button>
      <button class="kp-btn ${newRec.kind==='project'?'sel':''}" data-newkind="project">▣ Needs time block</button>
    </div>
    <div class="rec-sched newrec">${scheduleEditor('new', newRec)}</div>
    <button class="btn" id="addRecurring" style="width:100%">Add Recurring Task</button>
  </div>
  <p class="list-note">"Every N days" counts from when you complete it. Day-of-week and day-of-month fire on the calendar.</p>
  `;
}

function bindRecurring(){
  // existing task header edits
  q('[data-recname]','all').forEach(el=>el.oninput=()=>{ const r=S.recurring.find(x=>x.id===el.dataset.recname); if(r){ r.t=el.value; save(); } });
  q('[data-reckind]','all').forEach(el=>el.onclick=()=>{ const r=S.recurring.find(x=>x.id===el.dataset.reckind); if(r){ r.kind=r.kind==='quick'?'project':'quick'; save(); rerender(); } });
  q('[data-recauto]','all').forEach(el=>el.onclick=()=>{ const r=S.recurring.find(x=>x.id===el.dataset.recauto); if(r){ r.auto=r.auto===false?true:false; save(); rerender(); } });
  q('[data-rdel]','all').forEach(el=>el.onclick=()=>{ S.recurring=S.recurring.filter(r=>r.id!==el.dataset.rdel); save(); rerender(); });

  // resolve a scope string to the target object (draft or recurring task)
  const target=scope=> scope==='new' ? newRec : S.recurring.find(x=>x.id===scope);

  // unified schedule handlers
  q('[data-sched]','all').forEach(el=>{
    const [scope,action,val]=el.dataset.sched.split('|');
    const r=target(scope); if(!r) return;
    if(action==='mode'){
      el.onclick=()=>{ r.mode=val; ensureSchedDefaults(r); if(scope!=='new') save(); rerender(); };
    } else if(action==='dow'){
      el.onclick=()=>{ toggleDow(r,+val); r.mode='weekdays'; if(scope!=='new') save(); rerender(); };
    } else if(action==='every'){
      el.value=r.every||1;
      el.oninput=()=>{ const n=parseInt(el.value,10); if(!isNaN(n)&&n>0){ r.every=n; r.mode='everyN'; if(scope!=='new') save(); } };
    } else if(action==='dom'){
      el.value=(r.dom==='last')?'':(r.dom||1);
      el.oninput=()=>{ const n=parseInt(el.value,10); if(!isNaN(n)&&n>=1&&n<=31){ r.dom=n; r.mode='monthDay'; if(scope!=='new') save(); } };
    } else if(action==='domlast'){
      el.onclick=()=>{ r.dom=(r.dom==='last')?1:'last'; r.mode='monthDay'; if(scope!=='new') save(); rerender(); };
    }
  });

  // new-task draft text + kind
  q('[data-newkind]','all').forEach(el=>el.onclick=()=>{ newRec.kind=el.dataset.newkind; rerender(); });
  const nn=q('#newRecurring'); if(nn) nn.oninput=()=>{ newRec.t=nn.value; };
  const add=q('#addRecurring'); if(add) add.onclick=()=>{
    const v=(newRec.t||'').trim(); if(!v)return;
    if(newRec.mode==='weekdays' && !(newRec.dows||[]).length){ toast('Pick at least one day'); return; }
    const r={id:b(),t:v,kind:newRec.kind,mode:newRec.mode,auto:true,last:null};
    if(newRec.mode==='everyN') r.every=newRec.every||1;
    else if(newRec.mode==='weekdays') r.dows=(newRec.dows||[]).slice();
    else r.dom=newRec.dom||1;
    S.recurring.push(r);
    newRec={t:'',kind:'quick',mode:'everyN',every:1,dows:[],dom:1};
    save(); rerender();
  };
  const ni=q('#newRecurring'); if(ni) ni.onkeydown=e=>{ if(e.key==='Enter') q('#addRecurring').click(); };
}
function toggleDow(r,i){ if(!r.dows) r.dows=[]; const x=r.dows.indexOf(i); if(x>-1) r.dows.splice(x,1); else r.dows.push(i); }
function ensureSchedDefaults(r){
  if(r.mode==='everyN' && r.every==null) r.every=1;
  if(r.mode==='weekdays' && !Array.isArray(r.dows)) r.dows=[];
  if(r.mode==='monthDay' && r.dom==null) r.dom=1;
}
