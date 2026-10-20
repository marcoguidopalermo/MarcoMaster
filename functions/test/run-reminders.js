/* Child process: run the REAL scheduled appointmentReminders once against the
   emulator and print the sent-markers it recorded. A separate process because
   index.js calls initializeApp() for itself. Emulator-only (index.js would
   otherwise reach production, so refuse without the emulator env). */
if (!process.env.FIRESTORE_EMULATOR_HOST || !String(process.env.GCLOUD_PROJECT || '').startsWith('demo-')) {
  console.error('refusing: not on the emulator'); process.exit(2);
}
const fns = require('../index.js');
const { getFirestore } = require('firebase-admin/firestore');
(async () => {
  await fns.appointmentReminders.run({});
  const snap = await getFirestore().collection('sentReminders').doc('OgEsKyNilhhmmh5FmwIQXh1qRwu1').get();
  // the function's own logger also writes to stdout — mark our line
  process.stdout.write('\nSENT:' + JSON.stringify((snap.exists && snap.data().sent) || {}) + '\n');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
