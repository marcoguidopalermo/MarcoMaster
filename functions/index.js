/* ============================================================
   MarcoMaster — Cloud Functions (v2), region us-central1.
   The push SENDER (Phase 3). Two functions:
     • appointmentReminders — scheduled every 15 min; sends a push ~30 min
       before an appointment starts (America/Toronto), once per appointment.
     • sendTestNotification — callable; fires a test push to the caller's
       own devices on demand.

   ISOLATION: dedupe markers live in their OWN collection (sentReminders/{uid}),
   written only here via the Admin SDK. They never touch the guarded
   users/{uid}.marcomaster field, stateCount, the shrink-guard, or the journal
   merge. The scheduled function READS users/{uid}.marcomaster.appointments but
   never writes the users doc, so it cannot trip any client-side guard.
   ============================================================ */

const { setGlobalOptions } = require('firebase-functions/v2');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const { DateTime } = require('luxon');

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ region: 'us-central1' });

const TZ = 'America/Toronto';
// Single-user app: read this one user document directly by UID — never scan the
// whole users collection (that would read the entire app-state doc every run).
const USER_UID = 'OgEsKyNilhhmmh5FmwIQXh1qRwu1';
const APP_URL = 'https://marcoguidopalermo.github.io/MarcoMaster/';
const REMINDER_MINUTES = 30;   // fire when an appointment starts within this many minutes
const MARKER_TTL_MS = 24 * 60 * 60 * 1000;   // prune sent-markers older than 24h

// FCM error codes that mean the token is dead and should be pruned.
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/* "14:05" → "2:05pm" */
function clockLabel(time){
  const [h, m] = String(time || '').split(':').map(Number);
  const ampm = (h >= 12) ? 'pm' : 'am';
  let disp = h % 12; if (disp === 0) disp = 12;
  return disp + ':' + String(m || 0).padStart(2, '0') + ampm;
}

/* Read this user's push tokens (array of token strings) from pushTokens/{uid}. */
async function readTokens(uid){
  const snap = await db.collection('pushTokens').doc(uid).get();
  const data = snap.exists ? (snap.data() || {}) : {};
  const arr = Array.isArray(data.tokens) ? data.tokens : [];
  return arr.map(t => t && t.token).filter(Boolean);
}

/* Remove dead tokens from pushTokens/{uid} (transactional). */
async function pruneTokens(uid, deadSet){
  if (!deadSet || !deadSet.size) return;
  const ref = db.collection('pushTokens').doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const arr = Array.isArray(snap.data().tokens) ? snap.data().tokens : [];
    const kept = arr.filter(t => t && !deadSet.has(t.token));
    tx.set(ref, { tokens: kept }, { merge: true });
  });
}

/* Send a DATA-ONLY multicast (no notification field — the service worker builds
   the notification itself; a notification field would double-display on web).
   Prunes dead tokens afterward. Returns { tokens, sent, failed }. */
async function sendPush(uid, { title, body, url }){
  const tokens = await readTokens(uid);
  if (!tokens.length) return { tokens: 0, sent: 0, failed: 0 };
  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    data: {
      title: String(title || 'MarcoMaster'),
      body: String(body || ''),
      url: String(url || APP_URL),
    },
  });
  const dead = new Set();
  res.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error && r.error.code;
      if (DEAD_TOKEN_CODES.has(code)) dead.add(tokens[i]);
    }
  });
  await pruneTokens(uid, dead);
  return { tokens: tokens.length, sent: res.successCount, failed: res.failureCount };
}

/* ---------- scheduled: appointment reminders ---------- */
exports.appointmentReminders = onSchedule(
  { schedule: 'every 15 minutes', timeZone: TZ },
  async () => {
    const uid = USER_UID;
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) { logger.info('no user doc; nothing to do'); return; }
    const state = (userSnap.data() || {}).marcomaster || {};
    const appts = Array.isArray(state.appointments) ? state.appointments : [];
    if (!appts.length) return;

    const now = Date.now();

    // Load dedupe markers, pruning any older than the TTL so the map stays bounded.
    const sentRef = db.collection('sentReminders').doc(uid);
    const sentSnap = await sentRef.get();
    const sentMap = (sentSnap.exists && sentSnap.data() && sentSnap.data().sent) || {};
    const nextSent = {};
    let changed = false;
    for (const [k, v] of Object.entries(sentMap)) {
      if (typeof v === 'number' && (now - v) < MARKER_TTL_MS) nextSent[k] = v;
      else changed = true;   // dropped a stale marker
    }

    for (const a of appts) {
      if (!a || a.done === true) continue;      // skip completed
      if (!a.date || !a.time) continue;         // need a concrete start time
      const [y, mo, d] = String(a.date).split('-').map(Number);
      const [h, mi] = String(a.time).split(':').map(Number);
      const dt = DateTime.fromObject(
        { year: y, month: mo, day: d, hour: h || 0, minute: mi || 0 },
        { zone: TZ }
      );
      if (!dt.isValid) continue;
      const minutesUntil = (dt.toMillis() - now) / 60000;
      if (!(minutesUntil > 0 && minutesUntil <= REMINDER_MINUTES)) continue;

      // Composite key → a reschedule (new date/time) fires a fresh reminder;
      // an unchanged appointment fires exactly once, ever.
      const key = `${a.id}|${a.date}|${a.time}`;
      if (nextSent[key]) continue;   // already fired

      const result = await sendPush(uid, {
        title: a.title || 'Appointment reminder',
        body: `Starts at ${clockLabel(a.time)} — in about ${REMINDER_MINUTES} minutes`,
        url: APP_URL,
      });
      logger.info('reminder sent', { key, title: a.title, ...result });
      nextSent[key] = now;
      changed = true;
    }

    // Overwrite the sent field wholesale (not merge) so pruned keys are removed.
    if (changed) await sentRef.set({ sent: nextSent });
  }
);

/* ---------- callable: on-demand test push ---------- */
exports.sendTestNotification = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = request.auth.uid;
  const result = await sendPush(uid, {
    title: 'MarcoMaster',
    body: 'Test notification ✓',
    url: APP_URL,
  });
  logger.info('test push', { uid, ...result });
  return result;   // { tokens, sent, failed }
});
