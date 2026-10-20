/* ============================================================
   MCP — READ SIDE: listing tasks and resolving a spoken reference to one.
   A read-only mirror of the app's All Tasks sources (buildTaskRows in
   js/page-today.js): active-project tasks, open-leak tasks, and today's
   standalone day-tasks (project-linked blocks and meeting blocks excluded, as
   the app excludes them). Nothing here writes — mutations go through store.js.
   ============================================================ */
const { DateTime } = require('luxon');
const core = require('../shared/state-core.js');

const TZ = 'America/Toronto';

/* "now" for this request, in the app's timezone: the day key the app would call
   todayKey() and the HH:MM it would call nowHM(). */
function torontoNow(){
  const t = DateTime.now().setZone(TZ);
  return { dayKey: t.toFormat('yyyy-LL-dd'), hm: t.toFormat('HH:mm'), weekday: t.toFormat('cccc') };
}

/* The day record unfinished standalone tasks will be carried FROM when a device
   next runs day(): the latest record before today — but only if today's rollover
   bridge hasn't run yet (no record, or one the server created without _seeded). */
function pendingCarryKey(state, todayKey){
  const days = state.days || {};
  const rec = days[todayKey];
  if (rec && rec._seeded) return null;
  return Object.keys(days).filter(k => k < todayKey).sort().pop() || null;
}

/* Every task row, open and done, from the same sources All Tasks reads. */
function taskRows(state, todayKey){
  const rows = [];
  (state.projects || []).filter(p => p && !p.done).forEach(p => {
    (p.tasks || []).forEach(t => {
      if (!t) return;
      rows.push({ key: `P|${p.id}|${t.id}`, source: 'project', id: t.id, txt: t.txt || '', done: !!t.done,
        kind: t.kind || 'project', priority: !!t.priority, dueDate: t.dueDate || null,
        doneAt: t.doneAt || null, where: p.name || 'project' });
    });
  });
  (state.leaks || []).filter(l => l && l.status !== 'closed').forEach(l => {
    (l.tasks || []).forEach(t => {
      if (!t) return;
      rows.push({ key: `L|${l.id}|${t.id}`, source: 'leak', id: t.id, txt: t.txt || '', done: !!t.done,
        kind: 'quick', priority: !!t.priority, dueDate: t.dueDate || null,
        doneAt: t.doneAt || null, where: 'leak: ' + (l.text || '') });
    });
  });
  const days = state.days || {};
  const standalone = (dk, list, carried) => (list || []).forEach(t => {
    if (!t || t.projectId || t.meetingId) return;
    rows.push({ key: `S|${t.id}`, source: 'standalone', id: t.id, txt: t.txt || '', done: !!t.done,
      kind: t.kind, priority: !!t.priority, dueDate: t.dueDate || null, doneAt: t.doneAt || null,
      recurring: !!t.recurringId, workout: !!t.workoutId, dayKey: dk, carried,
      schedDate: t.schedDate == null ? null : t.schedDate });
  });
  standalone(todayKey, (days[todayKey] || {}).tasks, false);
  const prevKey = pendingCarryKey(state, todayKey);
  if (prevKey) {
    // what the app's rollover bridge WILL move into today the next time it opens
    standalone(prevKey, ((days[prevKey] || {}).tasks || [])
      .filter(t => t && !t.done && !t.recurringId && !t.workoutId), true);
  }
  return rows;
}

/* overdue = past its due date, or (time-block) scheduled on a past day — the app's rule */
function isOverdue(r, todayKey){
  if (r.done) return false;
  if (r.dueDate && r.dueDate < todayKey) return true;
  return r.kind === 'project' && r.schedDate != null && r.schedDate < todayKey;
}

/* Completed Today, as the app counts it: project/leak tasks stamped with today's
   day key, done standalone tasks living in today's record, and today's archive. */
function completedToday(state, todayKey){
  const out = [];
  taskRows(state, todayKey).forEach(r => {
    if (!r.done) return;
    if (r.source === 'standalone' ? r.dayKey === todayKey : r.doneAt === todayKey) out.push(r);
  });
  (((state.days || {})[todayKey] || {}).archive || []).forEach(a => {
    if (a) out.push({ key: `A|${a.id}`, source: 'archive', txt: a.txt || '', done: true, doneAt: a.doneAt || null });
  });
  return out;
}

const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/* Resolve a reference (a row key, a bare task id, or words from the title) against
   OPEN tasks. Returns {row} for exactly one match, {ambiguous:[rows]} for several,
   or {none:true}. Never guesses between two candidates — a voice slip must not
   complete the wrong task. */
