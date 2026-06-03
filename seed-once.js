/* ============================================================
   ONE-TIME SEED — re-add data lost from state, recovered from a
   screenshot. ADDS to the current state S and persists to the cloud.
   Does NOT wipe anything. Idempotent: safe to run more than once
   (everything is de-duplicated by name / text, so re-running will
   not create duplicates).

   HOW TO RUN (browser console, app open & signed in):
     await seedFromScreenshot()

   It returns a summary object and saves to localStorage + Firestore.
   ============================================================ */
async function seedFromScreenshot(){
  if(typeof S!=='object' || !S){ console.error('App not loaded (S missing). Open the app first.'); return; }
  seedDefaults();                       // make sure all containers exist
  const added={projects:0, projectTasks:0, appointments:0, followups:0, parking:0, todayTasks:0, pipeline:0};
  const now=Date.now();

  /* ---------- PROJECTS (merge by name, add missing tasks) ---------- */
  if(!S.projects) S.projects=[];
  const findOrMakeProject=(name)=>{
    let p=S.projects.find(x=>(x.name||'').trim().toLowerCase()===name.trim().toLowerCase());
    if(!p){
      const color=PROJ_COLORS[S.projects.length % PROJ_COLORS.length];
      p={id:b(), name, color, done:false, tasks:[]};
      S.projects.push(p); added.projects++;
    }
    if(!p.tasks) p.tasks=[];
    return p;
  };
  const addProjTaskOnce=(p, txt)=>{
    if(p.tasks.some(t=>(t.txt||'').trim().toLowerCase()===txt.trim().toLowerCase())) return;
    p.tasks.push({id:b(), txt, done:false}); added.projectTasks++;
  };
  const PROJECTS=[
    ['CrewMaster',            ['Work on task master and roles']],
    ['Backyard Landscaping',  ['Inquire Lights','Stairs']],
    ['Test',                  ['Test task']],
    ["Marco's Mowing",        []],
  ];
  PROJECTS.forEach(([name,tasks])=>{ const p=findOrMakeProject(name); tasks.forEach(t=>addProjTaskOnce(p,t)); });

  /* ---------- APPOINTMENTS (merge by title+date+time) ---------- */
  if(!S.appointments) S.appointments=[];
  const addAppt=(title,date,time)=>{
    if(S.appointments.some(a=>a.title===title && a.date===date && a.time===time)) return;
    S.appointments.push({id:b(), title, date, time, createdAt:now}); added.appointments++;
  };
  addAppt('Company Cam',            todayKey(),    '11:00');  // today, 11:00am
  addAppt('Meet Christina Erikson', '2026-06-06',  '11:00');  // Sat Jun 6 2026
  addAppt('Accounting Meeting',     '2026-06-09',  '10:00');  // Tue Jun 9 2026

  /* ---------- FOLLOW-UPS (merge by txt) ---------- */
  if(!S.followups) S.followups=[];
  const addFu=(txt)=>{
    if(S.followups.some(f=>(f.txt||'').trim().toLowerCase()===txt.trim().toLowerCase())) return;
    S.followups.push({id:b(), txt, note:'', createdAt:now, lastTouched:now, resolved:false}); added.followups++;
  };
  ['10-ton Dump Safety','Poleline Mortgage','Matts Hours','Kris (rent - 800 June owing)'].forEach(addFu);

  /* ---------- THINGS TO THINK ABOUT / PARKING (merge by txt) ---------- */
  if(!S.board) S.board={mustwin:[],scheduled:[],parking:[]};
  if(!S.board.parking) S.board.parking=[];
  const addPark=(txt)=>{
    if(S.board.parking.some(i=>(i.txt||'').trim().toLowerCase()===txt.trim().toLowerCase())) return;
    S.board.parking.push({id:b(), txt}); added.parking++;
  };
  ['Boxing','Muay Thai','Future mentorship offer','Extra app features','New business ideas','Big content strategy overhaul'].forEach(addPark);

  /* ---------- TODAY'S TASKS (merge by txt+kind) ---------- */
  const d=day();
  if(!d.tasks) d.tasks=[];
  const addTodayTask=(txt, kind, mins)=>{
    let t=d.tasks.find(x=>(x.txt||'').trim().toLowerCase()===txt.trim().toLowerCase() && x.kind===kind);
    if(t) return t;
    t={id:b(), txt, kind, done:false, mins, start:null, schedDate:null};
    d.tasks.push(t); added.todayTasks++;
    return t;
  };
  // quick tasks (mins = 2, the quick default)
  addTodayTask('Night shutdown journal', 'quick', 2);
  addTodayTask('Call Charlene Cavanagh',  'quick', 2);
  // time-block tasks (kind 'project', with durations in minutes)
  addTodayTask('Website',            'project', 90);   // 1.5h
  addTodayTask('Google Ads',         'project', 120);  // 2h
  addTodayTask('Rental Taxes',       'project', 240);  // 4h
  addTodayTask('Quote Charlene',     'project', 60);   // 1h
  const excavator=addTodayTask('Excavator Insurance', 'project', 60); // 1h

  /* ---------- PIPELINE (top-3 today; Excavator Insurance in slot 1) ---------- */
  if(!d.pipeline) d.pipeline=[];
  const alreadyPiped = d.pipeline.some(it=>it.taskId===excavator.id ||
    (it.txt||'').trim().toLowerCase()==='excavator insurance');
  if(!alreadyPiped && d.pipeline.length<3){
    d.pipeline.push({id:b(), txt:excavator.txt, taskId:excavator.id, done:excavator.done}); // slot 1
    added.pipeline++;
  }
  // slots 2 & 3 intentionally left empty

  /* ---------- PERSIST (localStorage + Firestore) ---------- */
  const syncedToCloud = await persist();
  if(typeof rerender==='function') rerender();
  console.log('Seed complete. Added:', added, '| cloud synced:', syncedToCloud);
  return {added, syncedToCloud};
}
