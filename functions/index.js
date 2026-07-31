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
// firebase-admin v14 dropped the `admin.firestore()/admin.messaging()` namespace
// helpers — use the modular subpath imports instead.
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { DateTime } = require('luxon');

initializeApp();
const db = getFirestore();

setGlobalOptions({ region: 'us-central1' });

const TZ = 'America/Toronto';
// Single-user app: read this one user document directly by UID — never scan the
// whole users collection (that would read the entire app-state doc every run).
const USER_UID = 'OgEsKyNilhhmmh5FmwIQXh1qRwu1';
const APP_URL = 'https://marcoguidopalermo.github.io/MarcoMaster/';
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
/* Resolve a time-of-day as minutes since midnight, 15-min aligned. Prefers the
   new atMin/startMin/endMin field, falls back to the legacy whole-hour field,
   then a default — so the function is correct whether it reads pre- or
   post-migration state. defMin is in minutes since midnight. */
function resolveTimeMin(minVal, legacyHour, defMin){
  if(Number.isInteger(minVal) && minVal >= 0 && minVal <= 1439) return Math.round(minVal / 15) * 15;
  if(Number.isInteger(legacyHour) && legacyHour >= 0 && legacyHour <= 23) return legacyHour * 60;
  return defMin;
}
/* minutes since midnight → "HH:MM" (24h) — used in dedupe keys so a changed
   time produces a new key and re-arms rather than being blocked by a stale marker. */
function hhmm(min){
  return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
}

/* Read notifSettings from app state with every field defaulted defensively —
   a missing object, a partial one, or garbage values can never throw and always
   yield sensible behaviour (matching the client defaults). */
