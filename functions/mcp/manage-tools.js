/* ============================================================
   MCP — managing what already exists: follow-ups, tasks, projects, appointments.
   Same conventions as tools.js: a thing is named by its id OR words from its
   title; several matches → the candidates with ids, and nothing is written;
   replies are one short sentence. Every write goes through store.runOp (one
   transaction, exact count, allowed paths, version stamp, op log) and every
   op is applied by state-core.js's applyExtOp, the same code a device replays.

   Deliberately refused (their side effects live in the app):
     • kind / minutes on recurring, training and leak tasks, and a kind change on a
       task that has a calendar block (unschedule it first);
     • deleting recurring, training or leak tasks;
     • moving anything but an open, unscheduled, plain day-task;
     • editing or cancelling an appointment a meeting or training session owns.
   Both destructive tools (delete_task, cancel_appointment) only describe what they
   would remove unless called with confirm: true.
   ============================================================ */
const { z } = require('zod');
const { DateTime } = require('luxon');
const T = require('./tasks');
const core = require('../shared/state-core.js');
const { newTaskId } = require('./store');

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = s => DATE_RE.test(s) && DateTime.fromISO(s, { zone: T.TZ }).isValid;
const W = { readOnlyHint: false, openWorldHint: false };

/* "which one?" lists, with the ids to retry with */
const fuLine = f => `- ${f.txt} [id: ${f.id}]`;
const apptLine = a => `- ${T.dateLabel(a.date)} ${T.clockLabel(a.time)} — ${a.title} [id: ${a.id}]`;
const projLine = p => `- ${p.name} [id: ${p.id}]`;

