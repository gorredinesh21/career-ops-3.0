// post.mjs — publish a LinkedIn text or image post. Run with NODE_OPTIONS=--use-system-ca.
//   node linkedin/post.mjs --today                 # post today's calendar entry
//   node linkedin/post.mjs --date 2026-06-11        # post a specific day's entry
//   node linkedin/post.mjs --text "hello world"     # post arbitrary text
//   node linkedin/post.mjs --file post.txt --image a.png --image b.jpg   # text + image(s)
//   add --dry-run to preview without posting
import { readFileSync } from 'fs';
import { createTextPost, createImagePost, calendarEntry } from './lib.mjs';

const a = process.argv.slice(2);
const opt = (f) => { const i = a.indexOf(f); return i !== -1 ? a[i + 1] : null; };
// Collect every --image <path> occurrence (repeatable for multi-image posts).
const images = a.reduce((acc, v, i) => (v === '--image' && a[i + 1] ? [...acc, a[i + 1]] : acc), []);
const dry = a.includes('--dry-run');

let text = opt('--text');
const fileOpt = opt('--file');
if (!text && fileOpt) text = readFileSync(fileOpt, 'utf-8').trim();
if (!text) {
  const date = a.includes('--today') ? new Date().toISOString().slice(0, 10) : opt('--date');
  if (!date) { console.error('usage: --today | --date YYYY-MM-DD | --text "..."'); process.exit(1); }
  text = calendarEntry(date);
  if (!text) { console.error(`No calendar entry for ${date} (nothing to post — fine on off days).`); process.exit(0); }
  console.log(`[${date}] posting calendar entry:\n`);
}
console.log(text + '\n');
if (images.length) console.log(`images: ${images.join(', ')}\n`);

if (dry) { console.log('(dry-run — not posted)'); process.exit(0); }
try {
  const r = images.length ? await createImagePost(text, images) : await createTextPost(text);
  console.log(`✅ Posted to LinkedIn (id: ${r.id})`);
} catch (e) {
  console.error('❌ ' + e.message);
  process.exit(1);
}
