/* ============================================================
   MarcoMaster — STATE CORE
   The pure rules that guard the one state document, shared by EVERY writer:
     • the browser loads this as a classic script, so its top-level
       declarations are globals exactly as when they lived in storage.js;
     • the MCP Cloud Function requires a copy of it. firebase.json's functions
       predeploy copies this file to functions/shared/ (a function bundle can't
       reach ../js), and functions/test checks the copy is byte-identical.
   One source, so the server can never drift from the client's idea of "how much
   data is here", "is this a catastrophic shrink", "what is the next version" or
   "what does an external op do to the state".
   Keep it pure: no DOM, no Firebase, no reads of the global S.
   ============================================================ */

/* ---------- data-protection magnitudes ---------- */
const PROTECT_FLOOR = 8;   // only guard once there's real data to protect
const NEAR_EMPTY    = 3;   // <=3 meaningful items ≈ just the default seed

/* Total planned training sessions across every day. A day holds a LIST of sessions
   (v2), so this counts sessions, not days — and it reads only the live structure,
   never the legacy tr.sessions map the v2 fold leaves behind, so nothing is
   double-counted during the transition. */
function trainingSessionCount(s){
  const days=((s||{}).training||{}).days||{};
  let n=0;
  Object.keys(days).forEach(k=>{ n+=(((days[k]||{}).sessions)||[]).length; });
  return n;
}
/* A single "how much real data is here" magnitude. Used by both the shrink guard
   and the reconciler. The default seeded state scores ~2. */
function stateCount(s){
  if(!s || typeof s!=='object') return 0;
  let n=0;
  (s.projects||[]).forEach(p=>{ n+=1; n+=((p&&p.tasks)||[]).length; });
  n+=(s.followups||[]).length;
  n+=(s.meetings||[]).length;
  n+=(s.appointments||[]).length;
  n+=(s.leaks||[]).length;
  const days=s.days||{};
  Object.keys(days).forEach(k=>{ const d=days[k]||{};
    n+=(d.tasks||[]).length + (d.pipeline||[]).length + (d.archive||[]).length + (d.checkins||[]).length + (d.spotlogs||[]).length; });
  if(s.board){ ['mustwin','scheduled','parking'].forEach(k=>{ n+=((s.board[k]||[]).length); }); }
  // Training SESSIONS only — deliberately not the exercise library. The library is
  // seeded on first run, so counting it would push a brand-new state well above
  // NEAR_EMPTY and blind the "cloud looks emptied" protection to a real wipe.
  n+=trainingSessionCount(s);
  // content IDEAS only, not pillars — seeded data must never inflate the count (see above)
  n+=((s.content||{}).ideas||[]).length;
  return n;
}
/* TRUE only for a catastrophic collapse — substantial data dropping to near-zero
   or losing >=75%. A single deletion (−1) or removing one project never trips it. */
function isCatastrophicShrink(from, to){
  if(from < PROTECT_FLOOR) return false;        // nothing substantial to protect yet
  return to <= NEAR_EMPTY || to <= from*0.25;
}
/* The durable, monotonic version stamp (state.updatedAt) a REAL write advances to.
   Math.max with prev+1 keeps it monotonic even if the clock jumps backwards. */
function nextVersion(prev){ return Math.max(Date.now(), (+prev||0)+1); }

