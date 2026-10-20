/* The ten management tools: follow-ups, tasks, projects, appointments. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('util');
const { DateTime } = require('luxon');
const H = require('./harness');
const core = require('../shared/state-core.js');
const { runOp, changedPaths, GuardError } = require('../mcp/store');
const T = require('../mcp/tasks');

let srv, token;
const call = (name, args) => H.callTool(srv.base, token, name, args);
const today = () => T.torontoNow().dayKey;
const count = (doc) => core.stateCount(doc.marcomaster);
const inDays = (n) => DateTime.now().setZone(T.TZ).plus({ days: n }).toFormat('yyyy-LL-dd');
const DAY = 86400000;
const paths = (a, b) => changedPaths(a.marcomaster, b.marcomaster).map(p => p.join('.')).filter(p => p !== 'updatedAt' && p !== 'extApplied').sort();
const tasksOf = (doc) => (doc.marcomaster.days[today()] || {}).tasks || [];
const taskById = (doc, id) => Object.values(doc.marcomaster.days).flatMap(d => d.tasks || []).find(t => t.id === id);
const proj = (doc, id) => doc.marcomaster.projects.find(p => p.id === id);
const fu = (doc, id) => doc.marcomaster.followups.find(f => f.id === id);
const appt = (doc, id) => doc.marcomaster.appointments.find(a => a.id === id);
const noWrite = async (before) => assert.ok(isDeepStrictEqual(await H.read(), before), 'nothing was written');

/* fixtures layered onto the copy — each test re-seeds, so every test starts identical */
const q = (id, txt, extra = {}) => ({ id, txt, kind: 'quick', done: false, priority: false, mins: 2, start: null, schedDate: null, ...extra });
function fixtures(m){
  const tk = today(), now = Date.now();
  m.followups = (m.followups || []).concat([
    { id: 'fua', txt: 'Chase Acme invoice', note: 'sent twice', createdAt: now - 6 * DAY, lastTouched: now - 6 * DAY, resolved: false },
    { id: 'fub', txt: 'Chase Acme contract', note: '', createdAt: now - 3 * DAY, lastTouched: now - 3 * DAY, resolved: false },
    { id: 'fuc', txt: 'Call landlord about lease', note: '', createdAt: now - DAY, lastTouched: now - DAY, resolved: false },
  ]);
  if (!m.days) m.days = {};
  if (!m.days[tk]) m.days[tk] = core.blankDay();
  const d = m.days[tk];
  d._seeded = true;
  d.tasks = (d.tasks || []).concat([
    q('is1', 'Email Sam about invoice'), q('is2', 'Email Sam about contract'), q('is3', 'Buy printer ink', { dueDate: inDays(4) }),
    q('is4', 'Write the proposal', { kind: 'project', mins: 60 }),
    q('is5', 'Deep work session', { kind: 'project', mins: 90, schedDate: tk, start: 9 }),
    q('is6', 'Take supplements daily', { recurringId: 'r3' }),
    { id: 'ib1', txt: 'Write homepage copy', kind: 'project', done: false, priority: false, mins: 60, start: 10, schedDate: tk, projectId: 'pw', projTaskId: 'pt2' },
  ]);
  d.pipeline = [{ id: 'pp1', txt: 'Write homepage copy', projectId: 'pw', projTaskId: 'pt2', done: false }, { id: 'pp2', txt: 'Buy printer ink', taskId: 'is3', done: false }];
  m.projects = (m.projects || []).concat([
    { id: 'pw', name: 'Website', color: '#58a6ff', done: false, tasks: [
      { id: 'pt1', txt: 'Design the hero banner', done: false, priority: false, kind: 'quick' },
      { id: 'pt2', txt: 'Write homepage copy', done: false, priority: false, kind: 'project', mins: 60 }] },
    { id: 'pw2', name: 'Website redesign', color: '#3fb950', done: false, tasks: [] },
  ]);
  m.leaks = (m.leaks || []).concat([{ id: 'lfix', text: 'Inbox creep', occurrences: [1], createdAt: 1, lastSeenAt: 1, status: 'open', notes: '',
    tasks: [{ id: 'ltfix', txt: 'Unsubscribe from newsletters', done: false, doneAt: null, priority: false, kind: 'quick' }],
    regressions: 0, regressionsFromClosed: 0, closedAt: null, _leakV2: true }]);
  m.appointments = (m.appointments || []).concat([
    { id: 'a1', title: 'Dentist cleaning', date: inDays(3), time: '10:00', createdAt: 1 },
    { id: 'a2', title: 'Dentist follow-up', date: inDays(5), time: '15:30', createdAt: 1 },
    { id: 'a3', title: 'Team standup sync', date: inDays(2), time: '09:00', createdAt: 1 },
    { id: 'a4', title: 'Gym leg day', date: inDays(2), time: '07:00', createdAt: 1 },
  ]);
  m.meetings = (m.meetings || []).concat([{ id: 'mfix', name: 'Team standup', points: [], notes: '', createdAt: 1, nextMeeting: inDays(2), apptId: 'a3', blockId: null }]);
  if (!m.training) m.training = {};
  if (!m.training.days) m.training.days = {};
  m.training.days['2099-01-01'] = { sessions: [{ id: 'wsfix', apptId: 'a4', date: inDays(2), time: '07:00', done: false }] };
}
const seed = () => H.seed(fixtures);

