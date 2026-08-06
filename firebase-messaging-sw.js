/* ============================================================
   MarcoMaster — Firebase Cloud Messaging service worker.

   Served at /firebase-messaging-sw.js on Firebase Hosting, so its default scope
   is / — the whole app. (It previously lived under the /MarcoMaster/ GitHub Pages
   subpath; the origin move is why every path below is root-relative.)

   PHASE 1 (PWA foundation) — SCAFFOLDING ONLY:
     • Handles background FCM messages (onBackgroundMessage) + notification clicks.
     • NO token logic here (no getToken / VAPID / subscriptions) — later phase.
     • NO caching of any kind: no install/activate/fetch listeners, no precache,
       no runtime cache. This SW never intercepts a network request, so ?v=
       cache-busts always reach the network and updates are never frozen.
   ============================================================ */

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// Same project config as the page (js/app.js). Kept inline because a service
// worker cannot import the app's module scope.
firebase.initializeApp({
  apiKey: "AIzaSyA_NXXhonvWNjwq76Cv6oQJ5h4uFBTOqFc",
  authDomain: "marcomaster-c4930.firebaseapp.com",
  projectId: "marcomaster-c4930",
  storageBucket: "marcomaster-c4930.firebasestorage.app",
  messagingSenderId: "778355921159",
  appId: "1:778355921159:web:1c348cbbe4e69b7ef8f5a2",
  measurementId: "G-02WVTRFCDR"
});

const messaging = firebase.messaging();

// App home at the hosting root — used for the notification icon + click target.
const APP_URL = '/';
const NOTIF_ICON = '/icons/icon-192-any.png';

// Background message (app not in foreground): show a system notification.
messaging.onBackgroundMessage((payload) => {
  const n = (payload && payload.notification) || {};
  const data = (payload && payload.data) || {};
  const title = n.title || data.title || 'MarcoMaster';
  const options = {
    body: n.body || data.body || '',
    icon: NOTIF_ICON,
    badge: NOTIF_ICON,
    data: { url: data.url || APP_URL }
  };
  return self.registration.showNotification(title, options);
});

// Notification click: focus an existing app tab if open, else open one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || APP_URL;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        // Match on ORIGIN, not a substring of the path. At the hosting root APP_URL
        // is '/', and indexOf('/') is true for EVERY url — which would silently turn
        // this into "focus whatever window comes first". Comparing origins is what
        // the check always meant, and it survives any future path change.
        let sameOrigin = false;
        try { sameOrigin = (new URL(client.url).origin === self.location.origin); } catch (e) {}
        if (sameOrigin && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
