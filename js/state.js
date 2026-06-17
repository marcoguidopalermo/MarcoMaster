/* ---------- global state ---------- */
let S = {};   // full app state, persisted under 'marcomaster'

function loadState(){
  // INSTANT, synchronous, no network: load from the local cache (or seeded
  // defaults for a first run) so the app can render immediately. Cloud data is
  // reconciled in the background afterwards by subscribeCloud(). Never throws.
  S = Store._lsGet('marcomaster') || {};
  seedDefaults();
}

/* the two starter projects (fresh objects each call) */
function defaultProjects(){
  return [
    {id:b(), name:'CrewMaster', color:'#58a6ff', done:false, tasks:[]},
    {id:b(), name:'Backyard Landscaping', color:'#3fb950', done:false, tasks:[]},
  ];
}

/* Fill S with default state and run schema migrations. Idempotent — safe to call
   more than once and only fills in what's missing. */
function seedDefaults(){
  if(!S || typeof S!=='object') S={};
  // one-time migration: state saved before durable versioning has no updatedAt.
  // Treat it as version 0 (the oldest possible) so any real edit — local or from
  // the cloud — out-ranks it, and the first save() bumps it to a live timestamp.
  if(S.updatedAt==null) S.updatedAt=0;
  // seed defaults once
  if(!S.recurring){
    S.recurring = JSON.parse(JSON.stringify(DEFAULT_RECURRING));
    // first-run staggering: only daily tasks are due immediately; longer cadences
    // start their clock today so they surface on their natural schedule, not all at once
    const k=todayKey();
    S.recurring.forEach(r=>{ if(r.every>1) r.last=k; });
  }
  if(!S.rules) S.rules = [...DEFAULT_RULES];
  if(!S.board) S.board = JSON.parse(JSON.stringify(DEFAULT_BOARD));
  if(!S.season) S.season = 'Business Stabilization + Health Rebuild + Content Restart';
  if(!S.narrative) S.narrative = '';
  if(!S.projects) S.projects = defaultProjects();
  // one-time backfill: if an existing account ended up with an empty projects
  // list, seed the two defaults once (the flag stops it re-seeding if the user
  // later deletes them all on purpose, and prevents duplicates).
  if(S.projects.length===0 && !S._projectsSeeded) S.projects = defaultProjects();
  S._projectsSeeded = true;
  // migrate: ensure every project has a tasks array + a notes string
  S.projects.forEach(p=>{ if(!p.tasks) p.tasks=[]; if(p.note==null) p.note=''; });
  if(!S.followups) S.followups = [];      // persistent open loops (new + existing accounts)
  if(!S.appointments) S.appointments = []; // fixed date/time commitments
  if(!S.meetings) S.meetings = [];        // recurring people/meetings: talking points + notes (migration: existing accounts get [])
  // migrate meetings for scheduling: nextMeeting (date/time) + linked appointment/block ids
  S.meetings.forEach(m=>{
    if(m.nextMeeting===undefined) m.nextMeeting=null;
    if(m.apptId===undefined) m.apptId=null;
    if(m.blockId===undefined) m.blockId=null;
  });
  if(!S.theme) S.theme='dark';
  if(!S.recurringDone) S.recurringDone = {};   // legacy; kept for back-compat
  if(!S.days) S.days = {};        // per-day "today" data
  if(!S.weeks) S.weeks = {};      // per-week review + scorecard
  // "This Week" / "This Month" goals: simple top-level free-text notes. Persist
  // until the user rewrites them — no auto-reset, no day-record coupling.
  if(S.weeklyGoals==null) S.weeklyGoals = '';
  if(S.monthlyGoals==null) S.monthlyGoals = '';
  if(!S.mode) S.mode = 'open';
  // settings (editable reset checklist, day window, etc.)
  if(!S.settings) S.settings = {
    resetSteps: DEFAULT_RESET_STEPS.map(s=>({id:s[0],label:s[1]})),
    dayStart: 8, dayEnd: 21,
    autoAddRecurring: true,
    showMore: false,
  };
  if(!S.settings.resetSteps) S.settings.resetSteps = DEFAULT_RESET_STEPS.map(s=>({id:s[0],label:s[1]}));
  if(S.settings.dayStart==null) S.settings.dayStart=8;
  if(S.settings.dayEnd==null) S.settings.dayEnd=21;
  if(S.settings.autoAddRecurring==null) S.settings.autoAddRecurring=true;
  if(S.settings.showMore==null) S.settings.showMore=false;
  // migrate old recurring shape ({f:'daily'}) → cadence model
  const FREQ_DAYS={daily:1,weekly:7,monthly:30,quarterly:90};
  S.recurring.forEach(r=>{
    if(r.every==null && r.mode==null){ r.every = FREQ_DAYS[r.f]||1; }
    if(r.mode==null){ r.mode='everyN'; if(r.every==null) r.every=1; }
    if(r.kind==null){ r.kind = (r.every&&r.every<=1)?'quick':'project'; }
    if(r.auto==null){ r.auto = true; }
    if(!('last' in r)){ r.last = null; }
  });
  // migrate scheduled tasks (had start, no schedDate) across all days
  Object.keys(S.days||{}).forEach(dk=>{
    (S.days[dk].tasks||[]).forEach(t=>{ if(t.kind==='project' && t.start!=null && t.schedDate==null) t.schedDate=dk; });
  });
}
/* returns true only if the cloud write committed.
   opts.bump=false preserves the current in-state version (updatedAt) instead of
   advancing it — used by the startup re-persist so first render doesn't falsely
   mark local as newest. Real edits go through save()/persist() and DO bump. */