function resolveTask(state, todayKey, ref){
  const open = taskRows(state, todayKey).filter(r => !r.done);
  const raw = String(ref || '').trim();
  const byKey = open.filter(r => r.key === raw || r.id === raw);
  if (byKey.length === 1) return { row: byKey[0] };
  const q = norm(raw);
  if (!q) return { none: true };
  for (const test of [
    r => norm(r.txt) === q,
    r => norm(r.txt).includes(q),
    r => q.split(' ').every(w => norm(r.txt).split(' ').includes(w)),
  ]) {
    const hit = open.filter(test);
    if (hit.length === 1) return { row: hit[0] };
    if (hit.length > 1) return { ambiguous: hit.slice(0, 8) };
  }
  return { none: true };
}

/* one line per task, short enough to be read aloud */
function describeRow(r, todayKey){
  const bits = [];
  if (r.priority) bits.push('🔥');
  bits.push(r.txt);
  const meta = [];
  meta.push(r.source === 'standalone' ? (r.kind === 'quick' ? 'quick' : 'time block') : r.where);
  if (r.recurring) meta.push('recurring');
  if (r.workout) meta.push('training');
  if (r.dueDate) meta.push((r.dueDate < todayKey && !r.done ? 'OVERDUE, was due ' : 'due ') + r.dueDate);
  else if (isOverdue(r, todayKey)) meta.push('OVERDUE (scheduled ' + r.schedDate + ')');
  return `- ${bits.join(' ')} — ${meta.join(', ')} [id: ${r.key}]`;
}

/* ---------- meetings ----------
   Resolve a spoken meeting name ("William", "the Friday sync") against S.meetings,
   same tiers as tasks: exact name, then contains, then every word present.
   Never guesses between two. */
function resolveMeeting(state, ref){
  const ms = (state.meetings || []).filter(m => m && m.id);
  const q = norm(ref);
  if (!q) return { none: true, all: ms };
  for (const test of [
    m => norm(m.name) === q,
    m => norm(m.name).includes(q),
    m => q.split(' ').every(w => norm(m.name).split(' ').includes(w)),
  ]) {
    const hit = ms.filter(test);
    if (hit.length === 1) return { meeting: hit[0] };
    if (hit.length > 1) return { ambiguous: hit };
  }
  return { none: true, all: ms };
}

/* ---------- the pipeline, as the app will show it today ----------
   today's items, plus — if no device has run today's rollover yet — yesterday's
   unfinished ones the rollover will append. Each with its live done-state. */
function pipelineView(state, todayKey){
  const rec = (state.days || {})[todayKey] || { tasks: [], pipeline: [] };
  const items = (rec.pipeline || []).filter(Boolean).map(it => ({ it, done: core.pipelineItemDone(state, rec, it), carried: false }));
  core.pendingPipelineCarry(state, todayKey).forEach(it => items.push({ it, done: false, carried: true }));
  return items;
}
function describePipeline(items){
  if (!items.length) return 'The pipeline is empty — 3 free slots.';
  const lines = items.map((x, i) => `${i + 1}. ${x.done ? '✓ ' : ''}${x.it.txt}${x.done ? ' (done)' : ''}${x.carried ? ' (rolling over from yesterday)' : ''}`);
  const free = Math.max(0, 3 - items.length);
  return lines.join('\n') + (free ? `\n${free} free slot${free === 1 ? '' : 's'}.` : '');
}

/* ---------- appointments ---------- */
/* has it passed? With a time, the exact moment (Toronto); without, the end of its day — apptOverdue's rule */
function apptOverdue(a, nowDt){
  if (!a || !a.date || a.done) return false;
  const dt = DateTime.fromISO(a.time ? `${a.date}T${a.time}` : `${a.date}T23:59:59`, { zone: TZ });
  return dt.isValid && dt.toMillis() < nowDt.toMillis();
}
/* overdue ones first (they never scroll away in the app either), then the next `days` days */
function appointmentsView(state, days){
  const now = DateTime.now().setZone(TZ);
  const end = now.plus({ days: days - 1 }).toFormat('yyyy-LL-dd');
  const today = now.toFormat('yyyy-LL-dd');
  const all = (state.appointments || []).filter(a => a && a.date && !a.done);
  const key = a => a.date + (a.time || '');
  return {
    overdue: all.filter(a => apptOverdue(a, now)).sort((a, b) => key(a).localeCompare(key(b))),
    upcoming: all.filter(a => !apptOverdue(a, now) && a.date >= today && a.date <= end).sort((a, b) => key(a).localeCompare(key(b))),
  };
}
function clockLabel(hhmm){
  if (!hhmm) return 'no time';
  const [h, m] = String(hhmm).split(':').map(Number);
  let d = h % 12; if (d === 0) d = 12;
  return d + ':' + String(m || 0).padStart(2, '0') + (h >= 12 ? 'pm' : 'am');
}
const dateLabel = (k) => DateTime.fromISO(k, { zone: TZ }).toFormat('ccc LLL d');
const describeAppt = (a) => `- ${dateLabel(a.date)} ${clockLabel(a.time)} — ${a.title}`;

/* ---------- generic "id or words" resolution (follow-ups, appointments, projects) ----------
   Same tiers as resolveTask: exact id, exact text, contains, every word present.
   One match → {item}; several → {ambiguous}; none → {none}. Never guesses. */
