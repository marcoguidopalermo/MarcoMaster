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
  persist();   // fire-and-forget; never block the first render on a write
  q('#resetBtn').onclick=openReset;
  const tb=q('#themeBtn'); if(tb) tb.onclick=toggleTheme;
  q('#resetModal').onclick=(e)=>{ if(e.target.id==='resetModal') closeReset(); };
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeReset(); });
  go('dashboard');
  // 2) Now reconcile with the cloud in the background and keep syncing live.
  subscribeCloud();
}

/* ---- background cloud sync ----
   The app is already rendered from local cache; this listener silently folds in
   the authoritative cloud state when it arrives (e.g. newer data from another
   device) and on every later change, without ever blocking the UI. */
let _cloudSettled=false, _lastAppliedUpdate=0;
function subscribeCloud(){
  if(!(FB.user && FB.db)) return;           // local-only mode: nothing to sync
  showSync(true);
  // Stop the spinner even if the first snapshot never arrives (e.g. offline).
  const settleTimer=setTimeout(()=>{ if(!_cloudSettled){ _cloudSettled=true; showSync(false); } }, 6000);
  Store.watchUserDoc((snap)=>{
    if(!_cloudSettled){ _cloudSettled=true; clearTimeout(settleTimer); showSync(false); }
    if(!snap.exists){ persist(); return; }   // brand-new account → create the doc
    const data=snap.data()||{};
    const incoming=data.marcomaster;
    const ts=data._updated||0;
    if(incoming==null) return;
    if(ts<=_lastAppliedUpdate) return;        // already have this (or newer)
    if(ts<=Store._lastWriteTs) return;        // echo of our own write — ignore
    if(saveTimer) return;                     // a local edit is mid-flight; let it win
    // Adopt the cloud state and silently re-render the current page.
    _lastAppliedUpdate=ts;
    S=incoming;
    seedDefaults();
    Store._lsSet('marcomaster', S);
    try{ syncRecurringIntoToday(); }catch(e){ console.warn('syncRecurringIntoToday failed', e); }
    renderNav(); rerender();
  });
}

/* tiny, non-blocking "syncing…" indicator in the sidebar */
function showSync(on){
  let el=document.getElementById('syncTag');
  if(on){
    if(!el){
      el=document.createElement('div'); el.id='syncTag'; el.className='sync-tag'; el.textContent='syncing…';
      const brand=document.querySelector('.brand'); if(brand) brand.appendChild(el);
    }
    el.style.display='block';
  }else if(el){ el.style.display='none'; }
}

async function init(){
  // If Firebase SDK is present, use cloud auth + sync. Otherwise run local-only.
  if(typeof firebase!=='undefined' && firebase.initializeApp){
    try{
      FB.app=firebase.initializeApp(FIREBASE_CONFIG);
      FB.auth=firebase.auth();
      FB.db=firebase.firestore();
      FB.ready=true;
      try{ await FB.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); }catch(e){}
      FB.auth.onAuthStateChanged(async(user)=>{
        if(user){ FB.user=user; await startApp(); }
        else { FB.user=null; showSignIn(); }
      });
      return;
    }catch(e){
      console.warn('Firebase init failed, running local-only',e);
    }
  }
  // local-only fallback (e.g. opened as a plain file)
  await startApp();
}
init();

/* sign out (exposed for a settings button) */
async function signOut(){
  if(FB.auth){ try{ await FB.auth.signOut(); }catch(e){} location.reload(); }
}