async function persist(opts){ return await Store.set('marcomaster', S, opts); }

let saveTimer=null;
function save(showToast=true){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(async()=>{
    setSyncStatus('syncing');             // persistent indicator: write in flight
    const synced=await persist();
    if(synced){
      setSyncWarning(false);              // cloud confirmed
      setSyncStatus('synced', Date.now());
      if(showToast) toast('Saved ✓');
    }else{
      setSyncWarning(true);               // visible: changes are NOT in the cloud
      setSyncStatus(FB.user?'error':'local');
    }
  }, 350);
}
function toast(msg='Saved ✓'){
  const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(t._tm); t._tm=setTimeout(()=>t.classList.remove('show'),1400);
}

/* a fresh, empty day record (shared by day() and dayFor()) */
function blankDay(){
  return {
    reset:{}, focus:{biz:'',health:'',lev:'',content:'',not:''},
    workout:'', shutdownTime:'', energy:'', mood:'', sleep:'', stress:'',
    meds:'', feelings:'', fulfillment:'',   // journal fields (reflection tab)
    tasks:[],          // {id, txt, kind:'quick'|'project', done, mins, start:null, recurringId?}
    pipeline:[],       // top-3 for today: {id, txt, done, taskId?|projectId?+projTaskId?}; unfinished carry over to the next day (see _seeded bridge)
    archive:[],        // completed tasks swept here: {id, txt, kind, mins, doneAt}
    checkins:[],       // {t:'HH:MM', ts, energy:1-5, mood:'word'}  throughout-day log
    tomorrow:[],       // top-3 picked at shutdown for next day  (strings)
    recurringAdded:{}, // {recurringId:true} injected into today already
    skipped:{},        // {recurringId:true} skipped this cycle
    dayStart:8,        // first hour shown on the Plan grid (24h)
    dayEnd:21,         // last hour shown
    shutdown:{ well:'',drift:'',avoid:'',trained:false,health:false,time:false,firstMove:'',clear:'' }
  };
}
/* get-or-create ANY day's record (e.g. a future date a meeting is scheduled on).
   Unlike day() it runs no migrations or rollover bridge — those run when that
   date actually becomes "today". Used by meeting scheduling to land a block on a
   future day's tasks so it shows on the Time Blocker grid. */