test.before(async () => {
  console.log(`# seeding from ${H.loadDoc().real ? 'a COPY of the real document' : 'the synthetic fixture'}`);
  await H.ensureUsers();
  await seed();
  srv = await H.startServer();
  token = (await H.oauthConnect(srv.base)).tokens.access_token;
});
test.after(async () => { if (srv) await srv.close(); });

test('every new tool carries a description that says when to use it, and correct hints', async () => {
  const tools = Object.fromEntries((await H.rpc(srv.base, token, 'tools/list', {})).json.result.tools.map(t => [t.name, t]));
  for (const n of ['update_followup', 'resolve_followup', 'set_priority', 'edit_task', 'delete_task', 'move_task_to_project',
    'create_project', 'add_completed_task', 'edit_appointment', 'cancel_appointment']) {
    assert.ok(tools[n] && /^Use /.test(tools[n].description), n + ' description starts with "Use"');
  }
  assert.equal(tools.delete_task.annotations.destructiveHint, true);
  assert.equal(tools.cancel_appointment.annotations.destructiveHint, true);
  assert.equal(tools.set_priority.annotations.destructiveHint, false);
});

/* ================= update_followup ================= */
test('update_followup: touched today (age resets in the app), note appended, count 0, only followups', async () => {
  const before = await seed();
  const r = await call('update_followup', { followup: 'invoice', note: 'they said Friday' });
  assert.equal(r.text, 'Marked "Chase Acme invoice" as followed up today, with your note.');
  const after = await H.read();
  assert.equal(count(after), count(before));
  assert.deepEqual(paths(before, after), ['followups']);
  const f = fu(after, 'fua');
  assert.ok(f.lastTouched > Date.now() - 60000, 'lastTouched is now');
  assert.equal(f.createdAt, fu(before, 'fua').createdAt, 'createdAt untouched');
  assert.equal(f.note, 'sent twice · they said Friday', 'existing note kept');
  const app = H.device(); app.load(after.marcomaster);
  assert.equal(app.run("followupAge(S.followups.find(f=>f.id==='fua'))"), 'today');
  // by id, without a note: note untouched
  await call('update_followup', { followup: 'fuc' });
  assert.equal(fu(await H.read(), 'fuc').note, '');
});
test('update_followup: ambiguous lists ids, unknown says so — neither writes', async () => {
  const before = await seed();
  const amb = await call('update_followup', { followup: 'chase acme' });
  assert.match(amb.text, /Several open follow-ups match/); assert.match(amb.text, /\[id: fua\]/); assert.match(amb.text, /\[id: fub\]/);
  assert.match((await call('update_followup', { followup: 'zzz nothing' })).text, /No open follow-up matches/);
  await noWrite(before);
});

