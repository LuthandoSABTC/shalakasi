// scripts/seed_curriculum.js
// Loads data/curriculum_seed.json (10 chapters, ~65 sections) into Supabase.
// Usage: npm run seed:curriculum

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const supabase = require('../services/supabase');

function slugify(text) {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_').slice(0, 60);
}

async function seed() {
  const raw = fs.readFileSync(path.join(__dirname, '../data/curriculum_seed.json'), 'utf-8');
  const { chapters } = JSON.parse(raw);
  let chapterSort = 0;

  for (const chapter of chapters) {
    chapterSort += 1;
    const { data: chapterRow, error: chapterErr } = await supabase
      .from('chapters')
      .upsert({ number: chapter.number, title: chapter.title, sort_order: chapterSort }, { onConflict: 'number' })
      .select()
      .single();

    if (chapterErr) { console.error(`Chapter ${chapter.number} failed:`, chapterErr.message); continue; }
    console.log(`Chapter ${chapter.number}: ${chapter.title} -> ${chapterRow.id}`);

    let sectionSort = 0;
    for (const section of chapter.sections) {
      sectionSort += 1;
      const { error: sectionErr } = await supabase.from('sections').upsert(
        {
          chapter_id: chapterRow.id,
          number: section.number,
          title: section.title,
          sort_order: sectionSort,
          has_activity: !!section.activity,
          activity_title: section.activity,
          skill_tag: `ch${chapter.number}_${slugify(section.title)}`,
        },
        { onConflict: 'chapter_id,number' }
      );
      if (sectionErr) console.error(`  Section ${section.number} failed:`, sectionErr.message);
      else console.log(`  ${section.number} ${section.title}`);
    }
  }
  console.log('\nDone. Run `npm run seed:content` and `npm run seed:quiz` next.');
}

seed().catch((err) => { console.error('Seed failed:', err); process.exit(1); });