function dayFor(dk){
  if(!S.days[dk]) S.days[dk]=blankDay();
  return S.days[dk];
}

/* today's data object (auto-creates, never carries checkmarks forward) */
function day(){
  const k=todayKey();
  if(!S.days[k]) S.days[k]=blankDay();
  const d=S.days[k];
  // migrations for days created before these fields existed
  if(!d.tasks) d.tasks=[];
  if(!d.pipeline) d.pipeline=[];
  if(!d.archive) d.archive=[];
  if(!d.checkins) d.checkins=[];
  if(!d.tomorrow) d.tomorrow=[];
  if(!d.recurringAdded) d.recurringAdded={};
  if(!d.skipped) d.skipped={};
  if(d.meds==null) d.meds='';
  if(d.feelings==null) d.feelings='';
  if(d.fulfillment==null) d.fulfillment='';
  if(d.dayStart==null) d.dayStart=(S.settings&&S.settings.dayStart)||8;
  if(d.dayEnd==null) d.dayEnd=(S.settings&&S.settings.dayEnd)||21;
  // migrate: a task that had a start hour but no schedDate was scheduled for its own day
  d.tasks.forEach(t=>{ if(t.kind==='project' && t.start!=null && t.schedDate==null) t.schedDate=k; });
  // bridge: if this day is brand new and yesterday flagged a top-3, seed them once
  if(!d._seeded){
    d._seeded=true;
    const prevKey=Object.keys(S.days).filter(x=>x<k).sort().pop();
    if(prevKey){
      const prev=S.days[prevKey];
      const picks=(prev.tomorrow||[]).filter(p=>p&&p.trim());
      picks.forEach(p=>d.tasks.push({id:b(),txt:p,kind:'project',done:false,mins:60,start:null,schedDate:null,fromYesterday:true}));
      // carry UNFINISHED one-off (non-recurring) tasks forward; completed ones and
      // recurring tasks stay put (recurring is re-injected fresh by the engine, so
      // carrying it would double-add). MOVE (not copy) the task objects out of the
      // previous day so each appears exactly once — no duplication in the global
      // time-block pool, and (with the _seeded guard below) no re-carry on reload.
      const carryTasks=(prev.tasks||[]).filter(t=>!t.done && !t.recurringId);
      if(carryTasks.length){
        carryTasks.forEach(t=>{
          t.fromYesterday=true;
          if(t.kind==='project'){ t.schedDate=null; t.start=null; }  // back to today's block pool
          d.tasks.push(t);
        });
        prev.tasks=(prev.tasks||[]).filter(t=>t.done || t.recurringId);  // remove the moved ones
      }
      // carry UNFINISHED pipeline items into the new day; completed ones drop.
      // The pipeline lives on the day record, so a new day would otherwise start
      // empty — but it's set the night before, so open focuses must survive.
      // "Completed" is judged in the previous day's context (its task / the
      // persistent project task / the item's own flag), mirroring pipelineDone().
      (prev.pipeline||[]).forEach(it=>{
        let done;
        if(it.taskId){ const t=(prev.tasks||[]).find(x=>x.id===it.taskId); done=t?t.done:!!it.done; }
        else if(it.projectId){ const p=(S.projects||[]).find(x=>x.id===it.projectId); const t=p&&(p.tasks||[]).find(x=>x.id===it.projTaskId); done=t?t.done:!!it.done; }
        else { done=!!it.done; }
        if(done) return;                      // completed → drop on the new day
        const carried={id:b(), txt:it.txt, done:false};
        if(it.projectId){ carried.projectId=it.projectId; carried.projTaskId=it.projTaskId; }  // keep persistent project link
        d.pipeline.push(carried);
      });
    }
    if(typeof persist==='function') Promise.resolve().then(persist);
  }
  return d;
}

/* numeric energy map for charts/averages */
const ENERGY_NUM={Low:1,Medium:2,High:3};
function energyToNum(v){ return ENERGY_NUM[v]||null; }