/* a fresh, empty day record (shared by day(), dayFor() and the MCP server) */
function blankDay(){
  return {
    reset:{}, focus:{biz:'',health:'',lev:'',content:'',not:''},
    workout:'', shutdownTime:'', energy:'', mood:'', sleep:'', stress:'',
    meds:'', feelings:'', fulfillment:'',   // legacy flat journal fields (kept for Insights/Shutdown)
    // Journal v2 — morning/evening 1-5 star ratings + new text. _jrnlV2 marks a record
    // as already in the new shape so the one-time migration never re-runs on it.
    _jrnlV2:true, _jrnlCalm:true,
    morning:{ energy:null, mood:null, calm:null, intentions:'' },
    evening:{ mood:null, energy:null, calm:null, fulfillment:null, trained:null, trainNote:'', diet:'' },
    tasks:[],          // {id, txt, kind:'quick'|'project', done, mins, start:null, recurringId?, dueDate?}
    pipeline:[],       // top-3 for today: {id, txt, done, taskId?|projectId?+projTaskId?}; unfinished carry over to the next day (see _seeded bridge)
    archive:[],        // completed tasks swept here: {id, txt, kind, mins, doneAt}
    checkins:[],       // legacy throughout-day log {t, ts, energy:'Med', mood:'word'} — kept for Insights/Shutdown
    spotlogs:[],       // optional timestamped check-ins {id, time:'HH:MM', ts, mood, energy, calm, focus, note} (1-5 stars)
    tomorrow:[],       // top-3 picked at shutdown for next day  (strings)
    recurringAdded:{}, // {recurringId:true} injected into today already
    skipped:{},        // {recurringId:true} skipped this cycle
    dayStart:8,        // first hour shown on the Plan grid (24h)
    dayEnd:21,         // last hour shown
    shutdown:{ well:'',drift:'',avoid:'',trained:false,health:false,time:false,firstMove:'',clear:'' },
    // the morning screen has been passed for this day (see morningDone). Purely a
    // per-day boolean: nothing counts, totals or remembers days it wasn't set.
    morningSeen:false
  };
}

/* ============================================================
   SHARED RECORD WRITERS — the app's own create/promote functions wrap these, and
   the MCP server + every device's op replay call them, so a record has exactly one
   shape wherever it is made. The caller supplies ids and timestamps (the app: b()
   and Date.now(); the server: values fixed in the op, so replay is deterministic).
   ============================================================ */
const PIPELINE_SLOTS = 3;

/* Item: { id, title, date (YYYY-MM-DD), time (HH:MM), createdAt } — the shape the
   reminder Cloud Function reads. Used by createAppointment(). */
function appendAppointment(state, appt){
  if(!state.appointments) state.appointments=[];
  state.appointments.push(appt);
  return appt;
}
/* point: { id, txt, done:false }. Used by createMeetingPoint(). False if the meeting is gone. */
function appendMeetingPoint(state, mid, point){
  const m=(state.meetings||[]).find(x=>x && x.id===mid);
  if(!m) return false;
  if(!m.points) m.points=[];
  m.points.push(point);
  return true;
}
/* follow-up: { id, txt, note, createdAt, lastTouched, resolved } — a new one starts
   untouched (lastTouched = createdAt), open, with no note. Used by addFollowup(). */
function appendFollowup(state, f){
  if(!state.followups) state.followups=[];
  state.followups.push(f);
  return f;
}
/* how long a follow-up has been open, from lastTouched (falling back to createdAt):
   'Nd open' / 'Nh open' / 'today'. The app's followupAge() is this at Date.now(). */
function followupAgeLabel(f, now){
  const since=f.lastTouched||f.createdAt||now;
  const ms=Math.max(0, now-since);
  const d=Math.floor(ms/86400000);
  if(d>=1) return d+'d open';
  const h=Math.floor(ms/3600000);
  if(h>=1) return h+'h open';
  return 'today';
}
/* ---------- projects ---------- */
const PROJ_COLORS=['#58a6ff','#3fb950','#e3b341','#14b8a6','#bc8cff','#f778ba','#56d4dd'];
/* the colour the next project gets: the palette in order, by how many exist */
function nextProjectColor(state){ return PROJ_COLORS[((state.projects||[]).length) % PROJ_COLORS.length]; }
/* project: { id, name, color, done:false, tasks:[] }. Used by createProject(). */
function appendProject(state, p){
  if(!state.projects) state.projects=[];
  state.projects.push(p);
  return p;
}

/* ---------- deleting a task, and everything that points at it ----------
   The app's atDelete() for standalone ('S|id') and project ('P|pid|tid') tasks, so
   nothing dangles: a project task takes its linked calendar blocks and every
   pipeline item that references it (by project link, or by one of those blocks'
   ids) with it; a standalone task takes the pipeline items linked to it.
   Leak tasks are not handled here (their delete also re-derives the leak's status).
   Returns how many records it removed (task + blocks + pipeline items). */
