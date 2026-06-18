/* ============================================================
   INIT
   ============================================================ */
/* ---- Firebase config ---- */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyA_NXXhonvWNjwq76Cv6oQJ5h4uFBTOqFc",
  authDomain: "marcomaster-c4930.firebaseapp.com",
  projectId: "marcomaster-c4930",
  storageBucket: "marcomaster-c4930.firebasestorage.app",
  messagingSenderId: "778355921159",
  appId: "1:778355921159:web:1c348cbbe4e69b7ef8f5a2",
  measurementId: "G-02WVTRFCDR"
};

function showSignIn(msg){
  const app=document.querySelector('.app');
  if(app) app.style.display='none';
  let g=document.getElementById('signinGate');
  if(!g){
    g=document.createElement('div'); g.id='signinGate'; g.className='signin-gate';
    document.body.appendChild(g);
  }
  g.style.display='flex';
  g.innerHTML=`
    <div class="signin-card">
      <h1><span class="dot"></span>MarcoMaster</h1>
      <p class="signin-tag">TaskMaster runs the business.<br>MarcoMaster runs Marco.</p>
      <form class="signin-form" id="signinForm">
        <input type="email" id="emailInput" placeholder="Email" autocomplete="email" required>
        <input type="password" id="passwordInput" placeholder="Password" autocomplete="current-password" required>
        <button type="submit" class="btn signin-btn">Sign in</button>
      </form>
      ${msg?`<p class="signin-msg">${msg}</p>`:''}
    </div>`;
  document.getElementById('signinForm').onsubmit=async(e)=>{
    e.preventDefault();
    const email=document.getElementById('emailInput').value.trim();
    const password=document.getElementById('passwordInput').value;
    if(!email || !password){ showSignIn('Enter an email and password.'); return; }
    try{
      await FB.auth.signInWithEmailAndPassword(email,password);
    }catch(err){
      showSignIn('Sign-in failed: '+(err.code||err.message||'try again'));
    }
  };
}

function startApp(){
  const g=document.getElementById('signinGate'); if(g) g.style.display='none';
  const app=document.querySelector('.app'); if(app) app.style.display='';
  // 1) Render IMMEDIATELY from local cache / seeded defaults — no awaiting the
  //    network, so there's never a blank screen while Firestore connects.
  try{ loadState(); }
  catch(e){ console.error('loadState failed — rendering with default state', e); try{ seedDefaults(); }catch(_){ } }
  applyTheme();
  try{ syncRecurringIntoToday(); }catch(e){ console.warn('syncRecurringIntoToday failed', e); }
  // NOTE: we deliberately do NOT push to the cloud here. The write gate
  // (Store._gateOpen=false) blocks all cloud writes until the first cloud snapshot
  // has been received and reconciled — so an empty/stale device can never overwrite
  // good cloud data on startup. subscribeCloud() opens the gate and mirrors local up.
  q('#resetBtn').onclick=openReset;
  const tb=q('#themeBtn'); if(tb) tb.onclick=toggleTheme;
  q('#resetModal').onclick=(e)=>{ if(e.target.id==='resetModal') closeReset(); };
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeReset(); });
  go('dashboard');
  // 2) Now reconcile with the cloud in the background and keep syncing live.
  setSyncStatus(FB.user?'syncing':'local');
  subscribeCloud();
}

/* ---- background cloud sync ----
   The app is already rendered from local cache; this listener silently folds in
   the authoritative cloud state when it arrives (e.g. newer data from another
   device) and on every later change, without ever blocking the UI. */