/* ================= resolve_followup ================= */
test('resolve_followup: leaves the open list in the app and in list_followups', async () => {
  const before = await seed();
  assert.equal((await call('resolve_followup', { followup: 'landlord' })).text, 'Resolved "Call landlord about lease".');
  const after = await H.read();
  assert.equal(fu(after, 'fuc').resolved, true);
  assert.deepEqual(paths(before, after), ['followups']);
  const app = H.device(); app.load(after.marcomaster);
  assert.equal(app.run('openFollowupCount()'), app.run('S.followups.filter(f=>!f.resolved).length'));
  assert.doesNotMatch(app.run('renderFollowups()').split('Resolved')[0], /Call landlord about lease/);
  assert.doesNotMatch((await call('list_followups', {})).text, /Call landlord/);
  assert.match((await call('resolve_followup', { followup: 'landlord' })).text, /No open follow-up matches/, 'already resolved → not open');
});
test('resolve_followup: ambiguous and not-found write nothing', async () => {
  const before = await seed();
  assert.match((await call('resolve_followup', { followup: 'acme' })).text, /\[id: fua\][\s\S]*\[id: fub\]/);
  assert.match((await call('resolve_followup', { followup: 'qqq' })).text, /No open follow-up/);
  await noWrite(before);
});

/* ================= set_priority ================= */
test('set_priority: day, project (linked block follows, like atPriority) and leak tasks', async () => {
  const before = await seed();
  assert.equal((await call('set_priority', { task: 'printer ink', priority: true })).text, 'Flagged "Buy printer ink" 🔥.');
  await call('set_priority', { task: 'homepage copy', priority: true });
  await call('set_priority', { task: 'L|lfix|ltfix', priority: true });
  const after = await H.read();
  assert.equal(count(after), count(before));
  assert.equal(taskById(after, 'is3').priority, true);
  assert.equal(proj(after, 'pw').tasks.find(t => t.id === 'pt2').priority, true);
  assert.equal(taskById(after, 'ib1').priority, true, 'linked calendar block follows');
  assert.equal(after.marcomaster.leaks.find(l => l.id === 'lfix').tasks[0].priority, true);
  const app = H.device(); app.load(after.marcomaster);
  assert.ok(app.rows().find(r => r.key === 'S|is3').priority);
  const v = after.marcomaster.updatedAt;
  assert.match((await call('set_priority', { task: 'printer ink', priority: true })).text, /already flagged/);
  assert.equal((await H.read()).marcomaster.updatedAt, v);
  assert.equal((await call('set_priority', { task: 'S|is3', priority: false })).text, 'Cleared the 🔥 flag on "Buy printer ink".');
});
test('set_priority: ambiguous / not found write nothing', async () => {
  const before = await seed();
  assert.match((await call('set_priority', { task: 'email sam', priority: true })).text, /Several open tasks match[\s\S]*S\|is1[\s\S]*S\|is2/);
  assert.match((await call('set_priority', { task: 'nonexistent thing', priority: true })).text, /No open task matches/);
  await noWrite(before);
});