function registerManageTools(server, { exec, fail, now }){
  const tk = now.dayKey;
  const taskMiss = (ref, m) => m.none ? { reply: `No open task matches "${ref}". Use list_tasks to see what's open.` }
    : { reply: `Several open tasks match "${ref}" — which one?\n` + m.ambiguous.map(r => T.describeRow(r, tk)).join('\n') };

  /* ---------------- follow-ups ---------------- */
  server.registerTool('update_followup', {
    title: 'Mark a follow-up as followed up',
    description: 'Use when the user has just chased / followed up on an open loop: marks it touched today (resets its age), ' +
      'optionally adding a note (appended to any existing note). Name it by id or words from its text. To close it instead, use resolve_followup.',
    inputSchema: {
      followup: z.string().trim().min(1).describe('Follow-up id or words from its text'),
      note: z.string().trim().min(1).max(300).optional().describe('Optional note to add, e.g. "they said Friday"'),
    },
    annotations: { ...W, destructiveHint: false, idempotentHint: false },
  }, async ({ followup, note }) => exec('update_followup', state => {
    const m = T.resolveOpenFollowup(state, followup);
    if (m.none) return { reply: `No open follow-up matches "${followup}". Use list_followups to see them.` };
    if (m.ambiguous) return { reply: `Several open follow-ups match "${followup}" — which one?\n` + m.ambiguous.map(fuLine).join('\n') };
    const f = m.item;
    const op = { type: 'fu_touch', followupId: f.id };
    if (note) { op.noteFrom = f.note || ''; op.note = f.note ? `${f.note} · ${note}` : note; }
    return { op, reply: `Marked "${f.txt}" as followed up today${note ? ', with your note' : ''}.` };
  }));

  server.registerTool('resolve_followup', {
    title: 'Resolve a follow-up',
    description: 'Use when an open loop is closed for good (they replied, it got paid, no longer needed): resolves it so it leaves the open list. ' +
      'Name it by id or words from its text. It can be reopened in the app.',
    inputSchema: { followup: z.string().trim().min(1).describe('Follow-up id or words from its text') },
    annotations: { ...W, destructiveHint: false, idempotentHint: true },
  }, async ({ followup }) => exec('resolve_followup', state => {
    const m = T.resolveOpenFollowup(state, followup);
    if (m.none) return { reply: `No open follow-up matches "${followup}". Use list_followups to see them.` };
    if (m.ambiguous) return { reply: `Several open follow-ups match "${followup}" — which one?\n` + m.ambiguous.map(fuLine).join('\n') };
    return { op: { type: 'fu_resolve', followupId: m.item.id }, reply: `Resolved "${m.item.txt}".` };
  }));

  /* ---------------- tasks ---------------- */
  server.registerTool('set_priority', {
    title: 'Set or clear the 🔥 priority flag',
    description: 'Use to flag a task as a priority (🔥) or remove the flag. Works on day tasks, project tasks and leak tasks; name it by id or title words.',
    inputSchema: {
      task: z.string().trim().min(1).describe('Task id (e.g. S|i3k2j9x) or words from its title'),
      priority: z.boolean().describe('true to flag 🔥, false to clear it'),
    },
    annotations: { ...W, destructiveHint: false, idempotentHint: true },
  }, async ({ task, priority }) => exec('set_priority', state => {
    const m = T.resolveTask(state, tk, task);
    if (!m.row) return taskMiss(task, m);
    const t = T.taskByKey(state, m.row.key);
    if (!!(t && t.priority) === priority) return { reply: `"${m.row.txt}" is already ${priority ? 'flagged 🔥' : 'unflagged'}.` };
    return { op: { type: 'prio', key: m.row.key, from: { priority: t.priority === undefined ? null : t.priority }, to: { priority } },
      reply: priority ? `Flagged "${m.row.txt}" 🔥.` : `Cleared the 🔥 flag on "${m.row.txt}".` };
  }));

  server.registerTool('edit_task', {
    title: 'Edit a task',
    description: "Use to change an existing task's title, kind (quick = a ≤2-minute task, block = a time block to schedule), " +
      'estimated minutes (time blocks only), or due date (null clears it). Only the fields given change. Name it by id or title words.',
    inputSchema: {
      task: z.string().trim().min(1).describe('Task id (e.g. S|i3k2j9x) or words from its title'),
      title: z.string().trim().min(1).max(300).optional().describe('New title'),
      kind: z.enum(['quick', 'block']).optional().describe('quick or block'),
      minutes: z.number().int().min(1).max(600).optional().describe('Estimated minutes (time blocks only)'),
      due_date: z.string().nullable().optional().describe('Due date YYYY-MM-DD, or null to clear'),
    },
    annotations: { ...W, destructiveHint: false, idempotentHint: true },
  }, async ({ task, title, kind, minutes, due_date }) => {
    if (title === undefined && kind === undefined && minutes === undefined && due_date === undefined) return fail('Say what to change: title, kind, minutes or due_date.');
    if (due_date != null && !validDate(due_date)) return fail(`"${due_date}" isn't a valid YYYY-MM-DD date.`);
    return exec('edit_task', state => {
      const m = T.resolveTask(state, tk, task);
      if (!m.row) return taskMiss(task, m);
      const r = m.row, t = T.taskByKey(state, r.key);
      const [src, pid, tid] = r.key.split('|');
      const to = {}, unset = [], said = [];
      if (title !== undefined && title !== t.txt) { to.txt = title; said.push(`renamed to "${title}"`); }
      if (due_date !== undefined && (due_date || null) !== (t.dueDate || null)) {
        if (due_date) { to.dueDate = due_date; said.push(`due ${due_date}`); } else { unset.push('dueDate'); said.push('due date cleared'); }
      }
      if (kind !== undefined || minutes !== undefined) {
        if (src === 'L') return { reply: `"${r.txt}" is a leak task — those are always quick, so kind and minutes can't change.` };
        if (r.recurring || r.workout) return { reply: `"${r.txt}" is a ${r.recurring ? 'recurring' : 'training'} task — change its kind or length in the app.` };
        const curKind = (t.kind || (src === 'P' ? 'project' : 'quick')) === 'project' ? 'block' : 'quick';
        const newKind = kind || curKind;
        if (newKind !== curKind) {
          const scheduled = src === 'S' ? t.schedDate != null : T.projTaskHasBlock(state, pid, tid);
          if (scheduled) return { reply: `"${r.txt}" has a time block on the calendar — unschedule it in the app before changing its kind.` };
        }
        if (newKind === 'quick' && minutes !== undefined) return { reply: 'Quick tasks are ≤2 minutes by definition — make it a block to give it minutes.' };
        if (newKind !== curKind) {
          said.push(newKind === 'block' ? 'now a time block' : 'now a quick task');
          if (src === 'S') {                      // addTask's shapes: quick = 2 min, block = 60 by default; both unscheduled
            to.kind = newKind === 'block' ? 'project' : 'quick';
            to.mins = newKind === 'block' ? (minutes || 60) : 2;
            to.start = null; to.schedDate = null;
          } else {                                // addUnifiedTask's project-task shapes: mins only on a block
            to.kind = newKind === 'block' ? 'project' : 'quick';
            if (newKind === 'block') to.mins = minutes || t.mins || 60; else unset.push('mins');
          }
        } else if (minutes !== undefined && minutes !== t.mins) {
          to.mins = minutes;
        }
        if (minutes !== undefined && to.mins === minutes) said.push(`${minutes} minutes`);
      }
      const keys = [...Object.keys(to), ...unset];
      if (!keys.length) return { reply: `"${r.txt}" already looks like that — nothing changed.` };
      const from = {}; keys.forEach(k => { from[k] = t[k] === undefined ? null : t[k]; });
      return { op: { type: 'edit', key: r.key, from, to, unset }, reply: `Updated "${r.txt}": ${said.join(', ')}.` };
    });
  });

  server.registerTool('delete_task', {
    title: 'Delete a task permanently',
    description: 'Use ONLY when the user clearly wants a task gone for good (not done — use complete_task for that). Permanently removes it, ' +
      'along with its pipeline slot and, for a project task, its calendar blocks. Call first without confirm to hear what would be deleted; ' +
      'then call again with confirm: true once the user agrees.',
    inputSchema: {
      task: z.string().trim().min(1).describe('Task id (e.g. S|i3k2j9x) or words from its title'),
      confirm: z.boolean().optional().describe('Must be true to actually delete'),
    },
    annotations: { ...W, destructiveHint: true, idempotentHint: true },
  }, async ({ task, confirm }) => exec('delete_task', state => {
    const m = T.resolveTask(state, tk, task);
    if (!m.row) return taskMiss(task, m);
    const r = m.row;
    if (r.source === 'leak') return { reply: `"${r.txt}" is a leak task — delete it in the app so the leak's status stays right.` };
    if (r.recurring || r.workout) return { reply: `"${r.txt}" is a ${r.recurring ? 'recurring' : 'training'} task — remove it in the app.` };
    const fp = T.deleteFootprint(state, r.key);
    const extra = fp.total - 1 - fp.blocks;
    const what = `"${r.txt}"${fp.blocks ? ` and its ${fp.blocks} calendar block${fp.blocks === 1 ? '' : 's'}` : ''}${extra > 0 ? `${fp.blocks ? ',' : ' and'} its pipeline slot` : ''}`;
    if (confirm !== true) return { reply: `This would permanently delete ${what}. Nothing was deleted — call again with confirm: true to go ahead.` };
    return { op: { type: 'del', key: r.key, n: fp.total }, reply: `Deleted ${what}.` };
  }));

  server.registerTool('move_task_to_project', {
    title: 'Move a task into a project',
    description: 'Use to file an existing day task under an existing project (it keeps its title, kind, 🔥 and due date, and any pipeline slot). ' +
      'Name the task and the project by id or words. Create the project first with create_project if it does not exist.',
    inputSchema: {
      task: z.string().trim().min(1).describe('Task id (e.g. S|i3k2j9x) or words from its title'),
      project: z.string().trim().min(1).describe('Project id or words from its name'),
    },
    annotations: { ...W, destructiveHint: false, idempotentHint: true },
  }, async ({ task, project }) => exec('move_task_to_project', state => {
    const m = T.resolveTask(state, tk, task);
    if (!m.row) return taskMiss(task, m);
    const r = m.row;
    if (r.source !== 'standalone') return { reply: `"${r.txt}" already belongs to ${r.where} — move it between projects in the app.` };
    if (r.recurring || r.workout) return { reply: `"${r.txt}" is a ${r.recurring ? 'recurring' : 'training'} task — it can't be moved into a project.` };
    if (r.schedDate != null) return { reply: `"${r.txt}" has a time block on the calendar — unschedule it in the app first.` };
    const pm = T.resolveActiveProject(state, project);
    if (pm.none) return { reply: `No active project matches "${project}". Projects: ` + ((state.projects || []).filter(p => p && !p.done).map(p => p.name).join(', ') || 'none yet') + '.' };
    if (pm.ambiguous) return { reply: `Several projects match "${project}" — which one?\n` + pm.ambiguous.map(projLine).join('\n') };
    return { op: { type: 'move', key: r.key, projectId: pm.item.id }, reply: `Moved "${r.txt}" into ${pm.item.name}.` };
  }));

  server.registerTool('create_project', {
    title: 'Create a project',
    description: 'Use to start a new project (a container for related tasks). If an active project with the same name exists, nothing is created.',
    inputSchema: { name: z.string().trim().min(1).max(120).describe('Project name') },
    annotations: { ...W, destructiveHint: false, idempotentHint: true },
  }, async ({ name }) => exec('create_project', state => {
    const same = (state.projects || []).find(p => p && !p.done && String(p.name || '').trim().toLowerCase() === name.toLowerCase());
    if (same) return { reply: `You already have a project called "${same.name}" — nothing was created.` };
    // exactly createProject()'s record (js/page-projects.js → appendProject / nextProjectColor)
    const project = { id: newTaskId(), name, color: core.nextProjectColor(state), done: false, tasks: [] };
    return { op: { type: 'project', project }, reply: `Created project "${name}".` };
  }));

  server.registerTool('add_completed_task', {
    title: 'Log a task as already done',
    description: "Use when the user reports something they've ALREADY finished today and wants it logged: adds it straight to Completed Today " +
      '(like the app\'s "already done" tick), stamped with the current time. For a task to do later, use add_task.',
    inputSchema: {
      title: z.string().trim().min(1).max(300).describe('What was done'),
      kind: z.enum(['quick', 'block']).optional().describe('quick (default) or block'),
      minutes: z.number().int().min(1).max(600).optional().describe('How long it took (blocks)'),
    },
    annotations: { ...W, destructiveHint: false, idempotentHint: false },
  }, async ({ title, kind = 'quick', minutes }) => {
    const k = kind === 'block' ? 'project' : 'quick';
    // addTask()'s shape, then markTaskDoneNow(): done, doneAt = the time (HH:MM)
    const task = { id: newTaskId(), txt: title, kind: k, done: true, priority: false,
      mins: minutes || (k === 'quick' ? 2 : 60), start: null, schedDate: null, doneAt: now.hm };
    return exec('add_completed_task', () => ({ op: { type: 'add', task }, reply: `Logged "${title}" as done at ${T.clockLabel(now.hm)}.` }));
  });

  /* ---------------- appointments ---------------- */
  const apptMiss = (ref, m) => m.none ? { reply: `No upcoming appointment matches "${ref}". Use list_appointments to see them.` }
    : { reply: `Several appointments match "${ref}" — which one?\n` + m.ambiguous.map(apptLine).join('\n') };

  server.registerTool('edit_appointment', {
    title: 'Edit an appointment',
    description: "Use to reschedule or rename an appointment: change its date (YYYY-MM-DD), time (24h HH:MM, Toronto) and/or title. " +
      'Only the fields given change; the new date and time must be in the future. Name it by id or words from its title.',
    inputSchema: {
      appointment: z.string().trim().min(1).describe('Appointment id or words from its title'),
      title: z.string().trim().min(1).max(200).optional(),
      date: z.string().optional().describe('YYYY-MM-DD'),
      time: z.string().optional().describe('HH:MM, 24-hour'),
    },
    annotations: { ...W, destructiveHint: false, idempotentHint: true },
  }, async ({ appointment, title, date, time }) => {
    if (title === undefined && date === undefined && time === undefined) return fail('Say what to change: title, date or time.');
    if (date !== undefined && !validDate(date)) return fail(`"${date}" isn't a valid YYYY-MM-DD date.`);
    if (time !== undefined && !TIME_RE.test(time)) return fail(`"${time}" isn't a valid 24-hour HH:MM time.`);
    return exec('edit_appointment', state => {
      const m = T.resolveActiveAppt(state, appointment);
      if (!m.item) return apptMiss(appointment, m);
      const a = m.item;
      if (core.apptIsLinked(state, a.id)) return { reply: `"${a.title}" belongs to a meeting or training session — reschedule it from there in the app.` };
      const to = {};
      if (title !== undefined && title !== a.title) to.title = title;
      if (date !== undefined && date !== a.date) to.date = date;
      if (time !== undefined && time !== a.time) to.time = time;
      if (!Object.keys(to).length) return { reply: `"${a.title}" already looks like that — nothing changed.` };
      const nd = to.date || a.date, nt = to.time || a.time;
      if (to.date || to.time) {
        const when = DateTime.fromISO(`${nd}T${nt || '23:59'}`, { zone: T.TZ });
        if (!when.isValid) return { reply: `${nd} ${nt} doesn't exist in Toronto time — nothing changed.` };
        if (when.toMillis() <= Date.now()) return { reply: `${T.dateLabel(nd)} at ${T.clockLabel(nt)} is in the past — nothing changed.` };
      }
      const from = {}; Object.keys(to).forEach(k => { from[k] = a[k] === undefined ? null : a[k]; });
      return { op: { type: 'appt_edit', apptId: a.id, from, to },
        reply: `Updated: "${to.title || a.title}" is ${T.dateLabel(nd)} at ${T.clockLabel(nt)}.` };
    });
  });

  server.registerTool('cancel_appointment', {
    title: 'Cancel an appointment',
    description: 'Use when an appointment is called off: removes it from the calendar and the Today strip (no reminder will fire). ' +
      'To merely move it, use edit_appointment. Name it by id or words from its title. Call first without confirm to hear which ' +
      'appointment would be cancelled; then call again with confirm: true once the user agrees.',
    inputSchema: {
      appointment: z.string().trim().min(1).describe('Appointment id or words from its title'),
      confirm: z.boolean().optional().describe('Must be true to actually cancel'),
    },
    annotations: { ...W, destructiveHint: true, idempotentHint: true },
  }, async ({ appointment, confirm }) => exec('cancel_appointment', state => {
    const m = T.resolveActiveAppt(state, appointment);
    if (!m.item) return apptMiss(appointment, m);
    const a = m.item;
    if (core.apptIsLinked(state, a.id)) return { reply: `"${a.title}" belongs to a meeting or training session — cancel it from there in the app.` };
    const what = `"${a.title}" (${T.dateLabel(a.date)} ${T.clockLabel(a.time)})`;
    // a misheard name must never remove the wrong one: describe first, act only on confirm
    if (confirm !== true) return { reply: `This would cancel ${what}. Nothing was cancelled — call again with confirm: true to go ahead.` };
    return { op: { type: 'appt_cancel', apptId: a.id }, reply: `Cancelled ${what}.` };
  }));
}

module.exports = { registerManageTools };
