/* ============================================================
   PUSH NOTIFICATIONS — permission, token, and subscription storage.
   (Phase 2. Ports the shape of CrewMaster's src/lib/messaging.ts to
   this plain-JS app on the GitHub Pages subpath /MarcoMaster/.)

   Design guarantees:
   • Tokens are stored in their OWN Firestore collection (pushTokens/{uid}),
     written directly via FB.db — they NEVER pass through Store.persist(),
     so they never touch the write gate, the shrink-guard (stateCount /
     _cloudCount), the journal merge, or the local auto-backups.
   • The service worker registered in Phase 1 (app.js) is REUSED via
     navigator.serviceWorker.ready — this module never re-registers it.
   • Permission is requested ONLY on an explicit tap (enablePush). Load-time
     refreshPushToken() never prompts; it only runs when permission is
     already granted, so a rotated token stays live.
   ============================================================ */

/* FCM Web Push (VAPID) PUBLIC key — safe to embed. */
const PUSH_VAPID_KEY = "BC-BmmiOFIbTig0QuEaiRtgyqCGPxsWflMqaU9tqX71fA3BrJOP9Dt6DVEfUPA5-_KsiYJCaI6oZUJFvh_d2N6M";

/* ---------- environment classification ---------- */
function isIOS(){
  const ua = navigator.userAgent || '';
  if(/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ reports a desktop-Safari UA; detect via Mac UA + touch points.
  if(/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
  return false;
}
function isStandalone(){
  // Apple's legacy property OR the standard display-mode media query.
  return (navigator.standalone === true) ||
         (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}
function platformTag(){
  const ua = navigator.userAgent || '';
  let base = 'desktop';
  if(isIOS()) base = 'ios';
  else if(/Android/.test(ua)) base = 'android';
  return isStandalone() ? base + '-pwa' : base;
}

/* Classify the push environment for the Settings UI. Returns one of:
   'unsupported' | 'ios-not-installed' | 'denied' | 'granted' | 'supported'.
   Purely synchronous feature-detection; never prompts. */
function pushSupport(){
  const hasApi = ('Notification' in window) &&
                 ('serviceWorker' in navigator) &&
                 ('PushManager' in window);
  if(!hasApi) return 'unsupported';
  // iOS delivers web push only inside an installed, Home-Screen-launched PWA
  // (16.4+). Detect this BEFORE any prompt so we never show a dead-end.
  if(isIOS() && !isStandalone()) return 'ios-not-installed';
  const p = Notification.permission;
  if(p === 'denied') return 'denied';
  if(p === 'granted') return 'granted';
  return 'supported';   // permission 'default' — a tap can prompt
}

/* ---------- messaging handle (lazy, guarded) ---------- */
let _messaging = null;
function getMessaging(){
  if(_messaging) return _messaging;
  try{
    if(typeof firebase === 'undefined' || !firebase.messaging) return null;
    _messaging = firebase.messaging();
    return _messaging;
  }catch(e){ console.warn('messaging init failed', e); return null; }
}

/* ---------- token persistence (isolated collection) ---------- */
/* Upsert this device's token into pushTokens/{uid}.tokens[]. Deduped by token
   string: existing → refresh lastSeenAt/platform; new → append. Runs in a
   transaction so concurrent devices don't clobber each other. Written DIRECTLY
   via FB.db — completely outside Store.persist() and all its guards. */
async function savePushToken(token){
  if(!token) return false;
  if(!(FB.user && FB.db)){ toast('Sign in to sync notifications'); return false; }
  const now = Date.now();
  const platform = platformTag();
  const ref = FB.db.collection('pushTokens').doc(FB.user.uid);
  try{
    await FB.db.runTransaction(async (tx)=>{
      const snap = await tx.get(ref);
      const data = snap.exists ? (snap.data() || {}) : {};
      const tokens = Array.isArray(data.tokens) ? data.tokens.slice() : [];
      const i = tokens.findIndex(t => t && t.token === token);
      if(i >= 0){ tokens[i] = { ...tokens[i], platform, lastSeenAt: now }; }
      else { tokens.push({ token, platform, createdAt: now, lastSeenAt: now }); }
      tx.set(ref, { tokens }, { merge: true });
    });
    return true;
  }catch(e){ console.warn('savePushToken failed', e); return false; }
}

/* ---------- enable (TAP-GATED — the only path that prompts) ---------- */
async function enablePush(){
  const state = pushSupport();
  if(state === 'unsupported' || state === 'ios-not-installed' || state === 'denied') return state;
  const m = getMessaging();
  if(!m){ return 'unsupported'; }
  try{
    const perm = await Notification.requestPermission();
    if(perm !== 'granted') return (perm === 'denied') ? 'denied' : 'supported';
    // Reuse the Phase-1 service worker — do NOT register again.
    const reg = await navigator.serviceWorker.ready;
    const token = await m.getToken({ vapidKey: PUSH_VAPID_KEY, serviceWorkerRegistration: reg });
    if(!token){ console.warn('getToken returned empty'); return 'supported'; }
    await savePushToken(token);
    toast('Notifications enabled ✓');
    return 'granted';
  }catch(e){ console.warn('enablePush failed', e); return pushSupport(); }
}

/* ---------- load-time refresh (NEVER prompts) ---------- */
/* Only if permission is already granted: fetch the (possibly rotated) token and
   re-upsert it so it stays live across token rotation. Reuses the Phase-1 SW. */
async function refreshPushToken(){
  try{
    if(!('Notification' in window) || Notification.permission !== 'granted') return;
    const m = getMessaging();
    if(!m) return;
    const reg = await navigator.serviceWorker.ready;
    const token = await m.getToken({ vapidKey: PUSH_VAPID_KEY, serviceWorkerRegistration: reg });
    if(token) await savePushToken(token);
  }catch(e){ console.warn('refreshPushToken failed', e); }
}

/* ---------- foreground messages → in-app toast ---------- */
/* When the app is open, surface a message as the existing in-app toast instead
   of an OS notification. Bound once at startup. */
let _fgBound = false;
function onForegroundMessage(){
  if(_fgBound) return;
  const m = getMessaging();
  if(!m) return;
  _fgBound = true;
  try{
    m.onMessage((payload)=>{
      const n = (payload && payload.notification) || {};
      const d = (payload && payload.data) || {};
      const title = n.title || d.title || 'MarcoMaster';
      toast(title);
    });
  }catch(e){ console.warn('onForegroundMessage bind failed', e); _fgBound = false; }
}