/* ================= edit_task ================= */
test('edit_task: title (project task renames its block, like atEdit), due set/clear', async () => {
  const before = await seed();
  assert.equal((await call('edit_task', { task: 'homepage copy', title: 'Write landing copy' })).text, 'Updated "Write homepage copy": renamed to "Write landing copy".');
  let after = await H.read();
  assert.equal(proj(after, 'pw').tasks.find(t => t.id === 'pt2').txt, 'Write landing copy');
  assert.equal(taskById(after, 'ib1').txt, 'Write landing copy', 'linked block renamed');
  assert.equal(count(after), count(before));
  await call('edit_task', { task: 'S|is1', due_date: inDays(2) });
  assert.equal(taskById(await H.read(), 'is1').dueDate, inDays(2));
  await call('edit_task', { task: 'S|is1', due_date: null });
  assert.ok(!('dueDate' in taskById(await H.read(), 'is1')));
});
test('edit_task: kind and minutes follow the app\'s shapes; scheduled blocks, recurring and leak tasks are refused', async () => {
  const before = await seed();
  assert.match((await call('edit_task', { task: 'printer ink', kind: 'block', minutes: 30 })).text, /now a time block, 30 minutes/);
  let t = taskById(await H.read(), 'is3');
  assert.deepEqual([t.kind, t.mins, t.schedDate, t.start], ['project', 30, null, null]);
  const app = H.device(); app.load((await H.read()).marcomaster);
  app.ctx.__r = app.rows().find(r => r.key === 'S|is3');
  assert.match(app.run('renderTaskRow(__r)'), /To schedule/, 'shows as an unscheduled time block');
  await call('edit_task', { task: 'proposal', minutes: 45 });
  assert.equal(taskById(await H.read(), 'is4').mins, 45);
  await call('edit_task', { task: 'proposal', kind: 'quick' });
  t = taskById(await H.read(), 'is4');
  assert.deepEqual([t.kind, t.mins], ['quick', 2], 'quick = addTask\'s quick shape');
  await call('edit_task', { task: 'hero banner', kind: 'block' });
  assert.deepEqual(proj(await H.read(), 'pw').tasks.find(x => x.id === 'pt1').mins, 60, 'project block gets the default 60');
  const v = (await H.read()).marcomaster.updatedAt;
  assert.match((await call('edit_task', { task: 'deep work', kind: 'quick' })).text, /time block on the calendar/);
  assert.match((await call('edit_task', { task: 'homepage copy', kind: 'quick' })).text, /time block on the calendar/);
  assert.match((await call('edit_task', { task: 'supplements', kind: 'block' })).text, /recurring task/);
  assert.match((await call('edit_task', { task: 'newsletters', minutes: 10 })).text, /leak task/);
  assert.match((await call('edit_task', { task: 'email sam about invoice', minutes: 10 })).text, /Quick tasks are ≤2 minutes/);
  assert.match((await call('edit_task', { task: 'email sam about invoice', title: 'Email Sam about invoice' })).text, /nothing changed/);
  assert.equal((await H.read()).marcomaster.updatedAt, v);
  void before;
});
test('edit_task: ambiguous / not found / nothing to change / bad date', async () => {
  const before = await seed();
  assert.match((await call('edit_task', { task: 'email sam', title: 'x' })).text, /Several open tasks match/);
  assert.match((await call('edit_task', { task: 'nope nope', title: 'x' })).text, /No open task matches/);
  assert.ok((await call('edit_task', { task: 'printer ink' })).isError);
  assert.ok((await call('edit_task', { task: 'printer ink', due_date: 'friday' })).isError);
  await noWrite(before);
});