let _cloudSettled=false;
function subscribeCloud(){
  if(!(FB.user && FB.db)) return;           // local-only mode: nothing to sync
  setSyncStatus('syncing');
  // If the first snapshot never arrives (e.g. offline), surface "not synced".
  const settleTimer=setTimeout(()=>{ if(!_cloudSettled){ _cloudSettled=true; setSyncStatus('error'); } }, 6000);
  Store.watchUserDoc((snap)=>{
    const firstSnap=!_cloudSettled;
    if(firstSnap){ _cloudSettled=true; clearTimeout(settleTimer); }
    setSyncStatus('synced', Date.now());   // a live snapshot means the cloud is reachable

    // brand-new account (or no state field) → cloud is empty; our local copy is
    // authoritative. Open the gate and mirror local up (guard allows growth).
    const data = snap.exists ? (snap.data()||{}) : {};
    const incoming = data.marcomaster;
    if(incoming==null){ Store._cloudCount=0; openGateAndFlush(firstSnap, false); return; }

    const cloudCount=stateCount(incoming);
    const localCount=stateCount(S);
    Store._cloudCount=cloudCount;

    // Durable, content-tied version lives INSIDE the state (updatedAt); fall back to
    // the legacy sibling _updated for pre-versioning docs.
    const cloudV=(+incoming.updatedAt) || (+data._updated) || 0;
    const localV=(+S.updatedAt) || 0;

    // ---- decide adoption: newer-wins, hardened with the content magnitude ----
    let adopt = cloudV>localV;
    // PROTECT: never adopt a cloud copy that is a catastrophic shrink of what we
    // hold locally — even if it carries a newer timestamp. Empty data with a fresh
    // stamp is exactly how the emptiness used to propagate. Keep local and re-assert
    // it upward to HEAL the poisoned cloud.
    if(adopt && isCatastrophicShrink(localCount, cloudCount)){
      Store._gateOpen=true;
      if(typeof onCloudLooksEmptied==='function') onCloudLooksEmptied(localCount, cloudCount);
      persist({bump:true, force:true});      // local is the good, larger copy → push it up
      return;
    }
    // RECOVER: if our LOCAL copy is the catastrophic shrink (this device looks
    // emptied/corrupted vs a substantial cloud), adopt the cloud regardless of
    // timestamp — bias hard toward the copy that actually has data.
    if(!adopt && isCatastrophicShrink(cloudCount, localCount)){
      adopt=true;
    }

    if(adopt && !saveTimer){
      S=incoming;
      seedDefaults();
      if((+S.updatedAt||0)<cloudV) S.updatedAt=cloudV;   // carry the version forward (legacy docs)
      Store._lsSet('marcomaster', S);
      try{ syncRecurringIntoToday(); }catch(e){ console.warn('syncRecurringIntoToday failed', e); }
      renderNav(); rerender();
    }
    openGateAndFlush(firstSnap, adopt);
  });
}
/* Open the cloud-write gate after the first reconcile. If we did NOT adopt the
   cloud copy (our local is authoritative — newer, or cloud was empty), mirror the
   local state up once so the cloud reflects this device. The shrink guard still
   protects this write, so a near-empty local can never overwrite a fuller cloud. */
function openGateAndFlush(firstSnap, adopted){
  Store._gateOpen=true;
  if(firstSnap && !adopted){ persist({bump:false}); }
}

/* ---------- persistent cloud-sync status indicator (sidebar brand) ----------
   Always visible so the user knows whether their data is safely in the cloud.
   States: 'syncing' (in flight), 'synced' (server acknowledged — shows the last
   synced time), 'error' (write/connection did NOT commit), 'local' (not signed
   in). The last-synced timestamp lives in its own localStorage key so it
   survives reloads but never lands inside the exported data backup. */
let _lastSyncedTs = (()=>{ try{ return +localStorage.getItem('mm_lastSync')||0; }catch(e){ return 0; } })();
function fmtSyncTime(ts){
  if(!ts) return '';
  try{ return new Date(ts).toLocaleTimeString('en-CA',{hour:'numeric',minute:'2-digit'}); }
  catch(e){ return ''; }
}
function setSyncStatus(state, ts){
  if(state==='synced' && ts){ _lastSyncedTs=ts; try{ localStorage.setItem('mm_lastSync', String(ts)); }catch(e){} }
  let el=document.getElementById('syncStatus');
  if(!el){
    const brand=document.querySelector('.brand'); if(!brand) return;
    el=document.createElement('div'); el.id='syncStatus'; el.className='sync-status';
    brand.appendChild(el);
  }
  el.classList.remove('is-synced','is-error','is-syncing','is-local');
  const since=_lastSyncedTs?fmtSyncTime(_lastSyncedTs):'';
  if(state==='syncing'){
    el.classList.add('is-syncing');
    el.innerHTML='<span class="sync-dot"></span><span class="sync-lbl">Syncing…</span>';
  }else if(state==='synced'){
    el.classList.add('is-synced');
    el.innerHTML='<span class="sync-dot"></span><span class="sync-lbl">Synced ✓'+(since?' · '+since:'')+'</span>';
  }else if(state==='local'){
    el.classList.add('is-local');
    el.innerHTML='<span class="sync-dot"></span><span class="sync-lbl">On this device only</span>';
  }else{ // 'error' — not synced
    el.classList.add('is-error');
    el.innerHTML='<span class="sync-dot"></span><span class="sync-lbl">Not synced'+(since?' · last '+since:'')+'</span>';
  }
}
/* legacy transient spinner — now routed through the persistent indicator */
function showSync(on){ if(on) setSyncStatus('syncing'); }

