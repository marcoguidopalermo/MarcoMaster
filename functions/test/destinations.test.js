/* The three new destinations: appointments, meeting talking points, the pipeline. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');
const { isDeepStrictEqual } = require('util');
const { DateTime } = require('luxon');
const H = require('./harness');
const core = require('../shared/state-core.js');
const { runOp } = require('../mcp/store');
const T = require('../mcp/tasks');

let srv, token;
const call = (name, args) => H.callTool(srv.base, token, name, args);
const today = () => T.torontoNow().dayKey;
const count = (doc) => core.stateCount(doc.marcomaster);
const later = (mins) => DateTime.now().setZone(T.TZ).plus({ minutes: mins });
const inDays = (n) => DateTime.now().setZone(T.TZ).plus({ days: n }).toFormat('yyyy-LL-dd');

/* fixtures added to the copy: two meetings that share a word, a leak with a task,
   and TODAY's record present + already rolled over (pipeline as given) */
const ZED_A = 'mzedalpha', ZED_B = 'mzedbeta';
function withFixtures(pipeline = [], { noToday = false, prevPipeline = null } = {}){
  return (m) => {
    m.meetings = (m.meetings || []).concat([
      { id: ZED_A, name: 'Zed Alpha', points: [], notes: '', createdAt: 1, nextMeeting: null, apptId: null, blockId: null },
      { id: ZED_B, name: 'Zed Beta', points: [], notes: '', createdAt: 1, nextMeeting: null, apptId: null, blockId: null },
    ]);
    m.leaks = (m.leaks || []).concat([{ id: 'lfix', text: 'Inbox creep', occurrences: [1], createdAt: 1, lastSeenAt: 1, status: 'open', notes: '',
      tasks: [{ id: 'ltfix', txt: 'Unsubscribe from newsletters', done: false, doneAt: null, priority: false, kind: 'quick' }],
      regressions: 0, regressionsFromClosed: 0, closedAt: null, _leakV2: true }]);
    const tk = today();
    if (!m.days) m.days = {};
    const prevKey = Object.keys(m.days).filter(k => k < tk).sort().pop() || '2000-01-01';
    if (!m.days[prevKey]) m.days[prevKey] = core.blankDay();
    m.days[prevKey].tasks = (m.days[prevKey].tasks || []).concat([
      { id: 'iprevfix', txt: 'Draft the quarterly letter', kind: 'quick', done: false, priority: false, mins: 2, start: null, schedDate: null }]);
    if (prevPipeline) m.days[prevKey].pipeline = prevPipeline;
    if (noToday) { delete m.days[tk]; return; }
    if (!m.days[tk]) m.days[tk] = core.blankDay();
    m.days[tk]._seeded = true;
    m.days[tk].tasks = (m.days[tk].tasks || []).concat([
      { id: 'itodayfix', txt: 'Reconcile the expense report', kind: 'quick', done: false, priority: false, mins: 2, start: null, schedDate: null }]);
    m.days[tk].pipeline = pipeline;
  };
}
const pipeOf = (doc) => ((doc.marcomaster.days || {})[today()] || {}).pipeline || [];
const pitem = (txt, done = false) => ({ id: 'pf' + txt.replace(/\W/g, ''), txt, done });

test.before(async () => {
  console.log(`# seeding from ${H.loadDoc().real ? 'a COPY of the real document' : 'the synthetic fixture'}`);
  await H.ensureUsers();
  await H.seed(withFixtures());
  srv = await H.startServer();
  const c = await H.oauthConnect(srv.base);
  token = c.tokens.access_token;
});
test.after(async () => { if (srv) await srv.close(); });

test('tools/list now has 8 tools', async () => {
  const list = await H.rpc(srv.base, token, 'tools/list', {});
  assert.deepEqual(list.json.result.tools.map(t => t.name).sort(),
    ['add_appointment', 'add_meeting_point', 'add_task', 'add_to_pipeline', 'complete_task', 'list_appointments', 'list_tasks', 'set_due_date']);
});

