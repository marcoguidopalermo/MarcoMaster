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
  // Future Self Narrative: structured {full, condensed, principles}. Migration is
  // non-destructive — a legacy plain-string narrative is preserved into .full.
  if(typeof S.narrative==='string') S.narrative = { full:S.narrative, condensed:'', principles:'' };
  if(!S.narrative || typeof S.narrative!=='object' || Array.isArray(S.narrative)) S.narrative = { full:'', condensed:'', principles:'' };
  if(S.narrative.full==null) S.narrative.full='';
  if(S.narrative.condensed==null) S.narrative.condensed='';
  if(S.narrative.principles==null) S.narrative.principles='';
  if(!S.projects) S.projects = defaultProjects();
  // one-time backfill: if an existing account ended up with an empty projects
  // list, seed the two defaults once (the flag stops it re-seeding if the user
  // later deletes them all on purpose, and prevents duplicates).
  if(S.projects.length===0 && !S._projectsSeeded) S.projects = defaultProjects();
  S._projectsSeeded = true;
  // migrate: ensure every project has a tasks array + a notes string + task priority flags
  S.projects.forEach(p=>{ if(!p.tasks) p.tasks=[]; if(p.note==null) p.note=''; p.tasks.forEach(t=>{ if(t.priority==null) t.priority=false; }); });
  if(!S.followups) S.followups = [];      // persistent open loops (new + existing accounts)
  if(!S.appointments) S.appointments = []; // fixed date/time commitments
  // migrate: appointments gain a done flag (completing is distinct from deleting)
  S.appointments.forEach(a=>{ if(a.done==null) a.done=false; });
  if(!S.meetings) S.meetings = [];        // recurring people/meetings: talking points + notes (migration: existing accounts get [])
  // migrate meetings for scheduling: nextMeeting (date/time) + linked appointment/block ids
  S.meetings.forEach(m=>{
    if(m.nextMeeting===undefined) m.nextMeeting=null;
    if(m.apptId===undefined) m.apptId=null;
    if(m.blockId===undefined) m.blockId=null;
    // migrate: the meeting LOG (dated snapshots of finished occurrences). Existing
    // meetings start EMPTY and stay that way — history is never reconstructed from
    // their current points, which carry no dates and cannot be attributed to any
    // occurrence. The log fills from the next completion onward.
    if(!Array.isArray(m.log)) m.log=[];
  });
  // Vision board: a URL string only — the image bytes live in Cloud Storage (see
  // js/vision.js). Non-destructive: existing accounts get null and nothing else
  // changes. Invisible to stateCount(), so the shrink-guard is unaffected.
  if(S.visionBoard===undefined) S.visionBoard=null;
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
  // Notification settings (drives the Cloud Function; lives in app state so it
  // syncs across devices and rides in backups). Non-destructive: create if absent
  // and backfill each field. Defaults preserve current behavior — appointment
  // reminders ON at 30 min, master ON; digest + check-ins OFF.
  if(!S.notifSettings || typeof S.notifSettings!=='object') S.notifSettings={};
  {
    const ns=S.notifSettings;
    if(ns.master==null) ns.master=true;
    if(!ns.appt || typeof ns.appt!=='object') ns.appt={};
    if(ns.appt.enabled==null) ns.appt.enabled=true;
    if(ns.appt.minutesBefore==null) ns.appt.minutesBefore=30;
    if(ns.appt.minutesBefore2===undefined) ns.appt.minutesBefore2=null;   // optional 2nd reminder, off by default
    if(!ns.appt.digest || typeof ns.appt.digest!=='object') ns.appt.digest={};
    if(ns.appt.digest.enabled==null) ns.appt.digest.enabled=false;
    // time-of-day stored as minutes since midnight (15-min granular); migrate
    // non-destructively from the legacy whole-hour value.
    if(ns.appt.digest.atMin==null) ns.appt.digest.atMin = Number.isInteger(ns.appt.digest.hour) ? ns.appt.digest.hour*60 : 8*60;
    if(!ns.checkin || typeof ns.checkin!=='object') ns.checkin={};
    if(ns.checkin.enabled==null) ns.checkin.enabled=false;
    if(ns.checkin.intervalMin==null) ns.checkin.intervalMin=60;
    if(ns.checkin.startMin==null) ns.checkin.startMin = Number.isInteger(ns.checkin.startHour) ? ns.checkin.startHour*60 : 9*60;
    if(ns.checkin.endMin==null) ns.checkin.endMin = Number.isInteger(ns.checkin.endHour) ? ns.checkin.endHour*60 : 17*60;
    if(!ns.night || typeof ns.night!=='object') ns.night={};
    if(ns.night.enabled==null) ns.night.enabled=false;   // default OFF
    if(ns.night.atMin==null) ns.night.atMin = Number.isInteger(ns.night.hour) ? ns.night.hour*60 : 21*60;   // 9:00pm
  }
  // Fire Station: focus-session records + the single active fire. Additive —
  // fires are normal tasks; task.defOfDone is an optional field on the task
  // (no backfill needed; absence = none). Non-destructive.
  if(!S.fireSessions) S.fireSessions=[];
  if(S.activeFireId===undefined) S.activeFireId=null;
  // Leak Management: recurring interruptions that shouldn't reach you. Additive and
  // idempotent — existing accounts get [], and EVERY field is backfilled per leak so
  // a partially-shaped record (old backup, hand edit, an aborted write) can never
  // break the list render. Nothing existing is touched or rewritten.
  if(!Array.isArray(S.leaks)) S.leaks=[];
  S.leaks.forEach(l=>{
    if(!l || typeof l!=='object') return;
    if(!Array.isArray(l.occurrences)) l.occurrences = l.createdAt ? [l.createdAt] : [];
    if(l.createdAt==null)  l.createdAt  = l.occurrences[0] || Date.now();
    if(l.lastSeenAt==null) l.lastSeenAt = l.occurrences[l.occurrences.length-1] || l.createdAt;
    if(!l.status) l.status='open';                       // 'open' | 'progress' | 'closed'
    if(l.resolutionType===undefined) l.resolutionType=null;
    if(l.owner==null)        l.owner='';
    if(l.nextAction==null)   l.nextAction='';
    if(l.dueDate==null)      l.dueDate='';
    if(l.defOfClosed==null)  l.defOfClosed='';
    if(l.followUpDate==null) l.followUpDate='';
    if(l.closedAt===undefined) l.closedAt=null;
    if(l.taskId===undefined) l.taskId=null;   // legacy: the task a leak's resolution spawned
    // ---- Leaks v2: one free-text notes field instead of six structured ones ----
    // NON-DESTRUCTIVE, and gated by _leakV2 so it runs exactly once per leak and can
    // never double-append. Every non-empty retired field is FOLDED into notes as a
    // labelled line; anything already in notes is preserved below it. The old fields
    // are then left in place, dead — the app stops reading them, but a bad fold stays
    // recoverable from the raw record or an export (same approach as the journal's
    // legacy flat fields).
    if(l.notes==null) l.notes='';
    if(!l._leakV2){
      l._leakV2=true;
      const folded=[];
      if(l.resolutionType)               folded.push('Resolution: '+l.resolutionType);
      if((l.owner||'').trim())           folded.push('Owner: '+l.owner.trim());
      if((l.nextAction||'').trim())      folded.push('Next action: '+l.nextAction.trim());
      if((l.dueDate||'').trim())         folded.push('Due: '+l.dueDate.trim());
      if((l.defOfClosed||'').trim())     folded.push('Definition of closed: '+l.defOfClosed.trim());
      if((l.followUpDate||'').trim())    folded.push('Follow-up: '+l.followUpDate.trim());
      if(l.status==='progress')          folded.push('Status was: In progress');
      if(folded.length) l.notes = folded.join('\n') + (l.notes ? '\n\n'+l.notes : '');
    }
    // ---- Leaks v3: a leak is a CONTAINER that holds tasks, like a project ----
    // Additive: existing leaks default to Open with an empty task list, which is
    // indistinguishable from a leak created today.
    if(!Array.isArray(l.tasks)) l.tasks=[];
    l.tasks.forEach(t=>{
      if(!t || typeof t!=='object') return;
      if(t.id==null) t.id=b();
      if(t.done==null) t.done=false;
      if(t.doneAt===undefined) t.doneAt=null;
      if(t.priority==null) t.priority=false;
      t.kind='quick';                       // leak tasks are quick-only (no time-block machinery)
    });
    // regression = the fix didn't hold. Counted from BOTH Watching→Open (unproven)
    // and Closed→Open (declared solved, and it came back — the stronger signal), with
    // the closed subset tracked separately so the detail can say "2 regressions, 1 from closed".
    if(l.regressions==null) l.regressions=0;
    if(l.regressionsFromClosed==null) l.regressionsFromClosed=0;
    // status: open | watching | closed. 'watching' is new so there's nothing to remap;
    // the retired 'progress' already folded into notes above.
    if(l.status!=='open' && l.status!=='watching' && l.status!=='closed') l.status='open';
  });
  // ---- TRAINING: the exercise library + the weekly plan ----
  // Additive, idempotent and non-destructive, like every migration above: create
  // the container if absent, then backfill EVERY field on every record so a
  // partially-shaped session (old backup, hand edit, aborted write) can never break
  // a render. The library seeds exactly once (_libSeeded), so deleting every
  // exercise on purpose is respected instead of being re-seeded on the next load.
  if(!S.training || typeof S.training!=='object' || Array.isArray(S.training)) S.training={};
  {
    const tr=S.training;
    // ---- categories are USER DATA (v2) ----
    // Seeded once behind _catsV2 — including for existing accounts, whose library
    // is already keyed by exactly these ids, so nothing moves. Deleting a category
    // afterwards is respected: the guard stops it coming back.
    if(!Array.isArray(tr.cats)) tr.cats=[];
    tr.cats=tr.cats.filter(c=>c && typeof c==='object');
    tr.cats.forEach(c=>{
      if(c.id==null) c.id=b();
      if(c.name==null) c.name='';
      if(c.type!=='cardio' && c.type!=='recovery') c.type='workout';   // sensible default
    });
    if(!tr._catsV2){
      tr._catsV2=true;
      if(!tr.cats.length) tr.cats=TRAIN_CAT_SEED.map(c=>({id:c.id, name:c.name, type:c.type}));
    }
    // ---- the library, keyed by CATEGORY ID ----
    if(!tr.library || typeof tr.library!=='object' || Array.isArray(tr.library)) tr.library={};
    // repair every list first, then ADOPT any key that holds exercises but has no
    // category behind it (a hand edit, an old backup, a half-applied delete). The
    // rule is absolute: exercises are never silently dropped — an orphaned list
    // gets a category back, named after its key, ready to be renamed.
    Object.keys(tr.library).forEach(k=>{
      if(!Array.isArray(tr.library[k])){ tr.library[k]=[]; return; }
      tr.library[k]=tr.library[k].filter(e=>e && typeof e==='object');
      tr.library[k].forEach(e=>{ if(e.id==null) e.id=b(); if(e.name==null) e.name=''; });
      if(tr.library[k].length && !tr.cats.some(c=>c.id===k)){
        tr.cats.push({id:k, name:String(k), type:'workout'});
      }
    });
    tr.cats.forEach(c=>{ if(!Array.isArray(tr.library[c.id])) tr.library[c.id]=[]; });
    if(!tr._libSeeded){
      tr._libSeeded=true;
      tr.cats.forEach(c=>{
        if(!tr.library[c.id].length && (TRAIN_SEED[c.id]||[]).length){
          tr.library[c.id]=TRAIN_SEED[c.id].map(n=>({id:b(), name:n}));
        }
      });
    }
    if(!(tr.floor>=1)) tr.floor=3;                    // the weekly FLOOR, never a target
    if(!tr.sessions || typeof tr.sessions!=='object' || Array.isArray(tr.sessions)) tr.sessions={};
    Object.keys(tr.sessions).forEach(dk=>{
      const s=tr.sessions[dk];
      if(!s || typeof s!=='object'){ delete tr.sessions[dk]; return; }
      if(s.id==null) s.id=b();
      if(s.date==null) s.date=dk;
      if(s.kind!=='rest' && s.kind!=='session') s.kind='session';
      if(s.title==null) s.title='';
      // exercises are stored BY VALUE (name + category), not as library references,
      // so renaming or deleting a library entry can never rewrite a past session
      if(!Array.isArray(s.exercises)) s.exercises=[];
      s.exercises=s.exercises.filter(e=>e && typeof e==='object');
      s.exercises.forEach(e=>{ if(e.id==null) e.id=b(); if(e.name==null) e.name=''; if(e.cat==null) e.cat=''; });
      if(s.time===undefined) s.time=null;             // 'HH:MM' → linked appointment
      if(s.taskId===undefined) s.taskId=null;         // the day-task it completes through
      if(s.apptId===undefined) s.apptId=null;         // the linked appointment, when timed
      if(s.done==null) s.done=false;
      if(s.doneAt===undefined) s.doneAt=null;
      if(s.mins===undefined) s.mins=null;             // optional, logged at completion
      if(s.note==null) s.note='';                     // optional, logged at completion
      if(s.createdAt==null) s.createdAt=Date.now();
    });
    // ---- Training v2: a DAY HOLDS SESSIONS ----
    // A day used to be one session; it is now {rest, sessions:[…]} so a lift in the
    // morning and a run in the evening can both exist, each with its own task and
    // (if timed) its own appointment. NON-DESTRUCTIVE and gated by _daysV2 so it
    // runs exactly once and can never double-fold: every existing day becomes a day
    // with ONE session, and an old rest day becomes a day with rest:true and none.
    // The legacy tr.sessions map is left in place, dead — the app stops reading it,
    // but a bad fold stays recoverable from the raw record or an export (the same
    // approach as the leaks v2 fold). We copy rather than alias, so the legacy map
    // is a true snapshot and later edits never write back into it.
    if(!tr.days || typeof tr.days!=='object' || Array.isArray(tr.days)) tr.days={};
    if(!tr._daysV2){
      tr._daysV2=true;
      Object.keys(tr.sessions||{}).forEach(dk=>{
        const s=tr.sessions[dk];
        if(!s || typeof s!=='object') return;
        if(tr.days[dk]) return;                       // never overwrite an existing v2 day
        if(s.kind==='rest'){ tr.days[dk]={rest:true, sessions:[]}; return; }
        let copy; try{ copy=JSON.parse(JSON.stringify(s)); }catch(e){ copy=s; }
        tr.days[dk]={rest:false, sessions:[copy]};
      });
    }
    // backfill every day + every session it holds (repairs a partial record instead
    // of dropping it, so nothing you planned can vanish because of a bad write)
    Object.keys(tr.days).forEach(dk=>{
      const d=tr.days[dk];
      if(!d || typeof d!=='object' || Array.isArray(d)){ delete tr.days[dk]; return; }
      if(d.rest==null) d.rest=false;
      if(!Array.isArray(d.sessions)) d.sessions=[];
      d.sessions=d.sessions.filter(s=>s && typeof s==='object');
      d.sessions.forEach(s=>{
        if(s.id==null) s.id=b();
        if(s.date==null) s.date=dk;
        if(s.title==null) s.title='';
        if(!Array.isArray(s.exercises)) s.exercises=[];
        s.exercises=s.exercises.filter(e=>e && typeof e==='object');
        s.exercises.forEach(e=>{
          if(e.id==null) e.id=b(); if(e.name==null) e.name=''; if(e.cat==null) e.cat='';
          // ONE optional number per exercise — a bodyweight target like 100 pushups.
          // Existing exercises get an empty one. Not sets, not weight, not
          // reps-per-set, and never counted against; it just sits there.
          if(e.target===undefined) e.target=null;
          if(e.target!=null && !(+e.target>0)) e.target=null;
          if(e.target!=null) e.target=+e.target;
        });
        if(s.time===undefined) s.time=null;
        if(s.taskId===undefined) s.taskId=null;
        if(s.apptId===undefined) s.apptId=null;
        if(s.done==null) s.done=false;
        if(s.doneAt===undefined) s.doneAt=null;
        if(s.mins===undefined) s.mins=null;
        if(s.note==null) s.note='';
        if(s.createdAt==null) s.createdAt=Date.now();
      });
      // Rest is the whole day and means NO sessions. If a record somehow carries
      // both, the sessions win — they hold the links; the flag holds nothing.
      if(d.rest && d.sessions.length) d.rest=false;
    });
  }
  // ---- CONTENT: pillars + three-stage ideas, each with its footage checklist ----
  // Same additive, idempotent, backfill-everything approach as training above. The
  // MASTER footage list is derived on render (see masterFootage in page-content.js),
  // never stored, so there is no aggregate here to migrate or keep in step.
  if(!S.content || typeof S.content!=='object' || Array.isArray(S.content)) S.content={};
  {
    const c=S.content;
    if(!Array.isArray(c.pillars)) c.pillars=[];
    c.pillars=c.pillars.filter(p=>p && typeof p==='object');
    c.pillars.forEach(p=>{ if(p.id==null) p.id=b(); if(p.name==null) p.name=''; });
    if(!c._pillarsSeeded){
      c._pillarsSeeded=true;
      if(!c.pillars.length) c.pillars=CONTENT_PILLAR_SEED.map(n=>({id:b(), name:n}));
    }
    if(!(c.floor>=1)) c.floor=3;                     // weekly posting FLOOR, never a target
    if(!Array.isArray(c.ideas)) c.ideas=[];
    c.ideas=c.ideas.filter(i=>i && typeof i==='object');
    c.ideas.forEach(i=>{
      if(i.id==null) i.id=b();
      if(i.txt==null) i.txt='';
      if(i.pillarId===undefined) i.pillarId=null;    // a dangling id just renders no chip
      if(i.stage!=='idea' && i.stage!=='week' && i.stage!=='posted') i.stage='idea';
      if(!Array.isArray(i.clips)) i.clips=[];
      i.clips=i.clips.filter(x=>x && typeof x==='object');
      i.clips.forEach(x=>{ if(x.id==null) x.id=b(); if(x.txt==null) x.txt=''; if(x.done==null) x.done=false; });
      if(i.createdAt==null) i.createdAt=Date.now();
      if(i.postedAt===undefined) i.postedAt=null;    // 'YYYY-MM-DD' once posted
    });
  }
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
    (S.days[dk].tasks||[]).forEach(t=>{ if(t.kind==='project' && t.start!=null && t.schedDate==null) t.schedDate=dk; if(t.priority==null) t.priority=false; });
    migrateJournalV2(S.days[dk]);   // additive, gated by _jrnlV2 — never overwrites edits or loses data
    migrateJournalCalm(S.days[dk]); // additive, gated by _jrnlCalm — anxiety/stress → calm
    if(!S.days[dk].spotlogs) S.days[dk].spotlogs=[];   // optional timestamped check-ins
  });
}
/* ---------- Journal v2 migration (1-10 → 1-5 stars; flat → morning/evening) ----------
   NON-DESTRUCTIVE: legacy flat fields (mood word, energy, sleep, meds, feelings,
   fulfillment) are KEPT intact for Insights/Shutdown; we only ADD morning/evening
   sub-objects. Runs once per day record (the _jrnlV2 flag), so it never re-runs and
   never overwrites a value the user later changes. */
