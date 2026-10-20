/* ============================================================
   MCP — the four tools. Built fresh per request (the endpoint is stateless).
   Every write goes through store.runOp; replies are short enough to be read aloud.
   ============================================================ */
const { z } = require('zod');
const { DateTime } = require('luxon');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const logger = require('firebase-functions/logger');
const { runOp, GuardError, newTaskId } = require('./store');
const T = require('./tasks');
const core = require('../shared/state-core.js');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const validDate = s => DATE_RE.test(s) && DateTime.fromISO(s, { zone: T.TZ }).isValid;
const text = s => ({ content: [{ type: 'text', text: s }] });
const fail = s => ({ content: [{ type: 'text', text: s }], isError: true });

/* completion in the app has side effects these kinds need (recurrence cadence,
   training log, meeting snapshot, leak promotion) — those stay in the app */
function completionRefusal(r){
  if (r.source === 'leak') return `"${r.txt}" is a leak task — complete it in the app so the leak's status updates.`;
  if (r.recurring) return `"${r.txt}" is a recurring task — complete it in the app so its next due date is set.`;
  if (r.workout) return `"${r.txt}" is a training session — complete it in the app so the session is logged.`;
  return null;
}
const listCandidates = (rows, tk) => rows.map(r => T.describeRow(r, tk)).join('\n');

