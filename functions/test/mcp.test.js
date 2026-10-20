const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const H = require('./harness');
const core = require('../shared/state-core.js');
const { runOp, GuardError } = require('../mcp/store');
const T = require('../mcp/tasks');

let srv, token;
const call = (name, args) => H.callTool(srv.base, token, name, args);
const today = () => T.torontoNow().dayKey;
const opsOf = (doc) => doc.extOps || [];

/* everything except the paths an op may touch must be byte-for-byte unchanged */
function assertOnlyChanged(before, after, allowed){
  const b = JSON.parse(JSON.stringify(before.marcomaster)), a = JSON.parse(JSON.stringify(after.marcomaster));
  const strip = (s) => {
    delete s.updatedAt; delete s.extApplied;
    allowed.forEach(p => { let o = s; for (let i = 0; i < p.length - 1; i++) o = (o || {})[p[i]]; if (o) delete o[p[p.length - 1]]; });
  };
  strip(b); strip(a);
  assert.ok(isDeepStrictEqual(b, a), 'state changed outside the allowed paths');
}
function firstOpenStandalone(state){
  return T.taskRows(state, today()).find(r => r.source === 'standalone' && !r.done && !r.recurring && !r.workout);
}

test.before(async () => {
  console.log(`# seeding from ${H.loadDoc().real ? 'a COPY of the real document' : 'the synthetic fixture'}`);
  await H.ensureUsers();
  await H.seed();
  srv = await H.startServer();
  const c = await H.oauthConnect(srv.base);
  assert.equal(c.tokStatus, 200, JSON.stringify(c.tokens));
  token = c.tokens.access_token;
});
test.after(async () => { if (srv) await srv.close(); });

/* ================= shared code ================= */
test('the function ships a byte-identical copy of js/state-core.js', () => {
  assert.equal(fs.readFileSync(path.join(H.ROOT, 'functions/shared/state-core.js'), 'utf8'),
    fs.readFileSync(path.join(H.ROOT, 'js/state-core.js'), 'utf8'));
});
test('the app and the server compute the same stateCount on the real document', async () => {
  const doc = await H.seed();
  const d = H.device(); d.load(doc.marcomaster);
  assert.equal(d.run('stateCount(S)'), core.stateCount(d.S));
  assert.ok(core.stateCount(doc.marcomaster) >= core.PROTECT_FLOOR);
});