const ENERGY_STAR={Low:2,Medium:3,High:4};   // legacy Low/Med/High → 1-5 stars
function fulfill10to5(n){ n=+n; if(!n||isNaN(n)) return null; return Math.max(1,Math.min(5,Math.ceil(n/2))); }
function migrateJournalV2(d){
  if(!d || d._jrnlV2) return;
  d._jrnlV2=true;
  if(!d.morning) d.morning={ energy:null, mood:null, anxiety:null, stress:null, calm:null, intentions:'' };
  if(!d.evening) d.evening={ mood:null, energy:null, anxiety:null, calm:null, fulfillment:null, trained:null, trainNote:'', diet:'' };
  // map legacy ratings into the new stars (only when the new field is still empty)
  if(d.morning.energy==null && d.energy)  d.morning.energy = ENERGY_STAR[d.energy] || null;
  if(d.morning.stress==null && d.stress)  d.morning.stress = ENERGY_STAR[d.stress] || null;
  if(d.evening.fulfillment==null && d.fulfillment!=null && d.fulfillment!=='') d.evening.fulfillment = fulfill10to5(d.fulfillment);
  // legacy d.mood (word) stays put as the kept mood-text field; d.feelings stays as reflection.
}
/* ---------- Calm migration: Anxiety + Stress → a single CALM rating ----------
   More stars = better, so Calm is the INVERSE of anxiety/stress (high stress → low
   calm). NON-DESTRUCTIVE + gated by _jrnlCalm so it runs once. Old anxiety/stress
   fields are left in place (dead data, not deleted). Where the source is ambiguous —
   morning has BOTH an anxiety and a stress value — we start Calm fresh (null) rather
   than risk a messy combined guess; a single clear source is inverted cleanly. */