function removeTaskEverywhere(state, key){
  const [src, a, b2]=String(key).split('|');
  const days=state.days||{};
  let n=0;
  if(src==='P'){
    const p=(state.projects||[]).find(x=>x && x.id===a); if(!p) return 0;
    const before=(p.tasks||[]).length;
    p.tasks=(p.tasks||[]).filter(x=>x.id!==b2);
    n+=before-p.tasks.length;
    if(!n) return 0;
    const linkedIds=new Set();
    Object.keys(days).forEach(dk=>{ (days[dk].tasks||[]).forEach(t=>{ if(t.projectId===a && t.projTaskId===b2) linkedIds.add(t.id); }); });
    Object.keys(days).forEach(dk=>{
      const d=days[dk];
      if(d.tasks){ const l=d.tasks.length; d.tasks=d.tasks.filter(t=>!(t.projectId===a && t.projTaskId===b2)); n+=l-d.tasks.length; }
      if(d.pipeline){ const l=d.pipeline.length; d.pipeline=d.pipeline.filter(it=>!(it.projectId===a && it.projTaskId===b2) && !linkedIds.has(it.taskId)); n+=l-d.pipeline.length; }
    });
    return n;
  }
  if(src==='S'){
    Object.keys(days).forEach(dk=>{
      const d=days[dk];
      if(d.tasks){ const l=d.tasks.length; d.tasks=d.tasks.filter(x=>x.id!==a); n+=l-d.tasks.length; }
    });
    if(!n) return 0;
    Object.keys(days).forEach(dk=>{ const d=days[dk]; if(d.pipeline){ const l=d.pipeline.length; d.pipeline=d.pipeline.filter(it=>it.taskId!==a); n+=l-d.pipeline.length; } });
    return n;
  }
  return 0;
}

/* ---------- compare-and-set, for replaying edits ----------
   An edit op carries the values it saw (from) and the ones it sets (to; a field
   listed in unset is removed). The server applies it to exactly the state it read.
   A device replays it only if each field still holds `from` — if the app changed
   that field since, the app's later edit wins and the op is skipped. Already at
   `to` → nothing to do. Returns true if it changed the record. */
function casApply(obj, from, to, unset){
  if(!obj) return false;
  const want=Object.assign({}, to||{});
  (unset||[]).forEach(k=>{ want[k]=undefined; });
  const keys=Object.keys(want);
  const same=(x,y)=>JSON.stringify(x===undefined?null:x)===JSON.stringify(y===undefined?null:y);
  if(keys.every(k=>same(obj[k], want[k]))) return false;
  if(!keys.every(k=>same(obj[k], (from||{})[k]))) return false;
  keys.forEach(k=>{ if(want[k]===undefined) delete obj[k]; else obj[k]=want[k]; });
  return true;
}

/* the task a pipeline item is linked to, as a row key ('S|…', 'P|…|…', 'L|…|…'); null for free text */
function pipelineLinkKey(it){
  if(!it) return null;
  if(it.taskId) return 'S|'+it.taskId;
  if(it.projectId) return 'P|'+it.projectId+'|'+it.projTaskId;
  if(it.leakId) return 'L|'+it.leakId+'|'+it.leakTaskId;
  return null;
}
/* Append to a day's pipeline. Never displaces: 'full' when every slot is taken (done
   items still hold their slot until cleared), 'dup' when that task is already in it,
   'ok' when added. Used by the promote*ToPipeline functions. */
function appendPipelineItem(d, item){
  if(!d.pipeline) d.pipeline=[];
  if(d.pipeline.length>=PIPELINE_SLOTS) return 'full';
  const k=pipelineLinkKey(item);
  if(k && d.pipeline.some(x=>pipelineLinkKey(x)===k)) return 'dup';
  d.pipeline.push(item);
  return 'ok';
}
/* live done-state of a pipeline item, judged in the context of the day record it sits
   in: follow the linked task if it still exists, else the item's own flag. The app's
   pipelineDone() is this with today's record; the rollover bridge judges yesterday's
   items the same way. */
