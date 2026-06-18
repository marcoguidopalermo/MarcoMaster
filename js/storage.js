/* ============================================================
   MarcoMaster — personal operating system
   Cloud sync via Firebase (Firestore) with localStorage cache
   so it loads instantly and works offline, then syncs.
   ============================================================ */

/* ---------- Firebase handles (set up in init) ---------- */
let FB={ app:null, auth:null, db:null, user:null, ready:false };

/* ---------- storage layer ----------
   - localStorage = instant local cache (per device)
   - Firestore   = source of truth, synced across devices
   Reads prefer the freshest of the two; writes go to both.    */
const Store = {
  mem:{},
  // ---- data-protection state ----
  _gateOpen:false,    // false until the first cloud snapshot has been reconciled:
                      // an unreconciled (possibly empty/stale) device CANNOT write to cloud
  _cloudCount:0,      // stateCount of the last cloud snapshot — the shrink-guard baseline
  _lastResult:null,   // 'synced'|'gate'|'guard'|'offline'|'error' — drives save() messaging
  _lsGet(k){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):null; }catch(e){ return this.mem[k]??null; } },
  _lsSet(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){ this.mem[k]=v; } },

  // load: try Firestore first (if signed in), fall back to local cache
  async get(k){
    if(FB.user && FB.db){
      try{
        const snap=await FB.db.collection('users').doc(FB.user.uid).get();
        if(snap.exists){
          const data=snap.data();
          if(data && data[k]!=null){
            this._lsSet(k,data[k]);     // refresh local cache
            return data[k];
          }
        }
      }catch(e){ console.warn('Firestore read failed, using cache',e); }
    }
    return this._lsGet(k);
  },

  // save: stamp a monotonic, content-tied version INSIDE the state (updatedAt),
  // write local immediately (cache), then push to Firestore. Because updatedAt
  // lives inside the object it persists to BOTH localStorage and the cloud — that
  // is what lets the snapshot reconciler compare "how fresh is local" vs "how
  // fresh is cloud" and guarantee newer-always-wins (see app.js).
  //   opts.bump=true  (default): a real save — advance the version. Math.max with
  //                   prev+1 keeps it monotonic even if the clock jumps backwards.
  //   opts.bump=false (startup re-persist / first-doc create): preserve the
  //                   existing version; only assign one if it's missing (the
  //                   one-time legacy migration). This stops the first-render write
  //                   from falsely marking local as "newest" and shadowing a
  //                   genuinely newer copy from another device.
  // Returns TRUE only when the cloud write actually commits; FALSE otherwise
  // (not signed in, rejected, or not acknowledged in time). The caller uses this
  // to decide whether to show "Saved ✓" or a "not synced" warning — we never
  // report success for a write that didn't reach the server.
  async set(k,v,opts){
    const force = !!(opts && opts.force);   // explicit, confirmed action: bypass both gates
    const bump = !opts || opts.bump!==false;
    const isMain = (k==='marcomaster' && v && typeof v==='object');
    const newCount = isMain ? stateCount(v) : 0;

    // ====== DATA-PROTECTION GATES (only the main state document) ======
    // Decide UP FRONT whether this write will actually reach the cloud. The version
    // stamp (updatedAt) is advanced ONLY for writes that genuinely commit — never for
    // gated or guard-blocked ones. That's the convergence fix: merely opening a device
    // (recurring injection, carry-over — all deferred behind the startup gate) can no
    // longer bump its version and make a stale copy outrank a genuinely newer cloud.
    let block=null;   // 'gate' | 'guard' | null
    if(isMain && !force && (FB.user && FB.db)){
      // GATE 1 — startup gate: no cloud writes until the first cloud snapshot has been
      // received and reconciled, so an empty/stale device can't overwrite good data
      // before it has even seen what's up there.
      if(!this._gateOpen){ block='gate'; }
      // GATE 2 — catastrophic-shrink guard (UNCHANGED): block a write that would
      // collapse the CURRENT cloud state down to near-empty. Baseline = last cloud
      // snapshot's count, so gradual one-by-one deletion is never blocked — only a
      // single collapse from substantial → near-empty trips it.
      else if(isCatastrophicShrink(this._cloudCount||0, newCount)){ block='guard'; }
    }
    const willCommit = (FB.user && FB.db) && !block;

    // advance the durable version only for real, committing writes (or forced ones)
    if(v && typeof v==='object' && (force || willCommit)){
      const prev=+v.updatedAt||0;
      if(bump || v.updatedAt==null) v.updatedAt=Math.max(Date.now(), prev+1);
    }
    this._lsSet(k,v);                       // localStorage cache — ALWAYS (never lose local work)

    if(!(FB.user && FB.db)){ this._lastResult='offline'; return false; }
    if(block==='gate'){ this._lastResult='gate'; return false; }          // deferred, not an error
    if(block==='guard'){
      this._lastResult='guard';
      if(typeof onGuardBlocked==='function'){ try{ onGuardBlocked(this._cloudCount||0, newCount); }catch(e){} }
      return false;                         // cloud UNTOUCHED; near-empty can't clobber a full cloud
    }

    const ts=(v && v.updatedAt!=null) ? +v.updatedAt : Date.now();   // mirror updatedAt exactly
    const write = FB.db.collection('users').doc(FB.user.uid)
      .set({ [k]:v, _updated:ts }, {merge:true});   // _updated mirrors updatedAt (back-compat)
    // Firestore's set() resolves when the SERVER acknowledges the write, rejects on
    // a hard error (e.g. permission-denied), and stays pending while offline. We
    // cap the wait so a save never hangs the UI — but a timeout counts as NOT
    // synced (we don't know it committed), not as success.
    try{
      await Promise.race([
        write,
        new Promise((_,rej)=>setTimeout(()=>rej(new Error('write-timeout')), 8000)),
      ]);
      if(isMain){ this._cloudCount=newCount; }
      this._lastResult='synced';
      return true;                          // server acknowledged → genuinely synced
    }catch(e){
      console.error('Firestore write NOT synced:', e && (e.code||e.message||e));
      this._lastResult='error';
      return false;                         // rejected / offline / timed out
    }
  },

  // Live subscription to the user's document for the whole session. Calls cb(snap)
  // on the first server fetch and on every subsequent change — this is background
  // sync only; the app has ALREADY rendered from local cache by the time this
  // fires. Returns an unsubscribe function. Never throws.
  watchUserDoc(cb){
    if(!(FB.user && FB.db)) return ()=>{};
    try{
      return FB.db.collection('users').doc(FB.user.uid).onSnapshot(
        (snap)=>{ try{ cb(snap); }catch(e){ console.warn('cloud snapshot handler failed',e); } },
        (err)=>{ console.warn('Firestore listener error (staying on local data)',err); }
      );
    }catch(e){ console.warn('Firestore listener failed to attach',e); return ()=>{}; }
  }
};