/* ================= appointments ================= */
test('add_appointment: createAppointment\'s exact record, +1, only appointments touched, in the Today strip', async () => {
  const before = await H.seed(withFixtures());
  const date = inDays(2);
  const r = await call('add_appointment', { title: 'Dentist', date, time: '14:30' });
  assert.match(r.text, /Booked "Dentist" for .* at 2:30pm/);
  const after = await H.read();
  assert.equal(count(after), count(before) + 1);
  const voice = after.marcomaster.appointments.find(a => a.title === 'Dentist' && a.date === date);
  const d = H.device(); d.load(before.marcomaster);
  const probe = d.run(`createAppointment('probe','${date}','14:30')`);
  assert.deepEqual(Object.keys(voice), Object.keys(probe), 'same fields, same order');
  Object.keys(probe).forEach(k => assert.equal(typeof voice[k], typeof probe[k], k));
  const changed = require('../mcp/store').changedPaths(before.marcomaster, after.marcomaster).map(p => p.join('.'));
  assert.deepEqual(changed.filter(p => p !== 'updatedAt' && p !== 'extApplied'), ['appointments']);
  const app = H.device(); app.load(after.marcomaster);
  assert.match(app.run('renderTodayStrip()'), /Dentist/);
  assert.match((await call('list_appointments', {})).text, /2:30pm — Dentist/);
});
test('add_appointment refuses past, invalid and impossible times — and writes nothing', async () => {
  const before = await H.seed(withFixtures());
  const past = later(-30);
  for (const [args, re] of [
    [{ title: 'x', date: past.toFormat('yyyy-LL-dd'), time: past.toFormat('HH:mm') }, /in the past/],
    [{ title: 'x', date: '2026-02-30', time: '10:00' }, /valid YYYY-MM-DD/],
    [{ title: 'x', date: inDays(3), time: '25:00' }, /valid 24-hour/],
    [{ title: 'x', date: inDays(3), time: '9:00' }, /valid 24-hour/],
  ]) {
    const r = await call('add_appointment', args);
    assert.ok(r.isError); assert.match(r.text, re);
  }
  assert.ok(isDeepStrictEqual(await H.read(), before));
});
test('the real reminder function picks up a voice appointment exactly like an app one', async () => {
  const base = await H.seed(m => { withFixtures()(m); m.notifSettings = { ...(m.notifSettings || {}), master: true, appt: { ...((m.notifSettings || {}).appt || {}), enabled: true, minutesBefore: 30 } }; });
  await H.db.collection('sentReminders').doc(H.UID).delete();
  const at = later(20);
  const date = at.toFormat('yyyy-LL-dd'), time = at.toFormat('HH:mm');
  await call('add_appointment', { title: 'Voice-booked call', date, time });
  // and one made by the app's own createAppointment, pushed the way the app saves
  const doc = await H.read();
  const dev = H.device(); dev.load(doc.marcomaster);
  const appMade = dev.run(`createAppointment('App-booked call','${date}','${time}')`);
  await dev.push();
  const voice = (await H.read()).marcomaster.appointments.find(a => a.title === 'Voice-booked call');
  const out = execFileSync(process.execPath, [path.join(__dirname, 'run-reminders.js')], { env: process.env, encoding: 'utf8' });
  const sent = JSON.parse(out.split('\n').find(l => l.startsWith('SENT:')).slice(5));
  assert.ok(Object.keys(sent).some(k => k.startsWith(`lead|30|${appMade.id}|`)), 'app appointment reminded');
  assert.ok(Object.keys(sent).some(k => k.startsWith(`lead|30|${voice.id}|`)), 'voice appointment reminded');
  void base;
});