function buildServer({ db, uid }){
  const now = T.torontoNow();
  const server = new McpServer(
    { name: 'marcomaster', version: '1.0.0' },
    { instructions:
      `MarcoMaster is Marco's personal task system. Today is ${now.weekday} ${now.dayKey} (America/Toronto). ` +
      `Convert relative dates ("Friday", "next week") to YYYY-MM-DD yourself. ` +
      `To complete or date a task, pass its id from list_tasks when you have it, otherwise words from its title; ` +
      `if a tool says the reference is ambiguous, ask the user which one and retry with the id. Never guess. ` +
      `Appointments take a date and a 24h time (HH:MM) in Toronto time. Meetings are named after a person or group ` +
      `("my meeting with William" → meeting "William"). The pipeline is today's top 3 focuses.` }
  );

  const exec = async (name, decide) => {
    try {
      const res = await runOp(db, uid, now, decide);
      logger.info('mcp tool', { tool: name, wrote: res.wrote, op: res.op && res.op.type, opId: res.op && res.op.id });
      return text(res.reply);
    } catch (e) {
      if (e instanceof GuardError) { logger.warn('mcp guard', { tool: name, msg: e.message }); return fail(e.message); }
      logger.error('mcp tool failed', { tool: name, err: e && (e.stack || e.message) });
      return fail('Something went wrong — nothing was changed.');
    }
  };

  server.registerTool('list_tasks', {
    title: 'List tasks',
    description: 'List MarcoMaster tasks (open by default). Each line ends with the task id to use with complete_task / set_due_date.',
    inputSchema: {
      filter: z.enum(['open', 'priority', 'due', 'overdue', 'done_today', 'pipeline']).optional()
        .describe('open (default) = everything open; priority = 🔥 flagged; due = open tasks with a due date, soonest first; overdue; done_today = Completed Today; pipeline = today\'s top-3 slots'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ filter = 'open' }) => {
    try {
      const snap = await db.collection('users').doc(uid).get();
      const state = (snap.data() || {}).marcomaster || {};
      const tk = now.dayKey;
      let rows;
      if (filter === 'pipeline') return text("Today's pipeline:\n" + T.describePipeline(T.pipelineView(state, tk)));
      if (filter === 'done_today') {
        rows = T.completedToday(state, tk);
        return text(rows.length ? `Completed today (${rows.length}):\n` + rows.map(r => `- ${r.txt}`).join('\n') : 'Nothing completed yet today.');
      }
      rows = T.taskRows(state, tk).filter(r => !r.done);
      if (filter === 'priority') rows = rows.filter(r => r.priority);
      if (filter === 'due') rows = rows.filter(r => r.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      if (filter === 'overdue') rows = rows.filter(r => T.isOverdue(r, tk));
      if (filter === 'open') rows.sort((a, b) => (b.priority - a.priority));
      return text(rows.length ? `${rows.length} ${filter} task${rows.length === 1 ? '' : 's'} (today is ${tk}):\n` + listCandidates(rows, tk) : `No ${filter} tasks.`);
    } catch (e) {
      logger.error('list_tasks failed', { err: e && (e.stack || e.message) });
      return fail('Could not read tasks.');
    }
  });

  server.registerTool('add_task', {
    title: 'Add a task',
    description: "Add a task to today's list in MarcoMaster. It appears in All Tasks, the fire picker and the pipeline like any task added in the app.",
    inputSchema: {
      title: z.string().trim().min(1).max(300).describe('What the task is'),
      kind: z.enum(['quick', 'block']).optional().describe('quick (default; a ≤2-minute task) or block (a time block to schedule)'),
      minutes: z.number().int().min(1).max(600).optional().describe('Estimated minutes (defaults: quick 2, block 60)'),
      priority: z.boolean().optional().describe('Flag with 🔥'),
      due_date: z.string().optional().describe('Due date YYYY-MM-DD'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ title, kind = 'quick', minutes, priority = false, due_date }) => {
    if (due_date && !validDate(due_date)) return fail(`"${due_date}" isn't a valid YYYY-MM-DD date.`);
    const k = kind === 'block' ? 'project' : 'quick';          // the app's internal name for a time block
    // exactly addTask()'s shape (js/tasks.js), plus the optional dueDate
    const task = { id: newTaskId(), txt: title, kind: k, done: false, priority: !!priority,
      mins: minutes || (k === 'quick' ? 2 : 60), start: null, schedDate: null };
    if (due_date) task.dueDate = due_date;
    return exec('add_task', () => ({
      op: { type: 'add', task },
      reply: `Added "${title}"${priority ? ' 🔥' : ''}${due_date ? `, due ${due_date}` : ''}. [id: S|${task.id}]`,
    }));
  });

  server.registerTool('complete_task', {
    title: 'Mark a task done',
    description: 'Mark one open task done. It moves to Completed Today. Pass the id from list_tasks, or words from the title.',
    inputSchema: { task: z.string().trim().min(1).describe('Task id (e.g. S|i3k2j9x) or words from its title') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ task }) => exec('complete_task', state => {
    const tk = now.dayKey;
    const m = T.resolveTask(state, tk, task);
    if (m.none) return { reply: `No open task matches "${task}". Use list_tasks to see what's open.` };
    if (m.ambiguous) return { reply: `Several open tasks match "${task}" — which one?\n` + listCandidates(m.ambiguous, tk) };
    const refusal = completionRefusal(m.row);
    if (refusal) return { reply: refusal };
    return { op: { type: 'complete', key: m.row.key }, reply: `Done: "${m.row.txt}".`, noChangeReply: `"${m.row.txt}" was already done.` };
  }));

  server.registerTool('set_due_date', {
    title: 'Set or clear a due date',
    description: 'Set (or clear, with date null) the due date of one open task.',
    inputSchema: {
      task: z.string().trim().min(1).describe('Task id (e.g. S|i3k2j9x) or words from its title'),
      date: z.string().nullable().describe('Due date YYYY-MM-DD, or null to clear it'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ task, date }) => {
    if (date != null && !validDate(date)) return fail(`"${date}" isn't a valid YYYY-MM-DD date.`);
    return exec('set_due_date', state => {
      const tk = now.dayKey;
      const m = T.resolveTask(state, tk, task);
      if (m.none) return { reply: `No open task matches "${task}". Use list_tasks to see what's open.` };
      if (m.ambiguous) return { reply: `Several open tasks match "${task}" — which one?\n` + listCandidates(m.ambiguous, tk) };
      return { op: { type: 'due', key: m.row.key, dueDate: date || null },
        reply: date ? `"${m.row.txt}" is now due ${date}.` : `Cleared the due date on "${m.row.txt}".`,
        noChangeReply: date ? `"${m.row.txt}" was already due ${date}.` : `"${m.row.txt}" had no due date.` };
    });
  });

  server.registerTool('list_appointments', {
    title: 'List appointments',
    description: 'Overdue appointments plus those coming up in the next N days (default 7, like the Today strip).',
    inputSchema: { days: z.number().int().min(1).max(90).optional().describe('How many days ahead, including today (default 7)') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ days = 7 }) => {
    try {
      const state = ((await db.collection('users').doc(uid).get()).data() || {}).marcomaster || {};
      const v = T.appointmentsView(state, days);
      const parts = [];
      if (v.overdue.length) parts.push(`Overdue (${v.overdue.length}):\n` + v.overdue.map(T.describeAppt).join('\n'));
      parts.push(v.upcoming.length ? `Next ${days} days (${v.upcoming.length}):\n` + v.upcoming.map(T.describeAppt).join('\n') : `Nothing in the next ${days} days.`);
      return text(parts.join('\n\n'));
    } catch (e) {
      logger.error('list_appointments failed', { err: e && (e.stack || e.message) });
      return fail('Could not read appointments.');
    }
  });

  server.registerTool('add_appointment', {
    title: 'Add an appointment',
    description: 'Book an appointment (date + 24h time, Toronto). It shows in the Today strip and the calendar, and gets the usual reminders.',
    inputSchema: {
      title: z.string().trim().min(1).max(200).describe('What it is, e.g. "Dentist"'),
      date: z.string().describe('YYYY-MM-DD'),
      time: z.string().describe('HH:MM, 24-hour'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ title, date, time }) => {
    if (!validDate(date)) return fail(`"${date}" isn't a valid YYYY-MM-DD date.`);
    if (!TIME_RE.test(time)) return fail(`"${time}" isn't a valid 24-hour HH:MM time.`);
    const when = DateTime.fromISO(`${date}T${time}`, { zone: T.TZ });
    if (!when.isValid) return fail(`${date} ${time} doesn't exist in Toronto time.`);
    if (when.toMillis() <= Date.now()) return fail(`${T.dateLabel(date)} at ${T.clockLabel(time)} is in the past — nothing was booked.`);
    // exactly createAppointment()'s record (js/page-appointments.js → appendAppointment)
    const appt = { id: newTaskId(), title, date, time, createdAt: Date.now() };
    return exec('add_appointment', () => ({
      op: { type: 'appt', appt },
      reply: `Booked "${title}" for ${T.dateLabel(date)} at ${T.clockLabel(time)}.`,
    }));
  });

  server.registerTool('add_meeting_point', {
    title: 'Add a talking point to a meeting',
    description: 'Add a talking point to an existing meeting, named as spoken ("William", "team sync").',
    inputSchema: {
      meeting: z.string().trim().min(1).describe('The meeting\'s name, or words from it'),
      point: z.string().trim().min(1).max(500).describe('The talking point'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ meeting, point }) => exec('add_meeting_point', state => {
    const m = T.resolveMeeting(state, meeting);
    if (m.ambiguous) return { reply: `Several meetings match "${meeting}" — which one?\n` + m.ambiguous.map(x => `- ${x.name}`).join('\n') };
    if (m.none) return { reply: `No meeting matches "${meeting}". Your meetings: ` + (m.all.map(x => x.name).join(', ') || 'none yet') + '.' };
    // exactly createMeetingPoint()'s point (js/page-meetings.js → appendMeetingPoint)
    return { op: { type: 'mpoint', meetingId: m.meeting.id, point: { id: newTaskId(), txt: point, done: false } },
      reply: `Added to ${m.meeting.name}: "${point}".` };
  }));

  server.registerTool('add_to_pipeline', {
    title: "Put something in today's pipeline",
    description: "Put a task into the next free slot of today's top-3 pipeline: either an existing open task (id or title words), " +
      'or a new task created and promoted in one step. Never displaces anything: if all 3 slots are taken it says what is there.',
    inputSchema: {
      task: z.string().trim().min(1).optional().describe('An existing open task: id (e.g. S|i3k2j9x) or words from its title'),
      new_task: z.string().trim().min(1).max(300).optional().describe('Title of a NEW quick task to create and promote'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ task, new_task }) => {
    if (!!task === !!new_task) return fail('Give exactly one of task (an existing task) or new_task (a new one).');
    return exec('add_to_pipeline', state => {
      const tk = now.dayKey;
      const view = T.pipelineView(state, tk);
      if (view.length >= 3) return { reply: `The pipeline is full — nothing was changed:\n` + T.describePipeline(view) };
      if (new_task) {
        // a plain quick task (addTask's shape), linked exactly as materializePipelineItem links one
        const t = { id: newTaskId(), txt: new_task, kind: 'quick', done: false, priority: false, mins: 2, start: null, schedDate: null };
        return { op: { type: 'pipe', task: t, item: { id: newTaskId(), txt: new_task, taskId: t.id, done: false } },
          reply: `Added "${new_task}" as a task and put it in the pipeline (${view.length + 1} of 3 slots taken).` };
      }
      const m = T.resolveTask(state, tk, task);
      if (m.none) return { reply: `No open task matches "${task}". Use list_tasks to see what's open.` };
      if (m.ambiguous) return { reply: `Several open tasks match "${task}" — which one?\n` + listCandidates(m.ambiguous, tk) };
      const r = m.row, [src, a, b2] = r.key.split('|');
      const item = src === 'S' ? { id: newTaskId(), txt: r.txt, taskId: a, done: false }
                 : src === 'P' ? { id: newTaskId(), txt: r.txt, projectId: a, projTaskId: b2, done: false }
                 : { id: newTaskId(), txt: r.txt, leakId: a, leakTaskId: b2, done: false };
      if (view.some(x => core.pipelineLinkKey(x.it) === r.key)) return { reply: `"${r.txt}" is already in the pipeline.` };
      return { op: { type: 'pipe', key: r.key, item }, reply: `Put "${r.txt}" in the pipeline (${view.length + 1} of 3 slots taken).` };
    });
  });

  return server;
}

module.exports = { buildServer };