/* ============================================================
   DATA PROTECTION — anti-overwrite guard + rolling local backups.
   These guard against the failure mode where an empty/stale device
   silently overwrites good cloud data and propagates the emptiness.
   ============================================================ */
const PROTECT_FLOOR = 8;   // only guard once there's real data to protect
const NEAR_EMPTY    = 3;   // <=3 meaningful items ≈ just the default seed
const AB_SLOTS      = 7;   // number of rolling auto-backup slots
const AB_MIN_GAP_MS = 15*60*1000;   // advance to a NEW slot at most this often

/* A single "how much real data is here" magnitude. Used by both the shrink guard
   and the reconciler. The default seeded state scores ~2. */
function stateCount(s){
  if(!s || typeof s!=='object') return 0;
  let n=0;
  (s.projects||[]).forEach(p=>{ n+=1; n+=((p&&p.tasks)||[]).length; });
  n+=(s.followups||[]).length;
  n+=(s.meetings||[]).length;
  n+=(s.appointments||[]).length;
  const days=s.days||{};
  Object.keys(days).forEach(k=>{ const d=days[k]||{};
    n+=(d.tasks||[]).length + (d.pipeline||[]).length + (d.archive||[]).length + (d.checkins||[]).length; });
  if(s.board){ ['mustwin','scheduled','parking'].forEach(k=>{ n+=((s.board[k]||[]).length); }); }
  return n;
}
/* TRUE only for a catastrophic collapse — substantial data dropping to near-zero
   or losing >=75%. A single deletion (−1) or removing one project never trips it. */
