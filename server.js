// server.js — ShalaKasi backend
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const supabase = require('./services/supabase');
const { decideNextStep, satoshiChatReply } = require('./services/aiEngine');

const app = express();

// helmet sets sane security headers by default (X-Frame-Options, etc).
// contentSecurityPolicy is off because it needs careful tuning against
// the Google Fonts + inline scripts already used in public/ — worth
// revisiting once the UI is stable rather than fighting it mid-build.
app.use(helmet({ contentSecurityPolicy: false }));

// Restrict which origins can call this API. In dev (no CORS_ORIGIN set)
// this stays open for convenience; set CORS_ORIGIN in production (e.g.
// on Render) to your real domain to close this down.
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || 'shalakasi-dev-secret-change-me';
const MASTERY_THRESHOLD = 0.75;

// Brute-force protection: applies to both student and admin login.
// 10 attempts per 15 minutes per IP is generous for a real student
// mistyping a password, tight enough to make guessing impractical.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — please wait a few minutes and try again.' },
});

// ---------------------------------------------------------
// AUTH MIDDLEWARE
// ---------------------------------------------------------
function requireStudent(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  try {
    req.student = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired — please log in again' });
  }
}

function requireAdmin(req, res, next) {
  const provided = req.headers['x-admin-key'];
  if (!provided || provided !== (process.env.ADMIN_KEY || 'ekasi-admin-change-me')) {
    return res.status(401).json({ error: 'Admin key required' });
  }
  next();
}

// ---------------------------------------------------------
// AUTH
// ---------------------------------------------------------
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const { data: student, error } = await supabase
    .from('students')
    .select('*')
    .eq('username', username)
    .eq('active', true)
    .single();

  if (error || !student || !bcrypt.compareSync(password, student.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = jwt.sign({ id: student.id, username: student.username }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, student: { id: student.id, username: student.username, full_name: student.full_name } });
});

// Stateless JWT — logout is really "client discards the token,"
// this endpoint exists for a consistent API surface / future audit logging.
app.post('/api/auth/logout', requireStudent, (req, res) => {
  res.json({ ok: true });
});

// ---------------------------------------------------------
// CURRICULUM + PROGRESS
// ---------------------------------------------------------

// Full chapter/section tree with this student's status on each section.
app.get('/api/curriculum', requireStudent, async (req, res) => {
  const { data: chapters } = await supabase.from('chapters').select('*').order('sort_order');
  const { data: sections } = await supabase.from('sections').select('*').order('sort_order');
  const { data: progress } = await supabase
    .from('student_progress')
    .select('*')
    .eq('student_id', req.student.id);

  const progressBySection = Object.fromEntries((progress || []).map((p) => [p.section_id, p]));

  const tree = (chapters || []).map((ch) => ({
    ...ch,
    sections: (sections || [])
      .filter((s) => s.chapter_id === ch.id)
      .map((s) => ({
        id: s.id,
        number: s.number,
        title: s.title,
        has_activity: s.has_activity,
        activity_title: s.activity_title,
        status: progressBySection[s.id]?.status || 'locked',
        mastery_score: progressBySection[s.id]?.mastery_score || 0,
      })),
  }));

  res.json({ chapters: tree });
});

// A single section's content + its checkpoint questions (answers withheld).
app.get('/api/sections/:id', requireStudent, async (req, res) => {
  const { data: section, error } = await supabase
    .from('sections')
    .select('*, chapters(number, title)')
    .eq('id', req.params.id)
    .single();

  if (error || !section) return res.status(404).json({ error: 'Section not found' });

  const { data: quiz } = await supabase
    .from('quiz_bank')
    .select('id, question, options, difficulty')
    .eq('section_id', section.id);

  // Mark in_progress the first time a student opens this section.
  await supabase.from('student_progress').upsert(
    {
      student_id: req.student.id,
      section_id: section.id,
      status: 'in_progress',
      last_updated: new Date().toISOString(),
    },
    { onConflict: 'student_id,section_id', ignoreDuplicates: false }
  );

  res.json({ section, quiz: quiz || [] });
});

// For sections with no checkpoint quiz — mark it complete so the student
// can actually advance, instead of "Continue anyway" looping back to the
// same in_progress section forever (there's nothing to grade, so this
// just records completion directly rather than going through /attempt).
app.post('/api/sections/:id/complete', requireStudent, async (req, res) => {
  const { data: quiz } = await supabase.from('quiz_bank').select('id').eq('section_id', req.params.id);
  if (quiz && quiz.length) {
    return res.status(400).json({ error: 'This section has checkpoint questions — use /attempt instead.' });
  }

  await supabase.from('student_progress').upsert(
    {
      student_id: req.student.id,
      section_id: req.params.id,
      status: 'mastered',
      mastery_score: 1,
      last_updated: new Date().toISOString(),
    },
    { onConflict: 'student_id,section_id' }
  );

  res.json({ ok: true });
});