async function init(){
  // Sign-in is REQUIRED. There is no local-only bypass: without an authenticated
  // user the app shows only the sign-in screen and never renders the dashboard.
  if(typeof firebase==='undefined' || !firebase.initializeApp){
    showSignIn('Could not load sign-in. Check your connection and reload.');
    return;
  }
  try{
    FB.app=firebase.initializeApp(FIREBASE_CONFIG);
    FB.auth=firebase.auth();
    FB.db=firebase.firestore();
    FB.ready=true;
    try{ await FB.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); }catch(e){}
    FB.auth.onAuthStateChanged(async(user)=>{
      if(user){ FB.user=user; await startApp(); }
      else { FB.user=null; showSignIn(); }   // signed out → sign-in screen only
    });
  }catch(e){
    console.error('Firebase init failed — sign-in required', e);
    showSignIn('Could not connect to the cloud. Sign-in is required to use MarcoMaster.');
  }
}
init();

/* persistent "not synced" warning — shown when a cloud write does NOT commit, so
   the user knows their changes are only in this browser, not on the server. */
function setSyncWarning(on){
  let el=document.getElementById('syncWarn');
  if(on){
    if(!el){
      el=document.createElement('div'); el.id='syncWarn'; el.className='sync-warn';
      el.innerHTML='⚠ Not synced — changes saved on this device only. Check your connection / sign-in.';
      document.body.appendChild(el);
    }
    el.style.display='block';
  }else if(el){ el.style.display='none'; }
}

/* ---------- data-protection banner ---------- */
function showDataBanner(html, actions){
  let el=document.getElementById('dataGuardBanner');
  if(!el){ el=document.createElement('div'); el.id='dataGuardBanner'; el.className='data-guard-banner'; document.body.appendChild(el); }
  el.innerHTML=`<div class="dgb-inner"><span class="dgb-msg">${html}</span><span class="dgb-actions"></span></div>`;
  const wrap=el.querySelector('.dgb-actions');
  (actions||[]).forEach(a=>{ const b=document.createElement('button'); b.className='btn sm '+(a.cls||''); b.textContent=a.label; b.onclick=a.onClick; wrap.appendChild(b); });
  el.style.display='block';
}
function hideDataBanner(){ const el=document.getElementById('dataGuardBanner'); if(el) el.style.display='none'; }
/* a local write was BLOCKED because it would erase most of the cloud's data */
function onGuardBlocked(baseline, newCount){
  showDataBanner(
    `🛡️ <b>Write blocked to protect your data.</b> This change would shrink your data from ~${baseline} items to ~${newCount}. Your cloud backup was <b>not</b> overwritten.`,
    [
      {label:'View backups', onClick:()=>{ hideDataBanner(); go('settings'); setTimeout(()=>{ const e=document.getElementById('dataProtection'); if(e) e.scrollIntoView({behavior:'smooth',block:'start'}); },60); }},
      {label:'Override — write anyway', cls:'danger', onClick:()=>{ hideDataBanner(); Store._gateOpen=true; persist({force:true, bump:true}).then(ok=>{ toast(ok?'Written ✓':'Still not synced'); }); }},
    ]
  );
}
/* a newer-but-emptier cloud snapshot was rejected; local data was kept + restored */
function onCloudLooksEmptied(localCount, cloudCount){
  showDataBanner(
    `🛡️ <b>Protected your data.</b> The cloud copy looked emptied (~${cloudCount} items vs ~${localCount} on this device). Kept this device's data and restored it to the cloud.`,
    [ {label:'Dismiss', onClick:hideDataBanner} ]
  );
}

/* sign out (exposed for a settings button) */
async function signOut(){
  if(FB.auth){ try{ await FB.auth.signOut(); }catch(e){} location.reload(); }
}