/* ================= delete_task ================= */
test('delete_task: needs confirm; then removes exactly what the app\'s own atDelete removes', async () => {
  const before = await seed();
  const ask = await call('delete_task', { task: 'homepage copy' });
  assert.match(ask.text, /would permanently delete "Write homepage copy" and its 1 calendar block, its pipeline slot\. Nothing was deleted/);
  await noWrite(before);
  assert.equal((await call('delete_task', { task: 'homepage copy', confirm: true })).text, 'Deleted "Write homepage copy" and its 1 calendar block, its pipeline slot.');
  const after = await H.read();
  assert.equal(count(after), count(before) - 3, 'task + block + pipeline item');
  // parity: the app's atDelete on the same starting state lands on the same state
  const app = H.device(); app.load(before.marcomaster);
  app.run("atDelete('P|pw|pt2')");
  // compare everything a delete can touch — every day's tasks and pipeline, and the
  // projects. (The rest is compared by `paths` below; seedDefaults gives freshly seeded
  // defaults random ids on every load, so whole-state equality would test the seeding.)
  const touchable = (S) => ({ projects: S.projects, days: Object.fromEntries(Object.entries(S.days).map(([k, d]) => [k, { tasks: d.tasks, pipeline: d.pipeline }])) });
  const viaVoice = H.device(); viaVoice.load(after.marcomaster);
  assert.ok(isDeepStrictEqual(touchable(viaVoice.S), touchable(app.S)), 'same result as the app\'s own delete');
  assert.deepEqual(paths(before, after), ['days.' + today() + '.pipeline', 'days.' + today() + '.tasks', 'projects']);
  // a day task with a pipeline slot
  await call('delete_task', { task: 'printer ink', confirm: true });
  const a2 = await H.read();
  assert.ok(!taskById(a2, 'is3')); assert.ok(!a2.marcomaster.days[today()].pipeline.some(it => it.taskId === 'is3'));
  assert.equal(count(a2), count(before) - 5);
});
test('delete_task: recurring and leak tasks refused; ambiguous and not-found write nothing', async () => {
  const before = await seed();
  assert.match((await call('delete_task', { task: 'supplements', confirm: true })).text, /recurring task — remove it in the app/);
  assert.match((await call('delete_task', { task: 'newsletters', confirm: true })).text, /leak task/);
  assert.match((await call('delete_task', { task: 'email sam', confirm: true })).text, /Several open tasks match/);
  assert.match((await call('delete_task', { task: 'zzz', confirm: true })).text, /No open task matches/);
  await noWrite(before);
});
test('a delete whose planned size disagrees with what it removes is blocked by the guard', async () => {
  const before = await seed();
  await assert.rejects(runOp(H.db, H.UID, T.torontoNow(), () => ({ op: { type: 'del', key: 'P|pw|pt2', n: 1 } })), GuardError);
  await assert.rejects(runOp(H.db, H.UID, T.torontoNow(), () => ({ op: { type: 'del', key: 'S|is1', n: 999 } })), /must remove 1–25/);
  await noWrite(before);
});

/* ================= move_task_to_project ================= */
test('move_task_to_project: same id, keeps 🔥/due/kind, pipeline slot re-points, count 0', async () => {
  const before = await seed();
  await call('set_priority', { task: 'printer ink', priority: true });
  const r = await call('move_task_to_project', { task: 'printer ink', project: 'redesign' });
  assert.equal(r.text, 'Moved "Buy printer ink" into Website redesign.');
  const after = await H.read();
  assert.equal(count(after), count(before));
  assert.ok(!taskById(after, 'is3'), 'gone from the day');
  const pt = proj(after, 'pw2').tasks.find(t => t.id === 'is3');
  assert.deepEqual(pt, { id: 'is3', txt: 'Buy printer ink', done: false, priority: true, kind: 'quick', dueDate: inDays(4) });
  const slot = after.marcomaster.days[today()].pipeline.find(it => it.id === 'pp2');
  assert.deepEqual([slot.projectId, slot.projTaskId, slot.taskId], ['pw2', 'is3', undefined]);
  const app = H.device(); app.load(after.marcomaster);
  const row = app.rows().find(x => x.key === 'P|pw2|is3');
  assert.ok(row && row.projName === 'Website redesign' && row.priority && row.dueDate === inDays(4), 'in All Tasks under the project');
  assert.equal(app.run("pipelineDone(day().pipeline.find(x=>x.id==='pp2'))"), false);
  // a block keeps its minutes
  await call('move_task_to_project', { task: 'proposal', project: 'pw' });
  assert.equal(proj(await H.read(), 'pw').tasks.find(t => t.id === 'is4').mins, 60);
});
test('move_task_to_project: refusals, ambiguous project, unknown project — nothing written', async () => {
  const before = await seed();
  assert.match((await call('move_task_to_project', { task: 'deep work', project: 'pw' })).text, /time block on the calendar/);
  assert.match((await call('move_task_to_project', { task: 'supplements', project: 'pw' })).text, /recurring task/);
  assert.match((await call('move_task_to_project', { task: 'hero banner', project: 'pw2' })).text, /already belongs to Website/);
  assert.match((await call('move_task_to_project', { task: 'printer ink', project: 'web' })).text, /Several projects match[\s\S]*\[id: pw\][\s\S]*\[id: pw2\]/);
  assert.match((await call('move_task_to_project', { task: 'printer ink', project: 'qqq' })).text, /No active project matches "qqq"\. Projects: .*Website redesign/);
  assert.match((await call('move_task_to_project', { task: 'email sam', project: 'pw' })).text, /Several open tasks match/);
  await noWrite(before);
});