// Submit one checkpoint answer, get graded + routed by the adaptive engine.
app.post('/api/sections/:id/attempt', requireStudent, async (req, res) => {
  const { quizId, selectedIndex, responseTimeMs } = req.body;
  const sectionId = req.params.id;

  const { data: quizItem } = await supabase.from('quiz_bank').select('*').eq('id', quizId).single();
  if (!quizItem) return res.status(404).json({ error: 'Question not found' });

  const isCorrect = quizItem.correct_index === selectedIndex;

  await supabase.from('attempts').insert({
    student_id: req.student.id,
    quiz_id: quizId,
    selected_index: selectedIndex,
    is_correct: isCorrect,
    response_time_ms: responseTimeMs || null,
  });

  // Score this section so far (all attempts on questions belonging to this section).
  const { data: sectionQuizIds } = await supabase.from('quiz_bank').select('id').eq('section_id', sectionId);
  const ids = (sectionQuizIds || []).map((q) => q.id);
  const { data: allAttempts } = await supabase
    .from('attempts')
    .select('is_correct')
    .eq('student_id', req.student.id)
    .in('quiz_id', ids);

  const total = allAttempts?.length || 1;
  const correctCount = (allAttempts || []).filter((a) => a.is_correct).length;
  const scorePercent = Math.round((correctCount / total) * 100);
  const masteryScore = scorePercent / 100;

  const newStatus = masteryScore >= MASTERY_THRESHOLD ? 'mastered' : 'reinforced';
  await supabase.from('student_progress').upsert(
    {
      student_id: req.student.id,
      section_id: sectionId,
      status: newStatus,
      mastery_score: masteryScore,
      last_updated: new Date().toISOString(),
    },
    { onConflict: 'student_id,section_id' }
  );

  // Ask the adaptive engine what happens next (only once the section's quiz is complete).
  let decision = null;
  const { data: allSections } = await supabase.from('sections').select('*').order('sort_order');
  const orderedIndex = (allSections || []).findIndex((s) => s.id === sectionId);

  if (orderedIndex !== -1) {
    decision = await decideNextStep({
      studentId: req.student.id,
      sectionId,
      scorePercent,
      allSections,
      orderedIndex,
    });
  }

  res.json({ isCorrect, correctIndex: quizItem.correct_index, scorePercent, decision });
});

// ---------------------------------------------------------
// SATOSHI CHAT
// ---------------------------------------------------------
app.get('/api/sections/:id/chat', requireStudent, async (req, res) => {
  const { data } = await supabase
    .from('chat_log')
    .select('role, message, created_at')
    .eq('student_id', req.student.id)
    .eq('section_id', req.params.id)
    .order('created_at', { ascending: true });
  res.json({ messages: data || [] });
});

app.post('/api/sections/:id/chat', requireStudent, async (req, res) => {
  const { message } = req.body;
  const sectionId = req.params.id;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message required' });

  const { data: section } = await supabase.from('sections').select('title').eq('id', sectionId).single();

  await supabase.from('chat_log').insert({
    student_id: req.student.id,
    section_id: sectionId,
    role: 'student',
    message,
  });

  const reply = await satoshiChatReply({
    studentId: req.student.id,
    sectionId,
    sectionTitle: section?.title || 'this section',
    studentMessage: message,
  });

  await supabase.from('chat_log').insert({
    student_id: req.student.id,
    section_id: sectionId,
    role: 'satoshi',
    message: reply,
  });

  res.json({ reply });
});

// ---------------------------------------------------------
// ADMIN — student provisioning (Luthando / Sassa)
// ---------------------------------------------------------
// Only failed attempts (wrong admin key) count toward this limit —
// skipSuccessfulRequests means normal dashboard use (many successful
// calls per session) never gets throttled, only repeated wrong-key
// guesses do.
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many failed attempts — please wait a few minutes and try again.' },
});
app.use('/api/admin', adminLimiter);

app.post('/api/admin/students', requireAdmin, async (req, res) => {
  const { username, password, full_name, cohort } = req.body;
  if (!username || !password || !full_name) {
    return res.status(400).json({ error: 'username, password, full_name required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  const password_hash = bcrypt.hashSync(password, 10);
  const { data, error } = await supabase
    .from('students')
    .insert({ username, password_hash, full_name, cohort, created_by: 'admin' })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ id: data.id, username: data.username, full_name: data.full_name });
});

// Reset a student's password without touching Supabase directly —
// also invalidates any session they're currently logged into on a
// workstation, since JWTs are tied to nothing revocable, so a fresh
// password is the practical way to force a re-login.
app.patch('/api/admin/students/:id/password', requireAdmin, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  const password_hash = bcrypt.hashSync(password, 10);
  const { error } = await supabase
    .from('students')
    .update({ password_hash })
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

app.get('/api/admin/students', requireAdmin, async (req, res) => {
  const { data: students } = await supabase
    .from('students')
    .select('id, username, full_name, cohort, active, created_at')
    .order('created_at', { ascending: false });
  res.json(students || []);
});

app.get('/api/admin/students/:id/decisions', requireAdmin, async (req, res) => {
  const { data } = await supabase
    .from('ai_decisions')
    .select('*, from:sections!ai_decisions_from_section_id_fkey(number,title), to:sections!ai_decisions_to_section_id_fkey(number,title)')
    .eq('student_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(30);
  res.json(data || []);
});

// Full chapter/section tree — no student context, admin browsing only.
app.get('/api/admin/curriculum', requireAdmin, async (req, res) => {
  const { data: chapters } = await supabase.from('chapters').select('*').order('sort_order');
  const { data: sections } = await supabase.from('sections').select('*').order('sort_order');
  const tree = (chapters || []).map((ch) => ({
    ...ch,
    sections: (sections || []).filter((s) => s.chapter_id === ch.id),
  }));
  res.json({ chapters: tree });
});

// Per-section mastery for one student, for the admin mastery grid.
app.get('/api/admin/students/:id/progress', requireAdmin, async (req, res) => {
  const { data } = await supabase
    .from('student_progress')
    .select('section_id, status, mastery_score, attempts_count, last_updated')
    .eq('student_id', req.params.id);
  res.json(data || []);
});

// Full chat history for a student across every section, newest first.
app.get('/api/admin/students/:id/chat', requireAdmin, async (req, res) => {
  const { data } = await supabase
    .from('chat_log')
    .select('role, message, created_at, sections(number, title)')
    .eq('student_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(100);
  res.json(data || []);
});

const PORT = process.env.PORT || 3300;
app.listen(PORT, () => console.log(`ShalaKasi running on http://localhost:${PORT}`));
