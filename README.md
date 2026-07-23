# ShalaKasi

Adaptive Bitcoin Diploma platform for Bitcoin Ekasi. Self-paced kiosk
workstations, an AI mentor ("Satoshi"), and mastery-based routing
through the curriculum instead of a fixed order.

## 1. Set up Supabase

1. Create a fresh Supabase project.
2. Open the SQL editor and run `schema.sql` (from the earlier
   deliverable — copy it into this project if it's not already here).
3. Copy `.env.example` to `.env` and fill in:
   - `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — Project Settings > API
   - `JWT_SECRET`, `ADMIN_KEY` — any long random strings
   - `ANTHROPIC_API_KEY` — optional at first; leave blank to run with
     the rule-based fallback (see below) while you're setting up

## 2. Install and seed

```bash
npm install
npm run seed:curriculum   # loads the 10 chapters / ~65 sections
npm run seed:content      # loads written lesson text (Ch1-2 so far)
npm run seed:quiz         # loads the checkpoint questions written so far
```

## 3. Create your first student

```bash
curl -X POST http://localhost:3300/api/admin/students \
  -H "x-admin-key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"username":"zanele01","password":"changeme123","full_name":"Zanele M.","cohort":"2026-Q3"}'
```

## 4. Run it

```bash
npm start
```

Open `http://localhost:3300` on a workstation, log in with the
student credentials above.

## What's real vs. placeholder right now

- **Real**: login, curriculum tree, section reading, checkpoint
  quizzes, mastery tracking, chat logging, admin student
  provisioning — all against Supabase, no mock data.
- **Content**: Chapters 1-2 have real (freshly written, not copied
  from the source workbook) lesson text and a few checkpoint
  questions, as a pattern for Sassa to extend chapter by chapter.
  Sections without content_md yet show a "still being written"
  message rather than breaking.
- **Satoshi's intelligence**: if `ANTHROPIC_API_KEY` is unset, both
  the chat and the adaptive routing decision fall back to simple,
  transparent logic (a fixed mastery threshold) so the app is fully
  usable before the AI is wired in. Set the key to switch on real
  reasoning — no code changes needed.
- **Not built yet**: the admin dashboard for reviewing mastery/chat
  logs across all students (the API routes exist —
  `GET /api/admin/students`, `GET /api/admin/students/:id/decisions`
  — but there's no UI on top of them yet), and AI-generated checkpoint
  questions (phase 2, per the earlier decision to start with a fixed
  quiz bank).

## Architecture notes

- Sessions are stateless JWTs kept in `sessionStorage`, not
  `localStorage` — these are shared kiosk workstations, so the token
  should not survive a browser restart or linger for the next student.
  The rail's logout button clears it explicitly.
- Every adaptive routing decision is written to `ai_decisions` with
  a plain-language `reasoning` string — shown on the student's own
  dashboard, not hidden. Auditable by design, per the earlier
  discussion about not wanting a black box.
- `services/aiEngine.js` is the one file to touch when you're ready
  to move from the rule-based fallback to full Claude-driven routing
  and richer chat — the structure is already there, it just needs
  `ANTHROPIC_API_KEY` set.