/* ================= create_project ================= */
test('create_project: createProject\'s exact record and colour; duplicates refused', async () => {
  const before = await seed();
  assert.equal((await call('create_project', { name: 'Garden shed' })).text, 'Created project "Garden shed".');
  const after = await H.read();
  assert.equal(count(after), count(before) + 1);
  assert.deepEqual(paths(before, after), ['projects']);
  const mine = after.marcomaster.projects.find(p => p.name === 'Garden shed');
  const app = H.device(); app.load(before.marcomaster);
  const probe = app.run("createProject('probe')");
  assert.deepEqual(Object.keys(mine), Object.keys(probe));
  assert.equal(mine.color, probe.color, 'same palette position');
  const v = after.marcomaster.updatedAt;
  assert.match((await call('create_project', { name: 'garden SHED' })).text, /already have a project called "Garden shed"/);
  assert.equal((await H.read()).marcomaster.updatedAt, v);
});

/* ================= add_completed_task ================= */
test('add_completed_task: Capture\'s "already done" shape, lands in Completed Today with the time', async () => {
  const before = await seed();
  const r = await call('add_completed_task', { title: 'Paid the hydro bill' });
  assert.match(r.text, /^Logged "Paid the hydro bill" as done at \d{1,2}:\d{2}(am|pm)\.$/);
  const after = await H.read();
  assert.equal(count(after), count(before) + 1);
  const mine = tasksOf(after).find(t => t.txt === 'Paid the hydro bill');
  const app = H.device(); app.load(before.marcomaster);
  app.run("markTaskDoneNow(addTask('probe','quick',2))");
  const probe = app.run('day().tasks').find(t => t.txt === 'probe');
  assert.deepEqual(Object.keys(mine).sort(), Object.keys(probe).sort());
  assert.equal(mine.done, true); assert.match(mine.doneAt, /^\d{2}:\d{2}$/);
  const app2 = H.device(); app2.load(after.marcomaster);
  const row = app2.completedToday().find(x => x.txt === 'Paid the hydro bill');
  assert.ok(row && row.time === mine.doneAt);
  assert.ok(!app2.rows().some(x => x.txt === 'Paid the hydro bill' && !x.done), 'never in the open list');
});

/* ================= edit_appointment ================= */
test('edit_appointment: reschedule and rename; shows in the app; past and linked refused', async () => {
  const before = await seed();
  const r = await call('edit_appointment', { appointment: 'cleaning', date: inDays(1), time: '16:15' });
  assert.match(r.text, /^Updated: "Dentist cleaning" is .* at 4:15pm\.$/);
  let after = await H.read();
  assert.deepEqual([appt(after, 'a1').date, appt(after, 'a1').time], [inDays(1), '16:15']);
  assert.deepEqual(paths(before, after), ['appointments']);
  const app = H.device(); app.load(after.marcomaster);
  assert.match(app.run('renderTodayStrip()'), /Dentist cleaning/);
  await call('edit_appointment', { appointment: 'a1', title: 'Dentist — cleaning' });
  assert.equal(appt(await H.read(), 'a1').title, 'Dentist — cleaning');
  const v = (await H.read()).marcomaster.updatedAt;
  const past = DateTime.now().setZone(T.TZ).minus({ hours: 2 });
  assert.match((await call('edit_appointment', { appointment: 'a2', date: past.toFormat('yyyy-LL-dd'), time: past.toFormat('HH:mm') })).text, /in the past/);
  assert.match((await call('edit_appointment', { appointment: 'standup', time: '10:00' })).text, /belongs to a meeting or training session/);
  assert.match((await call('edit_appointment', { appointment: 'gym', time: '08:00' })).text, /belongs to a meeting or training session/);
  assert.ok((await call('edit_appointment', { appointment: 'a2', time: '7pm' })).isError);
  assert.equal((await H.read()).marcomaster.updatedAt, v);
});
test('edit_appointment: ambiguous lists date/time/ids; not found', async () => {
  const before = await seed();
  assert.match((await call('edit_appointment', { appointment: 'dentist', time: '11:00' })).text, /Several appointments match[\s\S]*\[id: a1\][\s\S]*\[id: a2\]/);
  assert.match((await call('edit_appointment', { appointment: 'opera', time: '11:00' })).text, /No upcoming appointment matches/);
  await noWrite(before);
});

