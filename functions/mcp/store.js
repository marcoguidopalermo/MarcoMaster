/* ============================================================
   MCP — WRITE SIDE: the ONE path by which anything outside the app changes
   users/{uid}.marcomaster. Every tool write goes through runOp(); nothing else in
   the functions codebase writes that field.

   Inside a single Firestore transaction (a concurrent app write forces a retry
   against the fresh copy, so neither write is lost to the other):
     1. read the live document — never a cached or stale copy;
     2. REFUSE unless it holds substantial state (>= PROTECT_FLOOR). The server never
        creates, seeds or rebuilds state: that is the startup write-gate's job;
     3. resolve the request against THAT read and turn it into an op;
     4. apply the op to a clone with applyExtOp — the same function every device
        uses to replay it (state-core.js);
     5. verify: item count moves by exactly what the op implies (expectedDelta),
        the client's own isCatastrophicShrink still says no, and only the paths this
        op may touch differ;
     6. stamp the version with the client's rule (nextVersion) and record the op in
        state.extApplied (applied) and the sibling users/{uid}.extOps log (replay);
     7. write ONLY the changed paths with field-path updates — never the whole state.
   ============================================================ */
const crypto = require('crypto');
const { isDeepStrictEqual } = require('util');
const { FieldPath } = require('firebase-admin/firestore');
const core = require('../shared/state-core.js');

const OP_LOG_TTL_MS = 14 * 24 * 60 * 60 * 1000;   // replay window for devices that were offline
const APPLIED_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // outlives the log, so a pruned op is never re-applied
const OP_LOG_MAX = 200;

class GuardError extends Error {}

const newOpId = () => 'op_' + crypto.randomBytes(9).toString('base64url');
/* same alphabet/shape as the app's b(): 'i' + 7 base-36 chars */
const newTaskId = () => 'i' + Array.from(crypto.randomBytes(7), x => (x % 36).toString(36)).join('');

/* which top-level / per-day paths differ between two states */
function changedPaths(before, after){
  const out = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (k === 'days') {
      const bd = before.days || {}, ad = after.days || {};
      for (const dk of new Set([...Object.keys(bd), ...Object.keys(ad)])) {
        if (!(dk in bd) || !(dk in ad)) { out.push(['days', dk]); continue; }
        for (const f of new Set([...Object.keys(bd[dk] || {}), ...Object.keys(ad[dk] || {})])) {
          if (!isDeepStrictEqual((bd[dk] || {})[f], (ad[dk] || {})[f])) out.push(['days', dk, f]);
        }
      }
    } else if (!isDeepStrictEqual(before[k], after[k])) {
      out.push([k]);
    }
  }
  return out;
}

/* the paths an op of this type is allowed to change (before the stamp fields) */
const TASK_OPS = ['add', 'complete', 'due', 'pipe'];
function pathAllowed(p, op, before, todayKey){
  const t = op.type;
  const src = String(op.key || '').split('|')[0];
  if (p[0] === 'days' && p.length === 2) {                                      // creating TODAY's record, nothing else
    return TASK_OPS.includes(t) && p[1] === todayKey && !(before.days || {})[todayKey];
  }
  if (p[0] === 'days' && p.length === 3) {
    if (p[2] === 'tasks') return TASK_OPS.includes(t);                          // a day's task list (incl. a rollover move)
    if (p[2] === 'pipeline') return t === 'pipe' && p[1] === todayKey;          // only today's pipeline
    return false;
  }
  if (p.length !== 1) return false;
  if (p[0] === 'projects') return (t === 'complete' || t === 'due') && src === 'P';
  if (p[0] === 'leaks') return t === 'due' && src === 'L';
  if (p[0] === 'appointments') return t === 'appt';
  if (p[0] === 'meetings') return t === 'mpoint';
  if (p[0] === 'followups') return t === 'followup';
  return false;
}
/* exactly how many items (stateCount) an op adds — talking points aren't counted */
function expectedDelta(op){
  if (op.type === 'add' || op.type === 'appt' || op.type === 'followup') return 1;
  if (op.type === 'pipe') return 1 + (op.task ? 1 : 0);
  return 0;
}

