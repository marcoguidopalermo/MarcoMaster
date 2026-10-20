/* add_followup / list_followups */
const test = require('node:test');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('util');
const H = require('./harness');
const core = require('../shared/state-core.js');
const { runOp, changedPaths } = require('../mcp/store');
const T = require('../mcp/tasks');

let srv, token;
const call = (name, args) => H.callTool(srv.base, token, name, args);
const count = (doc) => core.stateCount(doc.marcomaster);
const DAY = 86400000;
const fus = (doc) => doc.marcomaster.followups || [];
const byTxt = (doc, txt) => fus(doc).filter(f => f.txt === txt);

test.before(async () => {
  console.log(`# seeding from ${H.loadDoc().real ? 'a COPY of the real document' : 'the synthetic fixture'}`);
  await H.ensureUsers();
  await H.seed();
  srv = await H.startServer();
  token = (await H.oauthConnect(srv.base)).tokens.access_token;
});
test.after(async () => { if (srv) await srv.close(); });

test('add_followup: addFollowup\'s exact record, +1, only followups touched, shown by the app', async () => {
  const before = await H.seed();
  const r = await call('add_followup', { text: 'Chase invoice with Acme' });
  assert.match(r.text, /Added follow-up: "Chase invoice with Acme"/);
  const after = await H.read();
  assert.equal(count(after), count(before) + 1);
  assert.deepEqual(changedPaths(before.marcomaster, after.marcomaster).map(p => p.join('.')).filter(p => p !== 'updatedAt' && p !== 'extApplied'), ['followups']);
  const voice = byTxt(after, 'Chase invoice with Acme')[0];
  // the app's own add path, on the same starting state
  const d = H.device(); d.load(before.marcomaster);
  d.run("newFollowupText='probe'; addFollowup();");
  const probe = d.run("S.followups.find(f=>f.txt==='probe')");
  assert.deepEqual(Object.keys(voice), Object.keys(probe), 'same fields, same order');
  Object.keys(probe).forEach(k => assert.equal(typeof voice[k], typeof probe[k], k));
  assert.equal(voice.note, ''); assert.equal(voice.resolved, false);
  assert.equal(voice.lastTouched, voice.createdAt, 'starts untouched, like the app');
  // the Follow-ups section renders it, open, aged "today", counted
  const app = H.device(); app.load(after.marcomaster);
  const html = app.run('renderFollowups()');
  assert.match(html, /Chase invoice with Acme/);
  app.ctx.__id = voice.id;
  assert.equal(app.run('followupAge(S.followups.find(f=>f.id===__id))'), 'today');
  assert.equal(app.run('openFollowupCount()'), fus(before).filter(f => !f.resolved).length + 1);
});

test('touch-tracking: the app\'s touch and resolve work on a voice follow-up and age it the app\'s way', async () => {
  await H.seed();
  await call('add_followup', { text: 'Waiting on contract from Dana' });
  const doc = await H.read();
  const app = H.device(); app.load(doc.marcomaster);
  const id = byTxt(doc, 'Waiting on contract from Dana')[0].id;
  app.ctx.__id = id;
  // pretend it was opened 5 days ago, then run the app's own touch handler logic
  app.run('const __f=S.followups.find(f=>f.id===__id); __f.createdAt-=5*86400000; __f.lastTouched=__f.createdAt;');
  assert.equal(app.run('followupAge(S.followups.find(f=>f.id===__id))'), '5d open');
  app.run('S.followups.find(f=>f.id===__id).lastTouched=Date.now();');   // ⟳ "touched today" (bindFollowups)
  assert.equal(app.run('followupAge(S.followups.find(f=>f.id===__id))'), 'today');
  app.run('S.followups.find(f=>f.id===__id).resolved=true;');              // ✓ resolve
  assert.doesNotMatch(app.run('renderFollowups()').split('Resolved')[0], /Waiting on contract from Dana/);
});