function isCatastrophicShrink(from, to){
  if(from < PROTECT_FLOOR) return false;        // nothing substantial to protect yet
  return to <= NEAR_EMPTY || to <= from*0.25;
}
function _lsRaw(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function _parse(s){ try{ return s?JSON.parse(s):null; }catch(e){ return null; } }
function backupSummary(s){
  s=s||{};
  return {
    projects:(s.projects||[]).length,
    tasks:(s.projects||[]).reduce((n,p)=>n+(((p&&p.tasks)||[]).length),0),
    followups:(s.followups||[]).length,
    meetings:(s.meetings||[]).length,
    appointments:(s.appointments||[]).length,
    days:Object.keys(s.days||{}).length,
  };
}
/* Roll a local snapshot into marcomaster-autobackup-1..7. Advances to a new slot
   at most every AB_MIN_GAP_MS (otherwise refreshes the latest slot in place), so
   the 7 slots span time and the newest is always current. Never backs up an
   empty/seed state, so the rolling history can't fill up with emptiness. */
function recordAutoBackup(state){
  try{
    const count=stateCount(state);
    if(count<PROTECT_FLOOR) return;             // don't snapshot empties
    const now=Date.now();
    const slotKey=(i)=>'marcomaster-autobackup-'+i;
    let ptr=+_lsRaw('mm_autobackup_ptr')||0;     // 1..AB_SLOTS = current slot (0 = none yet)
    const entry={ ts:now, count, summary:backupSummary(state), state };
    const cur = ptr>=1 ? _parse(_lsRaw(slotKey(ptr))) : null;
    if(cur && (now-(+cur.ts||0) < AB_MIN_GAP_MS)){
      localStorage.setItem(slotKey(ptr), JSON.stringify(entry));   // refresh latest slot
    }else{
      ptr = ptr>=AB_SLOTS ? 1 : ptr+1;                              // advance the ring
      localStorage.setItem(slotKey(ptr), JSON.stringify(entry));
      localStorage.setItem('mm_autobackup_ptr', String(ptr));
    }
  }catch(e){ /* quota / serialization — skip silently, never break a save */ }
}
function listAutoBackups(){
  const out=[];
  for(let i=1;i<=AB_SLOTS;i++){
    const e=_parse(_lsRaw('marcomaster-autobackup-'+i));
    if(e && e.state) out.push({slot:i, ts:e.ts, count:e.count, summary:e.summary});
  }
  out.sort((a,b)=>(b.ts||0)-(a.ts||0));         // newest first
  return out;
}
function getAutoBackupState(slot){ const e=_parse(_lsRaw('marcomaster-autobackup-'+slot)); return (e&&e.state)||null; }

/* ---------- date helpers ---------- */
const todayKey = ()=>{ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
const weekKey = ()=>{ const d=new Date(); const o=new Date(d); o.setDate(d.getDate()-((d.getDay()+6)%7)); return 'wk-'+o.getFullYear()+'-'+String(o.getMonth()+1).padStart(2,'0')+'-'+String(o.getDate()).padStart(2,'0'); };
const prettyDate = ()=> new Date().toLocaleDateString('en-CA',{weekday:'long',month:'long',day:'numeric'});

/* ---------- default recurring tasks ----------
   every = interval in days (1=daily, 7=weekly, 30=monthly, 90=quarterly, or custom like 5)
   last  = ISO date string of last completion (null = never, so due now)
   auto  = whether it auto-adds to Today's task list when due
   kind  = 'quick' or 'project' when it lands in the inbox                       */
