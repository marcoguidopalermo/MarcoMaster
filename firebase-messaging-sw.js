/* ============================================================
   MarcoMaster — Firebase Cloud Messaging service worker.

   Served at /MarcoMaster/firebase-messaging-sw.js so its default scope is
   /MarcoMaster/, which covers the whole app on GitHub Pages (subpath host).

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

// App home on the GitHub Pages subpath — used for the notification icon + click target.
const APP_URL = '/MarcoMaster/';
const NOTIF_ICON = '/MarcoMaster/icons/icon-192-any.png';

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
        if (client.url.indexOf(APP_URL) !== -1 && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
