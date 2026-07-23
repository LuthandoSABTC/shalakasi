// scripts/seed_content.js
// Writes a content_seed JSON file's lesson text into sections.content_md.
// Run this AFTER seed_curriculum.js.
// Usage: npm run seed:content                        (uses data/content_seed.json)
//        node scripts/seed_content.js content_seed_ch3_4.json   (uses a different file in data/)

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const supabase = require('../services/supabase');

async function seed() {
  const filename = process.argv[2] || 'content_seed.json';
  const raw = fs.readFileSync(path.join(__dirname, '../data', filename), 'utf-8');
  const { sections } = JSON.parse(raw);

  for (const [number, content_md] of Object.entries(sections)) {
    const { data, error } = await supabase
      .from('sections')
      .update({ content_md })
      .eq('number', number)
      .select();

    if (error) console.error(`Section ${number} failed:`, error.message);
    else if (!data.length) console.warn(`Section ${number} not found — run seed:curriculum first.`);
    else console.log(`Content written for section ${number}`);
  }
  console.log('\nDone.');
}

seed().catch((err) => { console.error('Seed failed:', err); process.exit(1); });