function calmInvert(v){ v=+v; if(!v||isNaN(v)||v<1||v>5) return null; return Math.max(1,Math.min(5,6-Math.round(v))); }
function numOrNull(x){ return (typeof x==='number' && x>=1 && x<=5) ? x : null; }
function migrateJournalCalm(d){
  if(!d || d._jrnlCalm) return;
  d._jrnlCalm=true;
  if(!d.morning) d.morning={};
  if(!d.evening) d.evening={};
  if(d.morning.calm==null){
    const a=numOrNull(d.morning.anxiety), s=numOrNull(d.morning.stress);
    if(a!=null && s==null)      d.morning.calm=calmInvert(a);   // single clear source → invert
    else if(s!=null && a==null) d.morning.calm=calmInvert(s);
    else                        d.morning.calm=null;            // both or neither set → start fresh
  }
  if(d.evening.calm==null){
    const a=numOrNull(d.evening.anxiety);
    d.evening.calm = (a!=null) ? calmInvert(a) : null;
  }
}
/* returns true only if the cloud write committed.
   opts.bump=false preserves the current in-state version (updatedAt) instead of
   advancing it — used by the startup re-persist so first render doesn't falsely
   mark local as newest. Real edits go through save()/persist() and DO bump. */
async function persist(opts){ return await Store.set('marcomaster', S, opts); }