function pipelineItemDone(state, dayRec, it){
  if(it.taskId){ const t=((dayRec||{}).tasks||[]).find(x=>x && x.id===it.taskId); return t?!!t.done:!!it.done; }
  if(it.projectId){ const t=extFindProjectTask(state, it.projectId, it.projTaskId); return t?!!t.done:!!it.done; }
  if(it.leakId){ const t=extFindLeakTask(state, it.leakId, it.leakTaskId); return t?!!t.done:!!it.done; }
  return !!it.done;
}
/* Yesterday's unfinished pipeline items that day()'s rollover bridge WILL append to
   today's pipeline the next time a device opens — but only while today's bridge
   hasn't run. The bridge appends without checking the cap, so anything that fills
   today's pipeline before it runs must count these, or the day could open with 4+. */
function pendingPipelineCarry(state, todayKey){
  const days=state.days||{};
  const rec=days[todayKey];
  if(rec && rec._seeded) return [];
  const prevKey=Object.keys(days).filter(k=>k<todayKey).sort().pop();
  if(!prevKey) return [];
  const prev=days[prevKey]||{};
  return (prev.pipeline||[]).filter(it=>it && !pipelineItemDone(state, prev, it));
}

/* ============================================================
   EXTERNAL OPS — task changes made OUTSIDE the app (the MCP connector / voice).
   The server applies an op to the state inside a Firestore transaction AND appends
   it to users/{uid}.extOps, a sibling field the app's own writes never touch. A
   device whose blind whole-state write lands on top of the server's (its save was
   already queued) would drop the change — so every device replays, from extOps,
   any op its state hasn't recorded in state.extApplied. Same function both sides,
   so the server's write and a device's replay can never disagree.

   state.extApplied is an ARRAY of {id, ts}, never a map: the app writes with
   set({marcomaster:S},{merge:true}), and Firestore DEEP-merges maps but replaces
   arrays whole. As a map, a device's blind write would keep the server's "applied"
   key while replacing the task list — the cloud would claim an op it no longer
   holds, and no device would ever replay it. As an array, the marker and the task
   are dropped together, so the op is replayed.

   op = { id, ts, type:'add'|'complete'|'due', dayKey, hm, task?, key?, dueDate? }
     add      — task: a complete task object (its id is fixed by the server)
     complete — key: 'S|taskId' (standalone) or 'P|projId|taskId' (project task);
                dayKey/hm: when it happened (Toronto) — stamped as doneAt exactly
                like the app does (day key on project tasks, HH:MM on standalone)
     due      — key: 'S|…', 'P|…' or 'L|leakId|taskId'; dueDate 'YYYY-MM-DD' or null
     appt     — appt: a complete appointment record (appendAppointment)
     mpoint   — meetingId, point: a complete talking point (appendMeetingPoint)
     followup — followup: a complete follow-up record (appendFollowup)
     add      — also logs a task already done (task.done true, doneAt set), as Capture's tick does
     fu_touch — followupId, ts, note?: lastTouched moves forward to ts; note (if any)
                is appended — CAS on the note the server saw
     fu_resolve — followupId, ts: resolved (CAS false → true), lastTouched forward
     prio     — key, from/to {priority}; a project task's linked blocks follow it
     edit     — key, from/to/unset over txt / kind / mins / schedDate / start / dueDate;
                a project task's linked blocks follow its text and priority
     del      — key: removeTaskEverywhere; n = records the server removed
     move     — key 'S|id', projectId: the standalone task becomes a task of that
                project (same id); pipeline items re-point to the project task
     project  — project: a complete project record (appendProject)
     appt_edit   — apptId, from/to over title / date / time (CAS)
     appt_cancel — apptId: removed, if no meeting or training session links it
     pipe     — item: a complete pipeline item linked to a task; task?: a new quick
                task to create first (the "new task + promote" case). Never displaces:
                if the pipeline filled up meanwhile, the task is kept, the item isn't.
   ctx = { todayKey, today:()=>today's day record (created if missing) }
   Idempotent: re-applying an op that is already reflected changes nothing.
   Returns true if the state changed.
   ============================================================ */