/* ================= meeting talking points ================= */
test('add_meeting_point: createMeetingPoint\'s exact point, count +0, only meetings touched', async () => {
  const before = await H.seed(withFixtures());
  const r = await call('add_meeting_point', { meeting: 'zed alpha', point: 'Ask about the Q3 numbers' });
  assert.match(r.text, /Added to Zed Alpha/);
  const after = await H.read();
  assert.equal(count(after), count(before), 'talking points are not counted');
  const changed = require('../mcp/store').changedPaths(before.marcomaster, after.marcomaster).map(p => p.join('.'));
  assert.deepEqual(changed.filter(p => p !== 'updatedAt' && p !== 'extApplied'), ['meetings']);
  const voice = after.marcomaster.meetings.find(m => m.id === ZED_A).points[0];
  const d = H.device(); d.load(before.marcomaster);
  d.run(`createMeetingPoint('${ZED_A}','probe')`);
  const probe = d.run(`S.meetings.find(m=>m.id==='${ZED_A}').points[0]`);
  assert.deepEqual(Object.keys(voice), Object.keys(probe));
  assert.equal(voice.done, false); assert.equal(voice.txt, 'Ask about the Q3 numbers');
  const app = H.device(); app.load(after.marcomaster);
  assert.equal(app.run(`mtgOpenPoints(S.meetings.find(m=>m.id==='${ZED_A}'))`), 1, 'the app counts it as an open point');
});
test('add_meeting_point on a real meeting from the document, by its first name', async (t) => {
  const doc = await H.seed(withFixtures());
  // a real meeting whose first word alone picks it out (how it would be spoken)
  const m = (doc.marcomaster.meetings || []).find(x => x.id !== ZED_A && x.id !== ZED_B && x.name &&
    (T.resolveMeeting(doc.marcomaster, x.name.split(' ')[0]).meeting || {}).id === x.id);
  if (!m) return t.skip('no real meeting with a uniquely matching first word');
  const r = await call('add_meeting_point', { meeting: m.name.split(' ')[0].toUpperCase(), point: 'Voice point' });
  assert.match(r.text, /^Added to/);
  const pts = (await H.read()).marcomaster.meetings.find(x => x.id === m.id).points;
  assert.equal(pts.filter(p => p.txt === 'Voice point').length, 1);
});
test('ambiguous or unknown meetings write nothing and list the candidates', async () => {
  const before = await H.seed(withFixtures());
  const amb = await call('add_meeting_point', { meeting: 'zed', point: 'x' });
  assert.match(amb.text, /Several meetings match/); assert.match(amb.text, /Zed Alpha/); assert.match(amb.text, /Zed Beta/);
  const none = await call('add_meeting_point', { meeting: 'qqqq nobody', point: 'x' });
  assert.match(none.text, /No meeting matches/); assert.match(none.text, /Zed Alpha/);
  assert.ok(isDeepStrictEqual(await H.read(), before));
});