let saveTimer=null;
let cloudDirty=false;   // local changes not yet handed to a cloud persist()

/* Synchronous local cache write — mirror S to localStorage on EVERY save() call so a
   reload/close/background never loses the last edit while the cloud push is still
   debounced. Cheap (one JSON.stringify + setItem); never throws. Does NOT touch
   updatedAt or the gate/guard logic — the debounced cloud push (persist) stays the
   sole authority for versioning and convergence. */
function cacheLocal(){ try{ Store._lsSet('marcomaster', S); }catch(e){} }

function save(showToast=true){
  cacheLocal();                 // 1) INSTANT local durability — every call
  cloudDirty=true;
  clearTimeout(saveTimer);      // 2) debounce ONLY the cloud push
  const myTimer = saveTimer = setTimeout(()=>doCloudPush(myTimer, showToast), 350);
}

/* the debounced cloud push. Also invoked directly by flushSave() on page hide. */
async function doCloudPush(myTimer, showToast){
  cloudDirty=false;                       // consuming the pending change
  setSyncStatus('syncing');               // persistent indicator: write in flight
  const synced=await persist();
  // Clear the in-flight marker so the reconciler's `!saveTimer` check is accurate
  // again and LIVE cross-device adoption resumes between edits. Only clear if no
  // newer save was queued while this one was awaiting (id still matches).
  if(saveTimer===myTimer) saveTimer=null;
  const r=Store._lastResult;
  // Roll a local auto-backup for any real, meaningful save (independent of the
  // cloud) — but never when the write was gate-deferred or guard-blocked.
  if(r!=='gate' && r!=='guard'){ try{ recordAutoBackup(S); }catch(e){} }
  if(synced){
    setSyncWarning(false);                // cloud confirmed
    setSyncStatus('synced', Date.now());
    if(showToast) toast('Saved ✓');
  }else if(r==='gate'){
    setSyncStatus('syncing');             // deferred until first cloud reconcile — NOT an error
  }else if(r==='guard'){
    setSyncStatus('error');               // a loud banner was already shown by onGuardBlocked
  }else{
    setSyncWarning(true);                 // visible: changes are NOT in the cloud
    setSyncStatus(FB.user?'error':'local');
  }
}