/* Find a standalone day-task by id. Searches today's record first, then the rest.
   If it is sitting UNCARRIED on the previous day — today's record exists but its
   rollover bridge (day()'s _seeded) hasn't run yet — it is moved into today exactly
   as that bridge would have moved it, so finishing it lands in Completed Today. */
function extFindStandalone(state, id, ctx){
  const days=state.days||{};
  const tk=ctx.todayKey;
  const inToday=((days[tk]||{}).tasks||[]).find(t=>t&&t.id===id);
  if(inToday) return inToday;
  const prevKey=Object.keys(days).filter(k=>k<tk).sort().pop();
  for(const dk of Object.keys(days)){
    const list=(days[dk]||{}).tasks||[];
    const i=list.findIndex(t=>t&&t.id===id);
    if(i<0) continue;
    const t=list[i];
    const carryable = dk===prevKey && !t.done && !t.recurringId && !t.workoutId && !t.projectId && !t.meetingId;
    const todayRec=days[tk];
    if(carryable && !(todayRec && todayRec._seeded)){
      const d=ctx.today();                   // on a device this IS day(), whose bridge may move it first…
      if(!d.tasks.includes(t)){              // …so move it only if that didn't already happen
        const cur=(days[dk]||{}).tasks||[];
        const j=cur.indexOf(t); if(j>=0) cur.splice(j,1);
        t.fromYesterday=true;
        if(t.kind==='project'){ t.schedDate=null; t.start=null; }   // back to today's block pool, as the bridge does
        d.tasks.push(t);
      }
    }
    return t;
  }
  return null;
}
function extFindProjectTask(state, pid, tid){
  const p=(state.projects||[]).find(x=>x&&x.id===pid);
  return p ? ((p.tasks||[]).find(x=>x&&x.id===tid)||null) : null;
}
function extFindLeakTask(state, lid, tid){
  const l=(state.leaks||[]).find(x=>x&&x.id===lid);
  return l ? ((l.tasks||[]).find(x=>x&&x.id===tid)||null) : null;
}
function extTaskIdExists(state, id){
  const days=state.days||{};
  return Object.keys(days).some(dk=>{ const d=days[dk]||{};
    return (d.tasks||[]).some(t=>t&&t.id===id) || (d.archive||[]).some(t=>t&&t.id===id); });
}
function applyExtOp(state, op, ctx){
  if(!op || !op.type) return false;
  const parts=String(op.key||'').split('|');
  if(op.type==='add'){
    const t=op.task;
    if(!t || !t.id || extTaskIdExists(state, t.id)) return false;   // already there (or swept to archive)
    if(!state.days) state.days={};
    const d=ctx.today();
    if(!d.tasks) d.tasks=[];
    d.tasks.push(JSON.parse(JSON.stringify(t)));
    return true;
  }
  if(op.type==='complete'){
    if(parts[0]==='S'){
      const t=extFindStandalone(state, parts[1], ctx);
      if(!t || t.done) return false;
      t.done=true; t.doneAt=op.hm;          // standalone tasks stamp the TIME (see markTaskDoneNow)
      return true;
    }
    if(parts[0]==='P'){
      // mirrors setProjTaskDone: stamp the DAY on the project task and keep every
      // linked time-block in sync, so progress and the Time Blocker agree
      const pid=parts[1], tid=parts[2];
      const t=extFindProjectTask(state, pid, tid);
      if(!t || t.done) return false;
      t.done=true; t.doneAt=op.dayKey;
      const days=state.days||{};
      Object.keys(days).forEach(dk=>{ ((days[dk]||{}).tasks||[]).forEach(b=>{
        if(b && b.projectId===pid && b.projTaskId===tid) b.done=true; }); });
      return true;
    }
    return false;
  }
  if(op.type==='appt'){
    const a=op.appt;
    if(!a || !a.id || (state.appointments||[]).some(x=>x && x.id===a.id)) return false;
    appendAppointment(state, JSON.parse(JSON.stringify(a)));
    return true;
  }
  if(op.type==='fu_touch' || op.type==='fu_resolve'){
    const f=(state.followups||[]).find(x=>x && x.id===op.followupId); if(!f) return false;
    let changed=false;
    if(op.type==='fu_resolve') changed=casApply(f, {resolved:false}, {resolved:true});
    if(op.note!=null) changed=casApply(f, {note:op.noteFrom}, {note:op.note}) || changed;
    if(changed || op.type==='fu_touch'){
      const lt=Math.max(+f.lastTouched||0, +op.ts||0);
      if(lt!==f.lastTouched){ f.lastTouched=lt; changed=true; }
    }
    return changed;
  }
  if(op.type==='prio' || op.type==='edit'){
    let t=null;
    if(parts[0]==='S') t=extFindStandalone(state, parts[1], ctx);
    else if(parts[0]==='P') t=extFindProjectTask(state, parts[1], parts[2]);
    else if(parts[0]==='L') t=extFindLeakTask(state, parts[1], parts[2]);
    if(!casApply(t, op.from, op.to, op.unset)) return false;
    if(parts[0]==='P'){
      // the app keeps a project task's linked calendar blocks in step (atEdit / atPriority)
      const days=state.days||{};
      Object.keys(days).forEach(dk=>{ ((days[dk]||{}).tasks||[]).forEach(b=>{
        if(b && b.projectId===parts[1] && b.projTaskId===parts[2]){ if('txt' in op.to) b.txt=t.txt; if('priority' in op.to) b.priority=t.priority; } }); });
    }
    return true;
  }
  if(op.type==='del') return removeTaskEverywhere(state, op.key)>0;
  if(op.type==='move'){
    if(parts[0]!=='S') return false;
    const p=(state.projects||[]).find(x=>x && x.id===op.projectId && !x.done); if(!p) return false;
    const days=state.days||{};
    let t=null;
    Object.keys(days).forEach(dk=>{ const d=days[dk]; const i=(d.tasks||[]).findIndex(x=>x && x.id===parts[1]);
      if(i>=0 && !t){
        const x=d.tasks[i];
        // the same tasks the server will move: open, unscheduled, not a recurring /
        // training / meeting / project-linked block — if that changed meanwhile, skip
        if(!x.done && x.schedDate==null && !x.recurringId && !x.workoutId && !x.meetingId && !x.projectId){ t=x; d.tasks.splice(i,1); }
        else t=false;
      } });
    if(!t) return false;
    // a project task's own shape (addUnifiedTask): mins only on a time block
    const pt={id:t.id, txt:t.txt, done:false, priority:!!t.priority, kind:t.kind==='project'?'project':'quick'};
    if(pt.kind==='project') pt.mins=t.mins||60;
    if(t.dueDate) pt.dueDate=t.dueDate;
    if(!p.tasks) p.tasks=[];
    p.tasks.push(pt);
    Object.keys(days).forEach(dk=>{ (days[dk].pipeline||[]).forEach(it=>{
      if(it && it.taskId===t.id){ delete it.taskId; it.projectId=p.id; it.projTaskId=t.id; } }); });
    return true;
  }
  if(op.type==='project'){
    const p=op.project;
    if(!p || !p.id || (state.projects||[]).some(x=>x && x.id===p.id)) return false;
    appendProject(state, JSON.parse(JSON.stringify(p)));
    return true;
  }
  if(op.type==='appt_edit'){
    return casApply((state.appointments||[]).find(x=>x && x.id===op.apptId), op.from, op.to);
  }
  if(op.type==='appt_cancel'){
    if(apptIsLinked(state, op.apptId)) return false;
    const l=(state.appointments||[]).length;
    state.appointments=(state.appointments||[]).filter(x=>!(x && x.id===op.apptId));
    return state.appointments.length!==l;
  }
  if(op.type==='followup'){
    const f=op.followup;
    if(!f || !f.id || (state.followups||[]).some(x=>x && x.id===f.id)) return false;
    appendFollowup(state, JSON.parse(JSON.stringify(f)));
    return true;
  }
  if(op.type==='mpoint'){
    const p=op.point;
    if(!p || !p.id || (state.meetings||[]).some(m=>m && (m.points||[]).some(x=>x && x.id===p.id))) return false;
    return appendMeetingPoint(state, op.meetingId, JSON.parse(JSON.stringify(p)));   // false if the meeting is gone
  }
  if(op.type==='pipe'){
    const it=op.item; if(!it || !it.id) return false;
    let changed=false;
    if(op.task && op.task.id && !extTaskIdExists(state, op.task.id)){
      const d=ctx.today(); if(!d.tasks) d.tasks=[];
      d.tasks.push(JSON.parse(JSON.stringify(op.task)));
      changed=true;
    }else if(it.taskId){
      // the linked task must sit in TODAY's record for pipelineDone() to follow it;
      // pull it across if the rollover hasn't (same move the bridge makes)
      const before=JSON.stringify(((state.days||{})[ctx.todayKey]||{}).tasks||null);
      extFindStandalone(state, it.taskId, ctx);
      if(JSON.stringify(((state.days||{})[ctx.todayKey]||{}).tasks||null)!==before) changed=true;
    }
    // the app only ever promotes a task that exists — so does replay (deleted meanwhile → skip)
    const linked = it.taskId ? extTaskIdExists(state, it.taskId)
                 : it.projectId ? !!extFindProjectTask(state, it.projectId, it.projTaskId)
                 : it.leakId ? !!extFindLeakTask(state, it.leakId, it.leakTaskId) : true;
    if(!linked) return changed;
    const d=ctx.today();
    if((d.pipeline||[]).some(x=>x && x.id===it.id)) return changed;
    if(appendPipelineItem(d, JSON.parse(JSON.stringify(it)))==='ok') changed=true;
    return changed;
  }
  if(op.type==='due'){
    let t=null;
    if(parts[0]==='S') t=extFindStandalone(state, parts[1], ctx);
    else if(parts[0]==='P') t=extFindProjectTask(state, parts[1], parts[2]);
    else if(parts[0]==='L') t=extFindLeakTask(state, parts[1], parts[2]);
    if(!t) return false;
    const want=op.dueDate||null;
    if((t.dueDate||null)===want) return false;
    if(want) t.dueDate=want; else delete t.dueDate;
    return true;
  }
  return false;
}