/* ================= the pipeline ================= */
test('add_to_pipeline new_task: +2, a real quick task linked like materializePipelineItem, follows its task', async () => {
  const before = await H.seed(withFixtures());
  const r = await call('add_to_pipeline', { new_task: 'Ship the landing page' });
  assert.match(r.text, /1 of 3 slots taken/);
  const after = await H.read();
  assert.equal(count(after), count(before) + 2);
  const changed = require('../mcp/store').changedPaths(before.marcomaster, after.marcomaster).map(p => p.join('.')).filter(p => p !== 'updatedAt' && p !== 'extApplied');
  assert.deepEqual(changed.sort(), [`days.${today()}.pipeline`, `days.${today()}.tasks`]);
  const app = H.device(); app.load(after.marcomaster);
  assert.match(app.run('renderPipeline()'), /Ship the landing page/);
  const it = app.run('day().pipeline[0]');
  assert.ok(it.taskId && app.rows().some(x => x.key === 'S|' + it.taskId), 'a real task in All Tasks');
  assert.equal(app.run('pipelineDone(day().pipeline[0])'), false);
  await call('complete_task', { task: 'S|' + it.taskId });
  const app2 = H.device(); app2.load((await H.read()).marcomaster);
  assert.equal(app2.run('pipelineDone(day().pipeline[0])'), true, 'completing the task completes the slot');
});
test('add_to_pipeline promotes existing standalone, project and leak tasks (+1 each); a duplicate writes nothing', async () => {
  const before = await H.seed(withFixtures());
  await call('add_to_pipeline', { task: 'expense report' });
  const proj = T.taskRows(before.marcomaster, today()).find(r => r.source === 'project' && !r.done);
  if (proj) await call('add_to_pipeline', { task: proj.key });
  await call('add_to_pipeline', { task: 'L|lfix|ltfix' });
  const after = await H.read();
  const n = proj ? 3 : 2;
  assert.equal(count(after), count(before) + n);
  const app = H.device(); app.load(after.marcomaster);
  const keys = app.run('day().pipeline').map(core.pipelineLinkKey);
  assert.ok(keys.includes('S|itodayfix') && keys.includes('L|lfix|ltfix') && (!proj || keys.includes(proj.key)));
  // the app's own promote refuses a duplicate the same way
  const v = after.marcomaster.updatedAt;
  const dup = await call('add_to_pipeline', { task: 'L|lfix|ltfix' });
  assert.match(dup.text, proj ? /full/ : /already in the pipeline/);
  assert.equal((await H.read()).marcomaster.updatedAt, v);
});
test('a full pipeline — even of done items — writes nothing and says what is there', async () => {
  const before = await H.seed(withFixtures([pitem('Alpha focus', true), pitem('Beta focus', true), pitem('Gamma focus')]));
  const r = await call('add_to_pipeline', { new_task: 'Should not land' });
  assert.match(r.text, /full/); assert.match(r.text, /Alpha focus \(done\)/); assert.match(r.text, /Gamma focus/);
  assert.match((await call('add_to_pipeline', { task: 'expense report' })).text, /full/);
  assert.match((await call('list_tasks', { filter: 'pipeline' })).text, /3\. Gamma focus/);
  assert.ok(isDeepStrictEqual(await H.read(), before));
});
test('ambiguous task reference writes nothing', async () => {
  const before = await H.seed(withFixtures());
  await call('add_task', { title: 'Plan Lisbon trip' });
  await call('add_task', { title: 'Plan Lisbon budget' });
  const v = (await H.read()).marcomaster.updatedAt;
  assert.match((await call('add_to_pipeline', { task: 'plan lisbon' })).text, /Several open tasks match/);
  assert.equal((await H.read()).marcomaster.updatedAt, v);
  void before;
});
test('before today\'s rollover: pending carry-overs count toward the 3, and the day never opens with 4+', async () => {
  // yesterday: 2 unfinished + 1 done; no today record yet
  const carry = [pitem('Carry one'), pitem('Carry two'), pitem('Done yesterday', true)];
  await H.seed(withFixtures([], { noToday: true, prevPipeline: carry }));
  assert.match((await call('list_tasks', { filter: 'pipeline' })).text, /Carry one \(rolling over from yesterday\)/);
  const r = await call('add_to_pipeline', { new_task: 'Voice focus' });
  assert.match(r.text, /3 of 3/);
  assert.match((await call('add_to_pipeline', { new_task: 'One too many' })).text, /full/);
  const doc = await H.read();
  assert.equal(pipeOf(doc).length, 1, 'only the voice item is written; carry-overs are left to the app');
  const app = H.device(); app.load(doc.marcomaster);              // load → day() → rollover bridge
  const txts = app.run('day().pipeline').map(x => x.txt);
  assert.equal(txts.length, 3);
  assert.deepEqual(txts.slice().sort(), ['Carry one', 'Carry two', 'Voice focus']);
  // promoting a not-yet-carried task by voice moves it into today first
  await H.seed(withFixtures([], { noToday: true }));
  await call('add_to_pipeline', { task: 'quarterly letter' });
  const app2 = H.device(); app2.load((await H.read()).marcomaster);
  assert.equal(app2.run("pipelineDone(day().pipeline.find(x=>x.taskId==='iprevfix'))"), false);
  assert.ok(app2.run('day().tasks').some(t => t.id === 'iprevfix'), 'task now lives in today');
  assert.equal(app2.run('day().tasks').filter(t => t.id === 'iprevfix').length, 1);
});

