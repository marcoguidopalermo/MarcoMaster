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
function extAppliedList(state){
  const v=state && state.extApplied;
  return Array.isArray(v) ? v.filter(x=>x && typeof x.id==='string') : [];
}

/* Node (the MCP Cloud Function). In the browser `module` is undefined and the
   declarations above are plain globals. */
if(typeof module!=='undefined' && module.exports){
  module.exports={ PROTECT_FLOOR, NEAR_EMPTY, trainingSessionCount, stateCount, isCatastrophicShrink,
                   nextVersion, blankDay, applyExtOp, extAppliedList };
}