/* applied-op markers, pruned to the last APPLIED_TTL_MS (an array — see state-core.js) */
function prunedApplied(state, now){
  return core.extAppliedList(state).filter(x => typeof x.ts === 'number' && now - x.ts < APPLIED_TTL_MS);
}

/* Run one external op. `decide(state, ctx)` reads the fresh state and returns
     { op }            — an op to apply ({type, key?, task?, dueDate?}), or
     { reply }         — an answer that needs no write (ambiguous, not found, refused).
   Returns { wrote:boolean, op?, reply?, state } — state is what was committed (or read).
   hooks.afterRead (tests only) runs between the read and the write. */
async function runOp(db, uid, now, decide, hooks = {}){
  const ref = db.collection('users').doc(uid);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new GuardError('No MarcoMaster document exists — open the app first. Nothing was written.');
    const data = snap.data() || {};
    const before = data.marcomaster;
    if (!before || typeof before !== 'object') throw new GuardError('The app state is missing — nothing was written.');
    const beforeCount = core.stateCount(before);
    if (beforeCount < core.PROTECT_FLOOR) {
      throw new GuardError(`The app state looks empty (${beforeCount} items) — refusing to write from outside the app.`);
    }
    if (hooks.afterRead) await hooks.afterRead();

    const next = JSON.parse(JSON.stringify(before));
    const ctx = {
      todayKey: now.dayKey,
      today: () => { if (!next.days) next.days = {}; if (!next.days[now.dayKey]) next.days[now.dayKey] = core.blankDay(); return next.days[now.dayKey]; },
    };
    const decision = decide(before, now);
    if (!decision.op) return { wrote: false, reply: decision.reply, state: before };

    const op = { ...decision.op, id: newOpId(), ts: Date.now(), dayKey: now.dayKey, hm: now.hm };
    const changed = core.applyExtOp(next, op, ctx);
    if (!changed) return { wrote: false, reply: decision.noChangeReply || 'Nothing to change.', state: before };

    // ---- guards: the same magnitude + shrink rule the app enforces, then stricter ----
    const afterCount = core.stateCount(next);
    const expected = beforeCount + expectedDelta(op);
    if (afterCount !== expected) throw new GuardError(`Guard: item count would go ${beforeCount} → ${afterCount} (expected ${expected}). Nothing was written.`);
    if (core.isCatastrophicShrink(beforeCount, afterCount)) throw new GuardError('Guard: catastrophic shrink. Nothing was written.');
    const paths = changedPaths(before, next);
    const bad = paths.filter(p => !pathAllowed(p, op, before, now.dayKey));
    if (bad.length) throw new GuardError('Guard: unexpected change to ' + bad.map(p => p.join('.')).join(', ') + '. Nothing was written.');

    // ---- stamp: version (client rule) + applied marker + replay log ----
    const t = op.ts;
    const applied = prunedApplied(before, t).concat([{ id: op.id, ts: t }]);
    const version = core.nextVersion(before.updatedAt);
    const log = (Array.isArray(data.extOps) ? data.extOps : [])
      .filter(o => o && typeof o.ts === 'number' && t - o.ts < OP_LOG_TTL_MS)
      .concat([JSON.parse(JSON.stringify(op))])
      .slice(-OP_LOG_MAX);

    const args = [];
    paths.forEach(p => {
      let v = next; p.forEach(k => { v = v[k]; });
      args.push(new FieldPath('marcomaster', ...p), v);
    });
    args.push(new FieldPath('marcomaster', 'extApplied'), applied);
    args.push(new FieldPath('marcomaster', 'updatedAt'), version);
    args.push('_updated', version);                     // mirrors updatedAt, as Store.set does
    args.push('extOps', log);
    tx.update(ref, ...args);

    next.extApplied = applied; next.updatedAt = version;
    return { wrote: true, op, reply: decision.reply, state: next };
  });
}

module.exports = { runOp, GuardError, newTaskId, changedPaths };