/* ================= concurrency + the race ================= */
test('12 simultaneous mixed writes: every appointment and point lands, the pipeline stops at exactly 3', async () => {
  const before = await H.seed(withFixtures());
  const results = await Promise.all([
    ...[1, 2, 3, 4].map(i => call('add_appointment', { title: 'Parallel appt ' + i, date: inDays(5), time: `1${i}:00` })),
    ...[1, 2, 3].map(i => call('add_meeting_point', { meeting: 'zed beta', point: 'Parallel point ' + i })),
    ...[1, 2, 3, 4, 5].map(i => call('add_to_pipeline', { new_task: 'Parallel focus ' + i })),
  ]);
  const after = await H.read();
  assert.equal(after.marcomaster.appointments.filter(a => a.title.startsWith('Parallel appt')).length, 4);
  assert.equal(after.marcomaster.meetings.find(m => m.id === ZED_B).points.length, 3);
  assert.equal(pipeOf(after).length, 3, 'never more than 3');
  assert.equal(results.filter(r => /full/.test(r.text)).length, 2, 'the other 2 were told, not written');
  assert.equal(count(after), count(before) + 4 + 3 * 2);
});
test('a device write landing mid-transaction is not lost (appointment op)', async () => {
  const before = await H.seed(withFixtures());
  const dev = H.device(); dev.load(before.marcomaster);
  dev.run(`createMeetingPoint('${ZED_A}','Typed on the phone')`);
  let fired = false;
  const res = await runOp(H.db, H.UID, T.torontoNow(), () => ({ op: { type: 'appt', appt: { id: 'iapptmid', title: 'Said to Claude', date: inDays(4), time: '09:00', createdAt: Date.now() } }, reply: 'ok' }), {
    afterRead: async () => { if (fired) return; fired = true; dev.push().catch(() => {}); await new Promise(r => setTimeout(r, 400)); },
  });
  assert.ok(res.wrote);
  await new Promise(r => setTimeout(r, 300));
  let doc = await H.read();
  assert.ok(doc.marcomaster.meetings.find(m => m.id === ZED_A).points.some(p => p.txt === 'Typed on the phone'), 'device edit survived');
  if (!doc.marcomaster.appointments.some(a => a.id === 'iapptmid')) { dev.replay(doc.extOps); await dev.push(); doc = await H.read(); }
  assert.equal(doc.marcomaster.appointments.filter(a => a.id === 'iapptmid').length, 1, 'voice appointment survived');
});
test('THE RACE, all three types, through the real subscribeCloud: clobbered → replayed exactly once', async () => {
  const s0 = await H.seed(withFixtures());
  const phone = H.device(); phone.load(s0.marcomaster);
  await call('add_appointment', { title: 'Voice appt', date: inDays(3), time: '11:00' });
  await call('add_meeting_point', { meeting: 'zed alpha', point: 'Voice point' });
  await call('add_to_pipeline', { new_task: 'Voice focus' });
  phone.run("addTask('Phone edit','quick',2)");
  await phone.push();                                                     // blind merge-set over all three
  let doc = await H.read();
  assert.ok(!doc.marcomaster.appointments.some(a => a.title === 'Voice appt'), 'clobbered');
  assert.equal(pipeOf(doc).length, 0, 'clobbered');
  assert.equal(doc.extOps.length, (s0.extOps || []).length + 3);
  const laptop = H.device(); laptop.load(s0.marcomaster);
  const deliver = laptop.subscribe();
  deliver(doc);
  const S = laptop.S;
  assert.equal(S.appointments.filter(a => a.title === 'Voice appt').length, 1);
  assert.equal(S.meetings.find(m => m.id === ZED_A).points.filter(p => p.txt === 'Voice point').length, 1);
  assert.equal(laptop.run('day().pipeline').filter(x => x.txt === 'Voice focus').length, 1);
  assert.equal(laptop.rows().filter(r => r.txt === 'Voice focus').length, 1, 'its task too');
  assert.ok(laptop.rows().some(r => r.txt === 'Phone edit'), 'phone edit kept');
  assert.ok(laptop.persisted().some(o => o.bump === true));
  await laptop.push();
  doc = await H.read();
  const again = H.device(); again.load(doc.marcomaster);
  assert.equal(again.replay(doc.extOps), false, 'nothing left to replay');
});
test('THE RACE, pipeline filled by hand before replay: your choice stays, the voice task is kept but not promoted', async () => {
  const s0 = await H.seed(withFixtures([pitem('Mine one'), pitem('Mine two')]));
  const phone = H.device(); phone.load(s0.marcomaster);
  await call('add_to_pipeline', { new_task: 'Voice third' });             // takes slot 3 in the cloud
  phone.run("promoteTaskToPipeline('itodayfix')");                         // meanwhile, on the phone: slot 3 by hand
  await phone.push();                                                     // clobbers the voice slot
  const deliver = phone.subscribe();
  deliver(await H.read());                                                // phone's snapshot → replay
  const pipe = phone.run('day().pipeline');
  assert.equal(pipe.length, 3);
  assert.deepEqual(pipe.map(x => x.txt), ['Mine one', 'Mine two', 'Reconcile the expense report'], 'nothing displaced');
  assert.equal(phone.rows().filter(r => r.txt === 'Voice third').length, 1, 'the voice task itself is kept');
});