test('list_followups: open ones, longest-untouched first, ages by the app\'s rule (matches followupAge)', async () => {
  const now = Date.now();
  await H.seed(m => {
    m.followups = (m.followups || []).concat([
      { id: 'fuold', txt: 'Old loop', note: 'they said Friday', createdAt: now - 12 * DAY, lastTouched: now - 9 * DAY, resolved: false },
      { id: 'funew', txt: 'Newer loop', note: '', createdAt: now - 2 * DAY, lastTouched: now - 2 * DAY, resolved: false },
      { id: 'fudone', txt: 'Closed loop', note: '', createdAt: now - 30 * DAY, lastTouched: now - 20 * DAY, resolved: true },
    ]);
  });
  const r = await call('list_followups', {});
  assert.match(r.text, /Old loop \(they said Friday\) — 9d open, opened .*, last followed up /);
  assert.match(r.text, /Newer loop — 2d open, opened /);
  assert.doesNotMatch(r.text, /Closed loop/);
  assert.ok(r.text.indexOf('Old loop') < r.text.indexOf('Newer loop'), 'longest-untouched first');
  // same label the app shows
  const app = H.device(); app.load((await H.read()).marcomaster);
  assert.equal(app.run("followupAge(S.followups.find(f=>f.id==='fuold'))"), '9d open');
  // and with nothing open
  await H.seed(m => { m.followups = [{ id: 'fux', txt: 'x', note: '', createdAt: now, lastTouched: now, resolved: true }]; });
  assert.match((await call('list_followups', {})).text, /No open follow-ups — all loops closed\. \(1 resolved\)/);
});

test('empty text is rejected before anything is written', async () => {
  const before = await H.seed();
  const r = await H.rpc(srv.base, token, 'tools/call', { name: 'add_followup', arguments: { text: '   ' } });
  assert.ok(r.json.error || r.json.result.isError);
  assert.ok(isDeepStrictEqual(await H.read(), before));
});

test('10 simultaneous follow-ups: all land exactly once', async () => {
  const before = await H.seed();
  const txts = Array.from({ length: 10 }, (_, i) => 'Parallel loop ' + i);
  await Promise.all(txts.map(text => call('add_followup', { text })));
  const after = await H.read();
  txts.forEach(t => assert.equal(byTxt(after, t).length, 1, t));
  assert.equal(count(after), count(before) + 10);
});

test('a device write landing mid-transaction is not lost', async () => {
  const before = await H.seed();
  const dev = H.device(); dev.load(before.marcomaster);
  dev.run("newFollowupText='Typed on the phone'; addFollowup();");
  let fired = false;
  const now = Date.now();
  const res = await runOp(H.db, H.UID, T.torontoNow(), () => ({ op: { type: 'followup', followup: { id: 'ifumid', txt: 'Said to Claude', note: '', createdAt: now, lastTouched: now, resolved: false } }, reply: 'ok' }), {
    afterRead: async () => { if (fired) return; fired = true; dev.push().catch(() => {}); await new Promise(r => setTimeout(r, 400)); },
  });
  assert.ok(res.wrote);
  await new Promise(r => setTimeout(r, 300));
  let doc = await H.read();
  assert.equal(byTxt(doc, 'Typed on the phone').length, 1, 'device edit survived');
  if (!byTxt(doc, 'Said to Claude').length) { dev.replay(doc.extOps); await dev.push(); doc = await H.read(); }
  assert.equal(byTxt(doc, 'Said to Claude').length, 1, 'voice follow-up survived');
});

test('THE RACE through the real subscribeCloud: clobbered → replayed exactly once → a later deletion stays deleted', async () => {
  const s0 = await H.seed();
  const phone = H.device(); phone.load(s0.marcomaster);
  await call('add_followup', { text: 'Voice: chase the landlord' });
  phone.run("newFollowupText='Phone loop'; addFollowup();");
  await phone.push();                                                   // blind merge-set: followups array replaced
  let doc = await H.read();
  assert.equal(byTxt(doc, 'Voice: chase the landlord').length, 0, 'clobbered');
  const laptop = H.device(); laptop.load(s0.marcomaster);
  laptop.subscribe()(doc);
  assert.equal(laptop.S.followups.filter(f => f.txt === 'Voice: chase the landlord').length, 1, 'replayed');
  assert.equal(laptop.S.followups.filter(f => f.txt === 'Phone loop').length, 1, 'phone edit kept');
  assert.ok(laptop.persisted().some(o => o.bump === true));
  await laptop.push();
  doc = await H.read();
  assert.equal(byTxt(doc, 'Voice: chase the landlord').length, 1);
  // delete it in the app (the × handler's filter); replay must not resurrect it
  laptop.run("S.followups=S.followups.filter(f=>f.txt!=='Voice: chase the landlord');");
  await laptop.push();
  doc = await H.read();
  const fresh = H.device(); fresh.load(doc.marcomaster);
  assert.equal(fresh.replay(doc.extOps), false);
  assert.equal(byTxt(doc, 'Voice: chase the landlord').length, 0);
});