/* ================= cancel_appointment ================= */
test('cancel_appointment without confirm only describes which appointment it would cancel', async () => {
  const before = await seed();
  const r = await call('cancel_appointment', { appointment: 'follow-up' });
  assert.match(r.text, /^This would cancel "Dentist follow-up" \(.* 3:30pm\)\. Nothing was cancelled — call again with confirm: true to go ahead\.$/);
  assert.match((await call('cancel_appointment', { appointment: 'follow-up', confirm: false })).text, /^This would cancel/);
  await noWrite(before);
  const tools = Object.fromEntries((await H.rpc(srv.base, token, 'tools/list', {})).json.result.tools.map(t => [t.name, t]));
  assert.ok(tools.cancel_appointment.inputSchema.properties.confirm, 'confirm is in the schema');
  assert.match(tools.cancel_appointment.description, /confirm: true/);
});
test('cancel_appointment: removed (-1, only appointments); linked ones refused; ambiguous / not found', async () => {
  const before = await seed();
  assert.match((await call('cancel_appointment', { appointment: 'dentist', confirm: true })).text, /Several appointments match/);
  assert.match((await call('cancel_appointment', { appointment: 'opera', confirm: true })).text, /No upcoming appointment matches/);
  assert.match((await call('cancel_appointment', { appointment: 'standup', confirm: true })).text, /belongs to a meeting or training session/);
  await noWrite(before);
  assert.match((await call('cancel_appointment', { appointment: 'follow-up', confirm: true })).text, /^Cancelled "Dentist follow-up"/);
  const after = await H.read();
  assert.ok(!appt(after, 'a2'));
  assert.equal(count(after), count(before) - 1);
  assert.deepEqual(paths(before, after), ['appointments']);
  // same result as the app's own deleteAppointment on an unlinked appointment
  const app = H.device(); app.load(before.marcomaster); app.run("deleteAppointment('a2')");
  assert.deepEqual(app.S.appointments.map(a => a.id), after.marcomaster.appointments.map(a => a.id));
});

/* ================= concurrency ================= */
test('simultaneous mixed management writes all land; a double delete deletes once', async () => {
  const before = await seed();
  const res = await Promise.all([
    call('set_priority', { task: 'S|is1', priority: true }),
    call('edit_task', { task: 'S|is2', title: 'Email Sam re: the contract' }),
    call('update_followup', { followup: 'fua' }), call('update_followup', { followup: 'fub' }), call('resolve_followup', { followup: 'fuc' }),
    call('create_project', { name: 'Parallel A' }), call('create_project', { name: 'Parallel B' }),
    call('edit_appointment', { appointment: 'a1', time: '11:45' }),
    call('delete_task', { task: 'S|is4', confirm: true }), call('delete_task', { task: 'S|is4', confirm: true }),
    call('add_completed_task', { title: 'Parallel done thing' }),
  ]);
  const after = await H.read();
  assert.equal(taskById(after, 'is1').priority, true);
  assert.equal(taskById(after, 'is2').txt, 'Email Sam re: the contract');
  assert.ok(fu(after, 'fua').lastTouched > Date.now() - 60000 && fu(after, 'fub').lastTouched > Date.now() - 60000);
  assert.equal(fu(after, 'fuc').resolved, true);
  assert.equal(after.marcomaster.projects.filter(p => /^Parallel [AB]$/.test(p.name)).length, 2);
  assert.equal(appt(after, 'a1').time, '11:45');
  assert.ok(!taskById(after, 'is4'));
  assert.equal(res.filter(r => /^Deleted/.test(r.text)).length, 1, 'exactly one delete happened');
  assert.equal(res.filter(r => /No open task matches/.test(r.text)).length, 1, 'the other found nothing');
  assert.equal(count(after), count(before) + 2 /*projects*/ + 1 /*done task*/ - 1 /*deleted*/);
});

