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

  // timestamp of our most recent cloud write, so the live listener can ignore the
  // echo of our own changes (and not re-render over what the user just did)
  _lastWriteTs:0,

  // save: write local immediately (cache), then push to Firestore.
  // Returns TRUE only when the cloud write actually commits; FALSE otherwise
  // (not signed in, rejected, or not acknowledged in time). The caller uses this
  // to decide whether to show "Saved ✓" or a "not synced" warning — we never
  // report success for a write that didn't reach the server.
  async set(k,v){
    this._lsSet(k,v);                       // localStorage cache — always
    if(!(FB.user && FB.db)) return false;   // not signed in → nothing reached the cloud
    const ts=Date.now();
    this._lastWriteTs=ts;
    const write = FB.db.collection('users').doc(FB.user.uid)
      .set({ [k]:v, _updated:ts }, {merge:true});
    // Firestore's set() resolves when the SERVER acknowledges the write, rejects on
    // a hard error (e.g. permission-denied), and stays pending while offline. We
    // cap the wait so a save never hangs the UI — but a timeout counts as NOT
    // synced (we don't know it committed), not as success.
    try{
      await Promise.race([
        write,
        new Promise((_,rej)=>setTimeout(()=>rej(new Error('write-timeout')), 8000)),
      ]);
      return true;                          // server acknowledged → genuinely synced
    }catch(e){
      console.error('Firestore write NOT synced:', e && (e.code||e.message||e));
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

/* ---------- date helpers ---------- */
const todayKey = ()=>{ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
const weekKey = ()=>{ const d=new Date(); const o=new Date(d); o.setDate(d.getDate()-((d.getDay()+6)%7)); return 'wk-'+o.getFullYear()+'-'+String(o.getMonth()+1).padStart(2,'0')+'-'+String(o.getDate()).padStart(2,'0'); };
const prettyDate = ()=> new Date().toLocaleDateString('en-CA',{weekday:'long',month:'long',day:'numeric'});

/* ---------- default recurring tasks ----------
   every = interval in days (1=daily, 7=weekly, 30=monthly, 90=quarterly, or custom like 5)
   last  = ISO date string of last completion (null = never, so due now)
   auto  = whether it auto-adds to Today's task list when due
   kind  = 'quick' or 'project' when it lands in the inbox                       */