/* the applied-op markers as a list of {id, ts} (tolerates a missing/garbled field) */
/* is an appointment tied to a meeting (m.apptId) or a training session (s.apptId)?
   Rescheduling or removing those has to go through their own screens. */
function apptIsLinked(state, id){
  if((state.meetings||[]).some(m=>m && m.apptId===id)) return true;
  const days=((state.training||{}).days)||{};
  return Object.keys(days).some(k=>(((days[k]||{}).sessions)||[]).some(s=>s && s.apptId===id));
}
function extAppliedList(state){
  const v=state && state.extApplied;
  return Array.isArray(v) ? v.filter(x=>x && typeof x.id==='string') : [];
}

/* Node (the MCP Cloud Function). In the browser `module` is undefined and the
   declarations above are plain globals. */
if(typeof module!=='undefined' && module.exports){
  module.exports={ PROTECT_FLOOR, NEAR_EMPTY, trainingSessionCount, stateCount, isCatastrophicShrink,
                   nextVersion, blankDay, applyExtOp, extAppliedList,
                   PIPELINE_SLOTS, appendAppointment, appendMeetingPoint, pipelineLinkKey, appendPipelineItem,
                   pipelineItemDone, pendingPipelineCarry, appendFollowup, followupAgeLabel,
                   PROJ_COLORS, nextProjectColor, appendProject, removeTaskEverywhere, casApply, apptIsLinked };
}