function resolveBy(list, ref, textOf){
  const raw = String(ref || '').trim();
  const byId = list.filter(x => x.id === raw);
  if (byId.length === 1) return { item: byId[0] };
  const q = norm(raw);
  if (!q) return { none: true };
  for (const test of [
    x => norm(textOf(x)) === q,
    x => norm(textOf(x)).includes(q),
    x => q.split(' ').every(w => norm(textOf(x)).split(' ').includes(w)),
  ]) {
    const hit = list.filter(test);
    if (hit.length === 1) return { item: hit[0] };
    if (hit.length > 1) return { ambiguous: hit.slice(0, 8) };
  }
  return { none: true };
}
const resolveOpenFollowup = (state, ref) => resolveBy((state.followups || []).filter(f => f && f.id && !f.resolved), ref, f => f.txt);
const resolveActiveAppt = (state, ref) => resolveBy((state.appointments || []).filter(a => a && a.id && !a.done), ref, a => a.title);
const resolveActiveProject = (state, ref) => resolveBy((state.projects || []).filter(p => p && p.id && !p.done), ref, p => p.name);

/* What delete_task will remove, counted independently of the code that removes it
   (the guard then checks the two agree): the task, a project task's linked calendar
   blocks, and every pipeline item pointing at either. */
function deleteFootprint(state, key){
  const [src, a, b] = String(key).split('|');
  const days = state.days || {};
  const all = (f) => Object.keys(days).reduce((n, dk) => n + f(days[dk] || {}), 0);
  if (src === 'S') {
    const n = all(d => (d.tasks || []).filter(t => t && t.id === a).length);
    return n ? { total: n + all(d => (d.pipeline || []).filter(it => it && it.taskId === a).length), blocks: 0 } : { total: 0, blocks: 0 };
  }
  if (src === 'P') {
    const p = (state.projects || []).find(x => x && x.id === a);
    if (!p || !(p.tasks || []).some(t => t && t.id === b)) return { total: 0, blocks: 0 };
    const blockIds = new Set();
    Object.keys(days).forEach(dk => (days[dk].tasks || []).forEach(t => { if (t && t.projectId === a && t.projTaskId === b) blockIds.add(t.id); }));
    const pipe = all(d => (d.pipeline || []).filter(it => it && ((it.projectId === a && it.projTaskId === b) || blockIds.has(it.taskId))).length);
    return { total: 1 + blockIds.size + pipe, blocks: blockIds.size };
  }
  return { total: 0, blocks: 0 };
}
/* the raw task object behind a row key (read-only lookups for from-values) */
function taskByKey(state, key){
  const [src, a, b] = String(key).split('|');
  if (src === 'S') { for (const d of Object.values(state.days || {})) { const t = (d.tasks || []).find(x => x && x.id === a); if (t) return t; } return null; }
  if (src === 'P') { const p = (state.projects || []).find(x => x && x.id === a); return p ? (p.tasks || []).find(x => x && x.id === b) || null : null; }
  if (src === 'L') { const l = (state.leaks || []).find(x => x && x.id === a); return l ? (l.tasks || []).find(x => x && x.id === b) || null : null; }
  return null;
}
/* does a project task have a calendar block (a linked day-task) anywhere? */
const projTaskHasBlock = (state, pid, tid) => Object.values(state.days || {}).some(d => (d.tasks || []).some(t => t && t.projectId === pid && t.projTaskId === tid));

/* ---------- follow-ups ----------
   open ones, longest-untouched first; age by the app's rule (followupAgeLabel) */
function followupsView(state, nowMs){
  const all = (state.followups || []).filter(f => f && f.id);
  const since = f => f.lastTouched || f.createdAt || nowMs;
  return {
    open: all.filter(f => !f.resolved).sort((a, b) => since(a) - since(b)),
    resolvedCount: all.filter(f => f.resolved).length,
  };
}
const msDate = (ms) => DateTime.fromMillis(ms, { zone: TZ }).toFormat('LLL d');
function describeFollowup(f, nowMs){
  const bits = [core.followupAgeLabel(f, nowMs)];
  if (f.createdAt && f.lastTouched && f.lastTouched - f.createdAt > 60000) bits.push(`opened ${msDate(f.createdAt)}, last followed up ${msDate(f.lastTouched)}`);
  else if (f.createdAt) bits.push(`opened ${msDate(f.createdAt)}`);
  return `- ${f.txt}${f.note ? ` (${f.note})` : ''} — ${bits.join(', ')}`;
}

module.exports = { resolveBy, resolveOpenFollowup, resolveActiveAppt, resolveActiveProject, deleteFootprint, taskByKey, projTaskHasBlock,
  followupsView, describeFollowup, resolveMeeting, pipelineView, describePipeline, appointmentsView, apptOverdue, clockLabel, dateLabel, describeAppt,
  TZ, torontoNow, pendingCarryKey, taskRows, isOverdue, completedToday, resolveTask, describeRow };