/* Flush any pending save immediately — called when the page is hidden/torn down.
   localStorage is already current (written synchronously on every save()); if a
   cloud push is still pending we fire it NOW instead of waiting out the debounce. */
function flushSave(){
  cacheLocal();                           // belt-and-suspenders: local always current
  if(cloudDirty){                         // a debounced push is still pending → run it now
    clearTimeout(saveTimer);
    // MUST null the id: visibilitychange fires on every tab/app switch (not just
    // close). A stale saveTimer would leave the reconciler's `adopt && !saveTimer`
    // check permanently false, killing live cloud adoption for the rest of the
    // session. Nulling here restores it (persist already has the latest S).
    saveTimer=null;
    cloudDirty=false;
    try{ persist(); }catch(e){}           // fire-and-forget; local already safe
  }
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
    meds:'', feelings:'', fulfillment:'',   // legacy flat journal fields (kept for Insights/Shutdown)
    // Journal v2 — morning/evening 1-5 star ratings + new text. _jrnlV2 marks a record
    // as already in the new shape so the one-time migration never re-runs on it.
    _jrnlV2:true, _jrnlCalm:true,
    morning:{ energy:null, mood:null, calm:null, intentions:'' },
    evening:{ mood:null, energy:null, calm:null, fulfillment:null, trained:null, trainNote:'', diet:'' },
    tasks:[],          // {id, txt, kind:'quick'|'project', done, mins, start:null, recurringId?}
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
   JOURNAL-AWARE MERGE — used by the cloud reconciler (app.js) so a whole-state
   swap in EITHER direction never drops journal data. Whole-document last-writer-
   wins is kept for everything else (tasks, pipeline, appointments, meetings,
   projects, board, legacy checkins); only journal fields + spotlogs are unioned
   per day here. All merges only ever PRESERVE or GROW journal content.
   ============================================================ */
const JOURNAL_FLAT_FIELDS=['mood','sleep','meds','feelings','fulfillment','energy','stress'];
function jrnlEmpty(v){ return v==null || v===''; }   // cleared star = null, cleared text = ''

/* one field: non-empty beats empty; on a real conflict the newer document wins */
function pickField(baseVal, overVal, baseNewer){
  if(jrnlEmpty(overVal)) return {v:baseVal, changed:false};
  if(jrnlEmpty(baseVal)) return {v:overVal, changed:true};
  if(baseNewer)          return {v:baseVal, changed:false};
  return {v:overVal, changed:(overVal!==baseVal)};
}
/* union two spotlog arrays by id — keep base order, append overlay-only ids.
   Pure union (never drops): a check-in still held by the other side can reappear
   after a local delete. Accepted trade-off ("grow journal, never drop"). */
function unionById(base, overlay){
  const list=[]; const seen=new Set();
  (base||[]).forEach(x=>{ if(x){ if(x.id!=null) seen.add(x.id); list.push(x); } });
  let added=false;
  (overlay||[]).forEach(x=>{ if(x && x.id!=null && !seen.has(x.id)){ seen.add(x.id); list.push(x); added=true; } });
  return {list, added};
}
/* does a day record carry ANY non-empty journal content worth merging? */
function dayHasJournal(o){
  if(!o || typeof o!=='object') return false;
  const scopeHas=(x)=> x && typeof x==='object' && Object.keys(x).some(k=>!jrnlEmpty(x[k]));
  if(scopeHas(o.morning) || scopeHas(o.evening)) return true;
  if((o.spotlogs||[]).length) return true;
  if(JOURNAL_FLAT_FIELDS.some(f=>!jrnlEmpty(o[f]))) return true;
  return false;
}
/* Merge overlay's journal (morning/evening/spotlogs + legacy flat fields) INTO
   base, per day. Only journal is touched — base's tasks/pipeline/etc. and both
   sides' updatedAt are left alone. Returns true if base actually changed.
   baseNewer decides same-field conflicts; forceBaseNewer pins base as the winner
   (used on the local-wins path, incl. protecting in-progress local edits). */
function mergeJournalInto(base, baseV, overlay, overlayV, forceBaseNewer){
  if(!base || typeof base!=='object' || !overlay || typeof overlay!=='object') return false;
  const baseNewer = forceBaseNewer ? true : ((+baseV||0) >= (+overlayV||0));
  const od=overlay.days||{}; if(!base.days) base.days={};
  let changed=false;
  Object.keys(od).forEach(dk=>{
    const o=od[dk]; if(!o || typeof o!=='object') return;
    let b=base.days[dk];
    if(!b){ if(!dayHasJournal(o)) return; b=base.days[dk]=blankDay(); changed=true; }
    // morning / evening — generic key union (covers stars, intentions, trained,
    // trainNote, diet, and any legacy anxiety/stress still on old records)
    ['morning','evening'].forEach(scope=>{
      const os=o[scope]; if(!os || typeof os!=='object') return;
      if(!b[scope] || typeof b[scope]!=='object') b[scope]={};
      const bs=b[scope];
      Object.keys(os).forEach(k=>{ const r=pickField(bs[k], os[k], baseNewer); if(r.changed){ bs[k]=r.v; changed=true; } });
    });
    // spotlogs — union by id
    const u=unionById(b.spotlogs, o.spotlogs);
    if(u.added){ b.spotlogs=u.list; changed=true; }
    // legacy flat journal fields — explicit allowlist (NOT a generic union: the day
    // record also holds tasks/pipeline/archive/checkins/reset/focus/…)
    JOURNAL_FLAT_FIELDS.forEach(f=>{ const r=pickField(b[f], o[f], baseNewer); if(r.changed){ b[f]=r.v; changed=true; } });
  });
  return changed;
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
  if(!d.spotlogs) d.spotlogs=[];
  if(!d.tomorrow) d.tomorrow=[];
  if(!d.recurringAdded) d.recurringAdded={};
  if(!d.skipped) d.skipped={};
  if(d.meds==null) d.meds='';
  if(d.feelings==null) d.feelings='';
  if(d.fulfillment==null) d.fulfillment='';
  migrateJournalV2(d);   // ensure morning/evening exist + one-time legacy → stars migration
  migrateJournalCalm(d); // anxiety/stress → single calm rating (gated)
  if(d.morningSeen==null) d.morningSeen=false;   // migration: days created before the morning screen
  if(d.dayStart==null) d.dayStart=(S.settings&&S.settings.dayStart)||8;
  if(d.dayEnd==null) d.dayEnd=(S.settings&&S.settings.dayEnd)||21;
  // migrate: a task that had a start hour but no schedDate was scheduled for its own day
  d.tasks.forEach(t=>{ if(t.kind==='project' && t.start!=null && t.schedDate==null) t.schedDate=k; if(t.priority==null) t.priority=false; });
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
      // WORKOUT tasks are excluded (t.workoutId): a planned session belongs to its
      // day. Dragging a missed one forward would detach it from the weekly plan it
      // was built in, and would quietly turn "the floor is 3" into a debt you carry.
      // It simply stays on its own day and doesn't count — no shaming, and the
      // weekly grid keeps telling the truth about what was planned when.
      const carryTasks=(prev.tasks||[]).filter(t=>!t.done && !t.recurringId && !t.workoutId);
      if(carryTasks.length){
        carryTasks.forEach(t=>{
          t.fromYesterday=true;
          if(t.kind==='project'){ t.schedDate=null; t.start=null; }  // back to today's block pool
          d.tasks.push(t);
        });
        prev.tasks=(prev.tasks||[]).filter(t=>t.done || t.recurringId || t.workoutId);  // remove the moved ones
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
        else if(it.leakId){ const l=(S.leaks||[]).find(x=>x.id===it.leakId); const t=l&&(l.tasks||[]).find(x=>x.id===it.leakTaskId); done=t?t.done:!!it.done; }
        else { done=!!it.done; }
        if(done) return;                      // completed → drop on the new day
        const carried={id:b(), txt:it.txt, done:false};
        if(it.projectId){ carried.projectId=it.projectId; carried.projTaskId=it.projTaskId; }  // keep persistent project link
        if(it.leakId){ carried.leakId=it.leakId; carried.leakTaskId=it.leakTaskId; }              // keep persistent leak link
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

