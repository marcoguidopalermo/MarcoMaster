const DEFAULT_RECURRING = [
  {id:'r1', t:'Run MarcoMaster Daily Reset', every:1, kind:'quick', auto:true, last:null},
  {id:'r2', t:'Workout / movement', every:1, kind:'project', auto:true, last:null},
  {id:'r3', t:'Take supplements', every:1, kind:'quick', auto:true, last:null},
  {id:'r4', t:'Follow nutrition plan', every:1, kind:'quick', auto:true, last:null},
  {id:'r5', t:'Check calendar', every:1, kind:'quick', auto:true, last:null},
  {id:'r6', t:'Protect CEO time', every:1, kind:'project', auto:true, last:null},
  {id:'r7', t:'Night shutdown journal', every:1, kind:'quick', auto:true, last:null},
  {id:'r8', t:'Weekly CEO Review', every:7, kind:'project', auto:true, last:null},
  {id:'r9', t:'Plan workouts', every:7, kind:'project', auto:true, last:null},
  {id:'r10', t:'Plan nutrition / groceries', every:7, kind:'project', auto:true, last:null},
  {id:'r11', t:'Review business priorities', every:7, kind:'project', auto:true, last:null},
  {id:'r12', t:'Review personal brand / content plan', every:7, kind:'project', auto:true, last:null},
  {id:'r13', t:'Review relationships / personal life', every:7, kind:'project', auto:true, last:null},
  {id:'r14', t:'Maintain MarcoMaster', every:7, kind:'project', auto:true, last:null},
  {id:'r15', t:'Review goals', every:30, kind:'project', auto:true, last:null},
  {id:'r16', t:'Review current season', every:30, kind:'project', auto:true, last:null},
  {id:'r17', t:'Review finances / subscriptions', every:30, kind:'project', auto:true, last:null},
  {id:'r18', t:'Update priority board', every:30, kind:'project', auto:true, last:null},
  {id:'r19', t:'Review business leverage', every:30, kind:'project', auto:true, last:null},
  {id:'r20', t:'Choose current life / business season', every:90, kind:'project', auto:true, last:null},
  {id:'r21', t:'Set Must-Win priorities', every:90, kind:'project', auto:true, last:null},
  {id:'r22', t:'Review Future Self Narrative', every:90, kind:'project', auto:true, last:null},
  {id:'r23', t:'Move items into Parking Lot', every:90, kind:'project', auto:true, last:null},
  {id:'r24', t:'Decide what does NOT get attention', every:90, kind:'project', auto:true, last:null},
];

/* ---------- TRAINING ----------
   Categories are USER DATA (S.training.cats) — these six are only the seed, laid
   down once. Their ids are deliberately the same strings the categories used to be
   keyed by, so an existing library needs no data movement at all: S.training.library
   stays keyed by category id, and every session's stored exercise copy (which holds
   a `cat`) keeps resolving. That is also what makes renaming safe — the id never
   changes, only the name.

   `type` drives the session tags (workout / cardio / recovery), so a category you
   invent tags correctly as long as it says what kind of thing it is.

   Constants live here (not in page-training.js) because seedDefaults() in state.js
   reads them during the training migration, and defaults.js loads first. */
const TRAIN_CAT_SEED = [
  {id:'strength',     name:'Strength',            type:'workout'},
  {id:'accessory',    name:'Accessory',           type:'workout'},
  {id:'circuit',      name:'Circuit',             type:'workout'},
  {id:'calisthenics', name:'Calisthenics',        type:'workout'},
  {id:'cardio',       name:'Cardio / Run',        type:'cardio'},
  {id:'mobility',     name:'Mobility / Recovery', type:'recovery'},
];
/* the three kinds a category can be, and so the tags a session can carry */
const TRAIN_CAT_TYPES = [
  ['workout','Workout'],
  ['cardio','Cardio'],
  ['recovery','Recovery'],
];
/* Seeded ONCE (behind S.training._libSeeded) so the library is usable immediately.
   The three empty categories are deliberate — they're yours to fill. */
const TRAIN_SEED = {
  strength:['Chin ups','Pull ups','Chest press','Shoulder press','Dips','Lunges'],
  accessory:['Halos','Windmills','Snatches','Clean and press'],
  circuit:['Kettlebell swings','Overhead lunges'],
  calisthenics:[],
  cardio:[],
  mobility:[],
};
/* Session types that need no exercises — tap one and you've planned the day. */
const TRAIN_PRESETS = ['Run','Walk','Bike','Swim','Class'];

/* ---------- CONTENT ----------
   The starting pillars, seeded ONCE (behind S.content._pillarsSeeded) so you're
   never staring at an empty list. Names only — rename or delete freely. */
const CONTENT_PILLAR_SEED = [
  'Fitness',
  'Business / Entrepreneurship',
  'Leadership / Systems',
  'ADHD / Self-Mastery',
  'Documenting the Build',
];

const DEFAULT_RULES = [
  "I do not trust memory. I trust systems.",
  "I do not start reacting until I run MarcoMaster.",
  "Fitness is not optional. Fitness is infrastructure.",
  "I protect CEO time. Open-door time and CEO time are different.",
  "I do not solve problems employees can solve.",
  "The app solves recurring pain. It is not a hobby project.",
  "I do not let urgency steal importance.",
  "I build systems before I chase freedom.",
  "I do not need to do everything. I need to do the right things consistently.",
  "Freedom is created by systems, not by doing more.",
  "If I do not direct my attention, the world will take it.",
];

const DEFAULT_BOARD = {
  mustwin:[
    {id:b(),txt:'Sleep / health / allergies'},
    {id:b(),txt:'Business operations'},
    {id:b(),txt:'App rollout — TaskMaster / PerformanceMaster / MechanicMaster'},
    {id:b(),txt:'Consistent personal brand posting'},
  ],
  scheduled:[
    {id:b(),txt:'Gazebo roof decision'},
    {id:b(),txt:'Backyard irrigation'},
    {id:b(),txt:'Backyard electrical'},
    {id:b(),txt:'Client messages (batch)'},
    {id:b(),txt:'Amplify subscription'},
    {id:b(),txt:'QuickBooks setup'},
    {id:b(),txt:'Employee meetings'},
  ],
  parking:[
    {id:b(),txt:'Boxing'},
    {id:b(),txt:'Muay Thai'},
    {id:b(),txt:'Future mentorship offer'},
    {id:b(),txt:'Extra app features'},
    {id:b(),txt:'New business ideas'},
    {id:b(),txt:'Big content strategy overhaul'},
  ],
};

const SCORE_AREAS = ['Sleep','Nutrition','Training','Energy','Emotional stability','Business focus','Systems progress','Content consistency','Relationships','Freedom'];

/* default Daily Reset checklist (editable in Settings) */
const DEFAULT_RESET_STEPS = [
  ['biz',"Choose today's #1 business outcome"],
  ['health',"Choose today's #1 health action"],
  ['lev',"Choose today's #1 systems / leverage action"],
  ['content',"Choose today's #1 content / personal brand action"],
  ['not',"Choose one thing I am intentionally NOT working on"],
  ['workout',"Confirm workout time"],
  ['shutdown',"Confirm shutdown time"],
];

function b(){ return 'i'+Math.random().toString(36).slice(2,9); }