/* ================= OAuth ================= */
test('unauthenticated /mcp → 401 pointing at protected-resource metadata', async () => {
  const r = await fetch(srv.base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 401);
  const m = r.headers.get('www-authenticate').match(/resource_metadata="([^"]+)"/);
  assert.ok(m, 'resource_metadata in WWW-Authenticate');
  const meta = await (await fetch(m[1])).json();
  assert.equal(meta.resource, srv.base + '/mcp');
  assert.equal(meta.authorization_servers[0], srv.base + '/');
  const as = await (await fetch(srv.base + '/.well-known/oauth-authorization-server')).json();
  assert.ok(as.registration_endpoint && as.code_challenge_methods_supported.includes('S256'));
});
test('registration only accepts Claude callbacks', async () => {
  const r = await fetch(srv.base + '/register', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: ['https://evil.example/cb'], token_endpoint_auth_method: 'none' }) });
  assert.equal(r.status, 400);
});
test('another account cannot get a code', async () => {
  const c = await H.oauthConnect(srv.base, { email: 'other@example.test' });
  assert.equal(c.status, 403);
});
test('a wrong PKCE verifier is rejected, and a code works only once', async () => {
  const bad = await H.oauthConnect(srv.base, { tamperVerifier: true });
  assert.equal(bad.tokStatus, 400);
  const good = await H.oauthConnect(srv.base);
  assert.equal(good.tokStatus, 200);
  const again = await fetch(srv.base + '/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: good.code, code_verifier: good.verifier, client_id: good.reg.client_id, redirect_uri: H.CALLBACK }).toString() });
  assert.equal(again.status, 400);
});
test('refresh tokens rotate: the old one dies on use', async () => {
  const c = await H.oauthConnect(srv.base);
  const refresh = (rt) => fetch(srv.base + '/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt, client_id: c.reg.client_id }).toString() });
  const r1 = await refresh(c.tokens.refresh_token);
  assert.equal(r1.status, 200);
  const t1 = await r1.json();
  assert.equal((await refresh(c.tokens.refresh_token)).status, 400);
  assert.equal((await H.rpc(srv.base, t1.access_token, 'tools/list', {})).status, 200);
});
test('a revoked or made-up token is refused', async () => {
  assert.equal((await H.rpc(srv.base, 'mma_nope', 'tools/list', {})).status, 401);
});
test('the sign-in page names the redirect host and escapes the client name', async () => {
  const c = await H.oauthConnect(srv.base);
  assert.match(c.html, /claude\.ai/);
  assert.doesNotMatch(c.html, /<script>alert/);
});

/* ================= MCP protocol ================= */
test('initialize + tools/list over stateless Streamable HTTP', async () => {
  const init = await H.rpc(srv.base, token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.status, 200);
  assert.match(init.json.result.instructions, new RegExp(today()));
  const list = await H.rpc(srv.base, token, 'tools/list', {});
  const tools = Object.fromEntries(list.json.result.tools.map(t => [t.name, t]));
  assert.deepEqual(Object.keys(tools).sort(), ['add_task', 'complete_task', 'list_tasks', 'set_due_date']);
  assert.equal(tools.list_tasks.annotations.readOnlyHint, true);
  assert.equal(tools.add_task.annotations.destructiveHint, false);
});

/* ================= writes, on the real document ================= */
test('add_task: +1 item, version advanced, only today\'s tasks touched, appears in the app', async () => {
  const before = await H.seed();
  const r = await call('add_task', { title: 'Call the bank about the wire', priority: true, due_date: '2026-10-23' });
  assert.ok(!r.isError, r.text);
  const after = await H.read();
  const tk = today();
  assert.equal(core.stateCount(after.marcomaster), core.stateCount(before.marcomaster) + 1);
  assert.ok(after.marcomaster.updatedAt >= before.marcomaster.updatedAt + 1, 'version advanced');
  assert.equal(after._updated, after.marcomaster.updatedAt, '_updated mirrors updatedAt');
  assertOnlyChanged(before, after, [['days', tk]]);
  assert.equal(opsOf(after).length, 1);
  assert.deepEqual(core.extAppliedList(after.marcomaster).map(x => x.id), [opsOf(after)[0].id]);

  // the task has EXACTLY the shape the app's own addTask() makes (+ dueDate)
  const voice = after.marcomaster.days[tk].tasks.find(t => t.txt === 'Call the bank about the wire');
  const d = H.device(); d.load(before.marcomaster);
  d.run("addTask('shape probe','quick',2)");
  const probe = d.run('day().tasks').find(t => t.txt === 'shape probe');
  assert.deepEqual(Object.keys(voice).filter(k => k !== 'dueDate').sort(), Object.keys(probe).sort());
  Object.keys(probe).forEach(k => assert.equal(typeof voice[k], typeof probe[k], k));
  assert.equal(voice.dueDate, '2026-10-23');

  // …and the app's own renderers show it: All Tasks, the fire picker, the due tag
  const app = H.device(); app.load(after.marcomaster);
  const row = app.rows().find(x => x.key === 'S|' + voice.id);
  assert.ok(row && row.priority && row.dueDate === '2026-10-23', 'in All Tasks');
  assert.ok(JSON.stringify(app.firePicker()).includes(voice.id), 'in the fire picker');
  app.ctx.__r = row;
  assert.match(app.run('renderTaskRow(__r)'), /Due Oct 23/);
});

test('complete_task: by spoken words → Completed Today in the app', async () => {
  const before = await H.seed();
  await call('add_task', { title: 'Renew the parking permit' });
  const r = await call('complete_task', { task: 'parking permit' });
  assert.match(r.text, /^Done/);
  const after = await H.read();
  assert.equal(core.stateCount(after.marcomaster), core.stateCount(before.marcomaster) + 1);
  const app = H.device(); app.load(after.marcomaster);
  const done = app.completedToday().find(x => x.txt === 'Renew the parking permit');
  assert.ok(done, 'in Completed Today');
  assert.match(done.time, /^\d{2}:\d{2}$/, 'standalone doneAt is HH:MM, like the app');
  const v1 = after.marcomaster.updatedAt;
  const again = await call('complete_task', { task: 'parking permit' });
  assert.match(again.text, /No open task/);
  assert.equal((await H.read()).marcomaster.updatedAt, v1, 'no write on a no-op');
});

test('complete_task on a project task: day-key doneAt, linked blocks synced, Completed Today', async (t) => {
  const before = await H.seed();
  const row = T.taskRows(before.marcomaster, today()).find(r => r.source === 'project' && !r.done);
  if (!row) return t.skip('no open project task in this document');
  const r = await call('complete_task', { task: row.key });
  assert.match(r.text, /^Done/);
  const after = await H.read();
  const [, pid, tid] = row.key.split('|');
  const pt = after.marcomaster.projects.find(p => p.id === pid).tasks.find(x => x.id === tid);
  assert.equal(pt.done, true); assert.equal(pt.doneAt, today());
  Object.values(after.marcomaster.days).forEach(d => (d.tasks || []).forEach(b => { if (b.projectId === pid && b.projTaskId === tid) assert.equal(b.done, true); }));
  assertOnlyChanged(before, after, [['projects'], ...Object.keys(after.marcomaster.days).map(dk => ['days', dk, 'tasks'])]);
  const app = H.device(); app.load(after.marcomaster);
  assert.ok(app.completedToday().some(x => x.key === row.key));
});

test('ambiguous or unknown references never write', async () => {
  await H.seed();
  await call('add_task', { title: 'Email Sam about invoice' });
  await call('add_task', { title: 'Email Sam about contract' });
  const v = (await H.read()).marcomaster.updatedAt;
  const r = await call('complete_task', { task: 'email sam' });
  assert.match(r.text, /Several open tasks match/);
  assert.match(r.text, /invoice/); assert.match(r.text, /contract/);
  assert.match((await call('complete_task', { task: 'zzqx nothing like this' })).text, /No open task/);
  assert.equal((await H.read()).marcomaster.updatedAt, v);
});

test('recurring / leak / training tasks are refused (their completion side effects live in the app)', async (t) => {
  const doc = await H.seed();
  const rec = T.taskRows(doc.marcomaster, today()).find(r => !r.done && (r.recurring || r.source === 'leak' || r.workout));
  if (!rec) return t.skip('no recurring/leak/training task open in this document');
  const v = doc.marcomaster.updatedAt;
  const r = await call('complete_task', { task: rec.key });
  assert.match(r.text, /complete it in the app/);
  assert.equal((await H.read()).marcomaster.updatedAt, v);
});

test('set_due_date: set, shows in the app, clear', async () => {
  const before = await H.seed();
  await call('add_task', { title: 'Book dentist' });
  const r = await call('set_due_date', { task: 'dentist', date: '2026-11-02' });
  assert.match(r.text, /due 2026-11-02/);
  let after = await H.read();
  assert.equal(core.stateCount(after.marcomaster), core.stateCount(before.marcomaster) + 1);
  const app = H.device(); app.load(after.marcomaster);
  assert.equal(app.rows().find(x => x.txt === 'Book dentist').dueDate, '2026-11-02');
  await call('set_due_date', { task: 'dentist', date: null });
  after = await H.read();
  assert.ok(!('dueDate' in after.marcomaster.days[today()].tasks.find(t => t.txt === 'Book dentist')));
  assert.match((await call('set_due_date', { task: 'dentist', date: 'next friday' })).text, /valid YYYY-MM-DD/);
});

test('list_tasks reflects writes; done_today lists completions', async () => {
  await H.seed();
  await call('add_task', { title: 'Water the plants', priority: true });
  assert.match((await call('list_tasks', {})).text, /🔥 Water the plants/);
  assert.match((await call('list_tasks', { filter: 'priority' })).text, /Water the plants/);
  await call('complete_task', { task: 'water the plants' });
  assert.match((await call('list_tasks', { filter: 'done_today' })).text, /Water the plants/);
});

test('no today record yet: server creates a blank one, the app\'s rollover still carries yesterday', async () => {
  const tk = today();
  const before = await H.seed(m => {
    // simulate a fresh morning: today absent, yesterday holds an unfinished one-off
    delete m.days[tk];
    const prev = Object.keys(m.days).filter(k => k < tk).sort().pop() || '2000-01-01';
    if (!m.days[prev]) m.days[prev] = { tasks: [] };
    m.days[prev].tasks = (m.days[prev].tasks || []).concat([{ id: 'icarry1', txt: 'Left over from yesterday', kind: 'quick', done: false, priority: false, mins: 2, start: null, schedDate: null }]);
  });
  await call('add_task', { title: 'Voice before coffee' });
  const after = await H.read();
  assert.ok(!after.marcomaster.days[tk]._seeded, 'server leaves the rollover to the app');
  assertOnlyChanged(before, after, [['days', tk]]);
  const app = H.device(); app.load(after.marcomaster);       // load → day() runs the bridge
  const ids = app.run('day().tasks').map(t => t.id);
  assert.ok(ids.includes('icarry1'), 'carried in');
  assert.equal(ids.filter(id => id === 'icarry1').length, 1);
  assert.equal(app.run('day().tasks').filter(t => t.txt === 'Voice before coffee').length, 1);
  const base = H.device(); base.load(before.marcomaster);      // same app-side seeding, before the voice add
  assert.equal(app.run('stateCount(S)'), base.run('stateCount(S)') + 1, 'bridge MOVES, never copies');

  // completing a not-yet-carried task by voice moves it into today first (as the bridge would)
  await H.seed(m => { delete m.days[tk]; const prev = Object.keys(m.days).filter(k => k < tk).sort().pop(); m.days[prev].tasks.push({ id: 'icarry2', txt: 'Uncarried thing', kind: 'quick', done: false, priority: false, mins: 2, start: null, schedDate: null }); });
  await call('complete_task', { task: 'S|icarry2' });
  const app2 = H.device(); app2.load((await H.read()).marcomaster);
  assert.ok(app2.completedToday().some(x => x.txt === 'Uncarried thing'));
});

/* ================= guards ================= */
test('refuses to write into a near-empty document', async () => {
  await H.userRef().set({ marcomaster: { updatedAt: 5, days: {}, projects: [] }, _updated: 5 });
  const r = await call('add_task', { title: 'should not land' });
  assert.ok(r.isError); assert.match(r.text, /looks empty/);
  assert.equal((await H.read()).marcomaster.updatedAt, 5);
});
test('refuses a missing document', async () => {
  await H.userRef().delete();
  const r = await call('add_task', { title: 'nope' });
  assert.ok(r.isError);
  assert.equal((await H.userRef().get()).exists, false);
});
test('a mutation that shrinks or strays outside its paths is blocked before writing', async () => {
  const before = await H.seed();
  const real = core.applyExtOp;
  try {
    core.applyExtOp = (s, op, ctx) => { real(s, op, ctx); s.projects = []; return true; };   // a buggy op that wipes projects
    await assert.rejects(runOp(H.db, H.UID, T.torontoNow(), () => ({ op: { type: 'add', task: { id: 'ibad', txt: 'x', kind: 'quick', done: false, priority: false, mins: 2, start: null, schedDate: null } } })), GuardError);
    core.applyExtOp = (s, op, ctx) => { s.settings = { hacked: true }; return true; };           // count-neutral, wrong path
    await assert.rejects(runOp(H.db, H.UID, T.torontoNow(), () => ({ op: { type: 'due', key: 'S|x', dueDate: null } })), /unexpected change to settings/);
  } finally { core.applyExtOp = real; }
  assert.ok(isDeepStrictEqual(await H.read(), before), 'document untouched');
});

/* ================= concurrency ================= */
test('10 simultaneous voice adds: all land, none lost', async () => {
  const before = await H.seed();
  const titles = Array.from({ length: 10 }, (_, i) => 'Parallel task ' + i);
  await Promise.all(titles.map(title => call('add_task', { title })));
  const after = await H.read();
  const txts = after.marcomaster.days[today()].tasks.map(t => t.txt);
  titles.forEach(t => assert.equal(txts.filter(x => x === t).length, 1, t));
  assert.equal(core.stateCount(after.marcomaster), core.stateCount(before.marcomaster) + 10);
  assert.equal(opsOf(after).length, 10);
  assert.equal(core.extAppliedList(after.marcomaster).length, 10);
});

test('a device write landing mid-transaction is not lost (transaction retries on the fresh copy)', async () => {
  const before = await H.seed();
  const dev = H.device(); dev.load(before.marcomaster);
  dev.run("addTask('Typed on the phone','quick',2)");
  let fired = false;
  const res = await runOp(H.db, H.UID, T.torontoNow(), () => ({ op: { type: 'add', task: { id: 'ivoice1', txt: 'Said to Claude', kind: 'quick', done: false, priority: false, mins: 2, start: null, schedDate: null } }, reply: 'ok' }), {
    afterRead: async () => { if (fired) return; fired = true; dev.push().catch(() => {}); await new Promise(r => setTimeout(r, 400)); },
  });
  assert.ok(res.wrote);
  await new Promise(r => setTimeout(r, 300));
  let doc = await H.read();
  const has = (d, txt) => Object.values(d.marcomaster.days).some(x => (x.tasks || []).some(t => t.txt === txt));
  assert.ok(has(doc, 'Typed on the phone'), 'the device edit survived');
  // whichever order the emulator chose, after the device's normal snapshot handling both exist
  if (!has(doc, 'Said to Claude')) { assert.ok(dev.replay(doc.extOps)); await dev.push(); doc = await H.read(); }
  assert.ok(has(doc, 'Said to Claude'), 'the voice task survived');
});

test('THE RACE: a device blind-writes over a voice add → replay restores it, exactly once, and never resurrects a deletion', async () => {
  const s0 = await H.seed();
  const phone = H.device(); phone.load(s0.marcomaster);              // phone holds S0, a save queued
  const laptop = H.device(); laptop.load(s0.marcomaster);            // laptop idle on S0
  await call('add_task', { title: 'Voice: buy printer ink' });       // server commits
  phone.run("addTask('Phone edit','quick',2)");
  await phone.push();                                                // the queued save lands on top: blind merge-set

  let doc = await H.read();
  const inState = (d, txt) => Object.values(d.marcomaster.days).flatMap(x => x.tasks || []).filter(t => t.txt === txt).length;
  assert.equal(inState(doc, 'Voice: buy printer ink'), 0, 'clobbered, as predicted');
  assert.equal(opsOf(doc).length, 1, 'but still in the op log');
  assert.equal(core.extAppliedList(doc.marcomaster).length, 0, 'and the applied marker went with it (array, not map)');

  // the laptop adopts the newer cloud copy (newer-wins) and replays — it may be the only device left open
  assert.ok(doc.marcomaster.updatedAt > laptop.S.updatedAt);
  laptop.load(doc.marcomaster);
  assert.equal(laptop.replay(doc.extOps), true);
  // …and the phone, on its own snapshot, replays too (same op) — then both push
  assert.equal(phone.replay(doc.extOps), true);
  await phone.push(); await laptop.push();
  doc = await H.read();
  assert.equal(inState(doc, 'Voice: buy printer ink'), 1, 'restored exactly once');
  assert.equal(inState(doc, 'Phone edit'), 1, 'phone edit kept');
  assert.equal(phone.replay(doc.extOps), false, 'idempotent');

  // delete it in the app; a later replay must not bring it back
  phone.load(doc.marcomaster);
  phone.run("day().tasks=day().tasks.filter(t=>t.txt!=='Voice: buy printer ink')");
  await phone.push();
  doc = await H.read();
  const fresh = H.device(); fresh.load(doc.marcomaster);
  assert.equal(fresh.replay(doc.extOps), false);
  assert.equal(inState(doc, 'Voice: buy printer ink'), 0);
});

/* ================= the app's real cloud reconciler (subscribeCloud) ================= */
test('reconciler: an ordinary newer snapshot is adopted (journal merge runs) without throwing', async () => {
  const s0 = await H.seed();
  const dev = H.device(); dev.load(s0.marcomaster);
  const deliver = dev.subscribe();
  deliver(s0);                                                    // first snapshot: same version
  await call('add_task', { title: 'Adopted from the cloud' });
  deliver(await H.read());                                        // newer → adopt (HOOK A + journal merge)
  assert.ok(dev.rows().some(r => r.txt === 'Adopted from the cloud'));
  assert.equal(dev.rows().filter(r => r.txt === 'Adopted from the cloud').length, 1);
});
test('reconciler: a snapshot whose voice op was clobbered replays it and pushes', async () => {
  const s0 = await H.seed();
  const phone = H.device(); phone.load(s0.marcomaster);
  await call('add_task', { title: 'Voice: call the plumber' });
  phone.run("addTask('Phone edit 2','quick',2)");
  await phone.push();                                             // blind write strips the voice task
  const dev = H.device(); dev.load(s0.marcomaster);
  const deliver = dev.subscribe();
  deliver(await H.read());
  assert.equal(dev.rows().filter(r => r.txt === 'Voice: call the plumber').length, 1, 'replayed by the real handler');
  assert.ok(dev.persisted().some(o => o.bump === true), 'pushed so the cloud heals');
  const before = dev.persisted().length;
  deliver({ ...(await H.read()), marcomaster: JSON.parse(JSON.stringify(dev.S)) });   // its own echo: nothing new
  assert.equal(dev.persisted().length, before, 'no push loop');
});