/* ================= the race (real subscribeCloud) ================= */
test('THE RACE: edit, delete, move, resolve and cancel overwritten by a device save are all replayed', async () => {
  const s0 = await seed();
  const phone = H.device(); phone.load(s0.marcomaster);
  await call('edit_task', { task: 'S|is1', title: 'Email Sam about the invoice' });
  await call('delete_task', { task: 'S|is2', confirm: true });
  await call('move_task_to_project', { task: 'S|is3', project: 'pw' });
  await call('resolve_followup', { followup: 'fuc' });
  await call('cancel_appointment', { appointment: 'a2', confirm: true });
  phone.run("addTask('Phone edit','quick',2)");
  await phone.push();                                               // blind merge-set over all five
  let doc = await H.read();
  assert.equal(taskById(doc, 'is1').txt, 'Email Sam about invoice', 'clobbered');
  assert.ok(taskById(doc, 'is2') && appt(doc, 'a2'), 'deletions undone by the clobber');
  const laptop = H.device(); laptop.load(s0.marcomaster);
  laptop.subscribe()(doc);
  const S = laptop.S, all = Object.values(S.days).flatMap(d => d.tasks || []);
  assert.equal(all.find(t => t.id === 'is1').txt, 'Email Sam about the invoice');
  assert.ok(!all.some(t => t.id === 'is2'), 'delete replayed');
  assert.ok(!all.some(t => t.id === 'is3') && S.projects.find(p => p.id === 'pw').tasks.some(t => t.id === 'is3'), 'move replayed');
  assert.equal(S.followups.find(f => f.id === 'fuc').resolved, true);
  assert.ok(!S.appointments.some(a => a.id === 'a2'), 'cancel replayed');
  assert.ok(all.some(t => t.txt === 'Phone edit'), 'phone edit kept');
  assert.ok(laptop.persisted().some(o => o.bump === true));
  await laptop.push();
  doc = await H.read();
  const again = H.device(); again.load(doc.marcomaster);
  assert.equal(again.replay(doc.extOps), false, 'nothing left to replay');
});
test('THE RACE, conflict: a device that edited the same field later keeps its edit (compare-and-set)', async () => {
  const s0 = await seed();
  const phone = H.device(); phone.load(s0.marcomaster);
  await call('edit_task', { task: 'S|is1', title: 'Voice title' });
  await call('edit_appointment', { appointment: 'a1', time: '12:00' });
  phone.run("day().tasks.find(t=>t.id==='is1').txt='Phone title';");   // the phone renamed it too, on stale state
  phone.run("S.appointments.find(a=>a.id==='a1').time='13:30';");
  await phone.push();
  const deliver = phone.subscribe();
  deliver(await H.read());                                          // phone's own snapshot → replay
  assert.equal(phone.run("day().tasks.find(t=>t.id==='is1').txt"), 'Phone title', 'the later local edit wins');
  assert.equal(phone.S.appointments.find(a => a.id === 'a1').time, '13:30');
  // a field the phone did NOT touch still gets the voice edit
  await H.seed(fixtures);
  const p2 = H.device(); p2.load((await H.read()).marcomaster);
  await call('set_priority', { task: 'S|is1', priority: true });
  p2.run("day().tasks.find(t=>t.id==='is1').txt='Phone retitle';");
  await p2.push();
  p2.subscribe()(await H.read());
  const t = p2.run("day().tasks.find(t=>t.id==='is1')");
  assert.deepEqual([t.txt, t.priority], ['Phone retitle', true]);
});