function readNotifSettings(state){
  const ns = (state && state.notifSettings) || {};
  const appt = ns.appt || {};
  const digest = appt.digest || {};
  const checkin = ns.checkin || {};
  const night = ns.night || {};
  const LEAD = [15, 30, 60, 120];
  const INT = [30, 60, 90, 120];
  return {
    master: ns.master !== false,                    // default ON
    appt: {
      enabled: appt.enabled !== false,              // default ON
      minutesBefore: LEAD.includes(appt.minutesBefore) ? appt.minutesBefore : 30,
      // Optional second reminder — null (or any non-LEAD value, incl. 0) means off.
      minutesBefore2: LEAD.includes(appt.minutesBefore2) ? appt.minutesBefore2 : null,
      digest: {
        enabled: digest.enabled === true,           // default OFF
        atMin: resolveTimeMin(digest.atMin, digest.hour, 8 * 60),
      },
    },
    checkin: {
      enabled: checkin.enabled === true,            // default OFF
      intervalMin: INT.includes(checkin.intervalMin) ? checkin.intervalMin : 60,
      startMin: resolveTimeMin(checkin.startMin, checkin.startHour, 9 * 60),
      endMin: resolveTimeMin(checkin.endMin, checkin.endHour, 17 * 60),
    },
    night: {
      enabled: night.enabled === true,              // default OFF
      atMin: resolveTimeMin(night.atMin, night.hour, 21 * 60),   // 9:00pm
    },
  };
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
  const res = await getMessaging().sendEachForMulticast({
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

/* ---------- scheduled: reminders (lead / digest / check-in) ----------
   Ticks every 15 min, so every configured time resolves to the nearest tick.
   All behaviour is driven by notifSettings and gated by the master switch. */
exports.appointmentReminders = onSchedule(
  { schedule: 'every 15 minutes', timeZone: TZ },
  async () => {
    const uid = USER_UID;
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) { logger.info('no user doc; nothing to do'); return; }
    const state = (userSnap.data() || {}).marcomaster || {};
    const cfg = readNotifSettings(state);
    if (!cfg.master) return;   // master switch off → send nothing

    const appts = Array.isArray(state.appointments) ? state.appointments : [];
    const now = Date.now();

    // "Now" in Toronto, floored to the 15-min tick for slot alignment.
    const tor = DateTime.now().setZone(TZ);
    const tickMin = Math.floor(tor.minute / 15) * 15;
    const minutesNow = tor.hour * 60 + tickMin;     // minutes since local midnight, tick-aligned
    const todayKey = tor.toFormat('yyyy-LL-dd');

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
    const mark = (key) => { nextSent[key] = now; changed = true; };

    // 1) LEAD REMINDERS — up to two per appointment (primary + optional second),
    //    each within its own configured window. Key namespaced by lead minutes so
    //    the two never collide and each fires exactly once.
    if (cfg.appt.enabled) {
      const leads = [cfg.appt.minutesBefore];
      if (cfg.appt.minutesBefore2 && !leads.includes(cfg.appt.minutesBefore2)) {
        leads.push(cfg.appt.minutesBefore2);
      }
      for (const lead of leads) {
        for (const a of appts) {
          if (!a || a.done === true) continue;
          if (!a.date || !a.time) continue;
          const [y, mo, d] = String(a.date).split('-').map(Number);
          const [h, mi] = String(a.time).split(':').map(Number);
          const dt = DateTime.fromObject(
            { year: y, month: mo, day: d, hour: h || 0, minute: mi || 0 }, { zone: TZ });
          if (!dt.isValid) continue;
          const minutesUntil = (dt.toMillis() - now) / 60000;
          if (!(minutesUntil > 0 && minutesUntil <= lead)) continue;
          // Composite key incl. lead → two lead times never collide; a reschedule
          // re-fires; an unchanged appointment fires once per lead, ever.
          const key = `lead|${lead}|${a.id}|${a.date}|${a.time}`;
          if (nextSent[key]) continue;
          const result = await sendPush(uid, {
            title: a.title || 'Appointment reminder',
            body: `Starts at ${clockLabel(a.time)} — in about ${lead} minutes`,
            url: APP_URL,
          });
          logger.info('lead reminder sent', { key, ...result });
          mark(key);
        }
      }

      // 2) DAILY DIGEST — one push at the configured time listing today's appts.
      if (cfg.appt.digest.enabled && minutesNow === cfg.appt.digest.atMin) {
        const key = `digest|${todayKey}|${hhmm(cfg.appt.digest.atMin)}`;
        if (!nextSent[key]) {
          const todays = appts
            .filter(a => a && !a.done && a.date === todayKey && a.time)
            .sort((a, b) => String(a.time).localeCompare(String(b.time)));
          if (todays.length) {   // skip entirely if there are none
            const body = todays.map(a => `${clockLabel(a.time)} ${a.title || 'Appointment'}`).join(' · ');
            const result = await sendPush(uid, {
              title: `Today's appointments (${todays.length})`,
              body,
              url: APP_URL,
            });
            logger.info('digest sent', { key, count: todays.length, ...result });
            mark(key);
          }
        }
      }
    }

    // 3) CHECK-IN REMINDERS — at interval slots within the active window.
    const ci = cfg.checkin;
    if (ci.enabled && ci.endMin > ci.startMin) {
      const windowStart = ci.startMin;
      const windowEnd = ci.endMin;
      const inWindow = minutesNow >= windowStart && minutesNow <= windowEnd;
      const onSlot = ((minutesNow - windowStart) % ci.intervalMin) === 0;
      if (inWindow && onSlot) {
        const slot = `${String(tor.hour).padStart(2, '0')}:${String(tickMin).padStart(2, '0')}`;
        const key = `checkin|${todayKey}|${slot}`;
        if (!nextSent[key]) {
          const result = await sendPush(uid, {
            title: 'Check-in',
            body: "How are you doing? Take a moment to log a quick check-in.",
            url: APP_URL,
          });
          logger.info('check-in sent', { key, ...result });
          mark(key);
        }
      }
    }

    // 4) NIGHT REMINDER — one evening push at the configured time: journal nudge +
    //    tomorrow's appointment preview (omitted if none) + a bedtime line.
    if (cfg.night.enabled && minutesNow === cfg.night.atMin) {
      const key = `night|${todayKey}|${hhmm(cfg.night.atMin)}`;
      if (!nextSent[key]) {
        const tomorrowKey = tor.plus({ days: 1 }).toFormat('yyyy-LL-dd');
        const tomorrow = appts
          .filter(a => a && !a.done && a.date === tomorrowKey)
          .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
        const lines = ['Time for your evening journal.'];
        if (tomorrow.length) {
          const titles = tomorrow.map(a => a.title || 'Appointment').join(', ');
          lines.push(`Tomorrow: ${tomorrow.length} appointment${tomorrow.length > 1 ? 's' : ''} — ${titles}`);
        }
        lines.push('Nights get decided the night before — start easing toward bed.');
        const result = await sendPush(uid, {
          title: 'Wind down',
          body: lines.join('\n'),
          url: APP_URL,
        });
        logger.info('night reminder sent', { key, tomorrow: tomorrow.length, ...result });
        mark(key);
      }
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
