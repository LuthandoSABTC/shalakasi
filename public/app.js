// public/app.js
// sessionStorage (not localStorage) on purpose — these are shared
// kiosk workstations, the token should not survive a browser restart
// or persist for the next student who sits down.

const API = '';
let token = sessionStorage.getItem('shalakasi_token');
let student = JSON.parse(sessionStorage.getItem('shalakasi_student') || 'null');
let currentSectionId = null;
let currentQuiz = [];
let quizIndex = 0;

function authHeaders() {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// ---------- LOGIN ----------
document.getElementById('login-submit').addEventListener('click', doLogin);
document.getElementById('login-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doLogin();
});

async function doLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';

  if (!username || !password) {
    errEl.textContent = 'Enter your username and password.';
    return;
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Login failed.';
      return;
    }
    token = data.token;
    student = data.student;
    sessionStorage.setItem('shalakasi_token', token);
    sessionStorage.setItem('shalakasi_student', JSON.stringify(student));
    enterApp();
  } catch (err) {
    errEl.textContent = 'Could not reach the server. Check your connection.';
  }
}

document.getElementById('logout-btn').addEventListener('click', () => {
  sessionStorage.removeItem('shalakasi_token');
  sessionStorage.removeItem('shalakasi_student');
  token = null; student = null;
  document.getElementById('app').classList.remove('active');
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
});

// ---------- APP SHELL ----------
function enterApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').classList.add('active');
  document.getElementById('student-name').textContent = student.full_name;
  loadNextSection();
}

document.querySelectorAll('.rail-btn').forEach((btn) => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('.rail-btn').forEach((b) => b.classList.remove('active'));
  document.querySelector(`.rail-btn[data-view="${name}"]`).classList.add('active');

  const titles = { course: 'Course', satoshi: 'Ask <b>Satoshi</b>', dashboard: '<b>Your Progress</b>' };
  document.getElementById('topbar-title').innerHTML = titles[name];

  if (name === 'satoshi') loadChat();
  if (name === 'dashboard') loadDashboard();
}

document.getElementById('ask-satoshi-fab').addEventListener('click', () => showView('satoshi'));

// ---------- COURSE ----------
async function loadNextSection() {
  const res = await fetch('/api/curriculum', { headers: authHeaders() });
  if (res.status === 401) return forceLogout();
  const data = await res.json();

  let target = null;
  outer: for (const ch of data.chapters) {
    for (const s of ch.sections) {
      if (s.status !== 'mastered') { target = { ...s, chapterNumber: ch.number, chapterTitle: ch.title }; break outer; }
    }
  }

  if (!target) {
    document.getElementById('course-content').innerHTML = `
      <div class="crumb">All chapters complete</div>
      <h1 class="section-title">You've finished the Bitcoin Diploma 🎉</h1>
      <p class="body-text">Every section is mastered. Talk to Sassa about your certificate.</p>`;
    return;
  }

  loadSection(target.id, target.chapterNumber, target.chapterTitle);
}

async function loadSection(sectionId, chapterNumber, chapterTitle) {
  currentSectionId = sectionId;
  quizIndex = 0;

  const res = await fetch(`/api/sections/${sectionId}`, { headers: authHeaders() });
  if (res.status === 401) return forceLogout();
  const data = await res.json();
  currentQuiz = data.quiz || [];

  const el = document.getElementById('course-content');
  const ch = chapterNumber || data.section.chapters?.number;
  const chTitle = chapterTitle || data.section.chapters?.title;

  el.innerHTML = `
    <div class="crumb">Chapter ${ch} · ${chTitle} <span>· Section ${data.section.number}</span></div>
    <h1 class="section-title">${data.section.title}</h1>
    ${data.section.activity_title ? `<div class="activity-badge">✦ Activity: ${data.section.activity_title}</div>` : ''}
    <div class="satoshi-intro">
      <div class="satoshi-avatar"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0B0D10" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M9.5 10.8c0-.5.4-.9.9-.9s.9.4.9.9M12.7 10.8c0-.5.4-.9.9-.9s.9.4.9.9"/><path d="M9.5 14c.9.9 4.1.9 5 0"/></svg></div>
      <p><b>Satoshi:</b> Take your time on this one — you can always ask me if something doesn't click.</p>
    </div>
    <div class="body-text">${(data.section.content_md || 'Content for this section is being written by Sassa — check back soon, or ask Satoshi to walk you through it in the meantime.').replace(/\n/g, '<br>')}</div>
    <div id="checkpoint-slot"></div>
  `;

  renderCheckpoint();
}

function renderCheckpoint() {
  const slot = document.getElementById('checkpoint-slot');
  if (!currentQuiz.length) {
    slot.innerHTML = `<p class="no-quiz-note">No checkpoint questions yet for this section — Sassa is still writing this one. <button class="continue-btn" id="skip-continue">Continue anyway</button></p>`;
    document.getElementById('skip-continue')?.addEventListener('click', async () => {
      await fetch(`/api/sections/${currentSectionId}/complete`, { method: 'POST', headers: authHeaders() });
      loadNextSection();
    });
    return;
  }
  if (quizIndex >= currentQuiz.length) {
    slot.innerHTML = `<p class="no-quiz-note">Checkpoint complete.</p>`;
    return;
  }

  const q = currentQuiz[quizIndex];
  slot.innerHTML = `
    <div class="checkpoint-card">
      <div class="checkpoint-head">
        <div class="checkpoint-label">Checkpoint · ${quizIndex + 1} of ${currentQuiz.length}</div>
      </div>
      <div class="checkpoint-q">${q.question}</div>
      <div class="quiz-options">
        ${q.options.map((opt, i) => `<div class="quiz-opt" data-index="${i}">${opt}</div>`).join('')}
      </div>
      <div id="decision-slot"></div>
    </div>`;

  document.querySelectorAll('.quiz-opt').forEach((opt) => {
    opt.addEventListener('click', () => submitAnswer(q.id, parseInt(opt.dataset.index, 10)));
  });
}

async function submitAnswer(quizId, selectedIndex) {
  document.querySelectorAll('.quiz-opt').forEach((o) => o.classList.add('disabled'));

  const res = await fetch(`/api/sections/${currentSectionId}/attempt`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ quizId, selectedIndex, responseTimeMs: null }),
  });
  const data = await res.json();

  document.querySelectorAll('.quiz-opt').forEach((o) => {
    const idx = parseInt(o.dataset.index, 10);
    if (idx === data.correctIndex) o.classList.add('correct');
    else if (idx === selectedIndex) o.classList.add('incorrect');
  });

  quizIndex += 1;
  const decisionSlot = document.getElementById('decision-slot');

  if (quizIndex < currentQuiz.length) {
    decisionSlot.innerHTML = `<button class="continue-btn" id="next-q">Next question</button>`;
    document.getElementById('next-q').addEventListener('click', renderCheckpoint);
  } else if (data.decision) {
    decisionSlot.innerHTML = `
      <div class="decision-note">💡 <span><b>Satoshi:</b> ${data.decision.reasoning}</span></div>
      <button class="continue-btn" id="continue-btn">Continue</button>`;
    document.getElementById('continue-btn').addEventListener('click', loadNextSection);
  }
}

// ---------- SATOSHI CHAT ----------
async function loadChat() {
  if (!currentSectionId) return;
  const res = await fetch(`/api/sections/${currentSectionId}/chat`, { headers: authHeaders() });
  const data = await res.json();
  const scroll = document.getElementById('chat-scroll');
  scroll.innerHTML = data.messages.map(renderMsg).join('') ||
    `<div class="msg from-satoshi">${avatarHtml()}<div><div class="msg-name">Satoshi</div><div class="msg-bubble">Hey! Ask me anything about this section.</div></div></div>`;
  scroll.scrollTop = scroll.scrollHeight;
}

function renderMsg(m) {
  const isSat = m.role === 'satoshi';
  return `<div class="msg ${isSat ? 'from-satoshi' : 'from-student'}">
    ${isSat ? avatarHtml() : `<div class="msg-avatar">${(student.full_name || '?')[0]}</div>`}
    <div><div class="msg-name">${isSat ? 'Satoshi' : 'You'}</div><div class="msg-bubble">${m.message}</div></div>
  </div>`;
}
function avatarHtml() {
  return `<div class="msg-avatar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0B0D10" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9 10.5c0-.6.5-1 1-1s1 .4 1 1M13 10.5c0-.6.5-1 1-1s1 .4 1 1"/><path d="M8.5 14.5c1 1 5 1 6 0"/></svg></div>`;
}

document.getElementById('chat-send').addEventListener('click', sendChat);
document.getElementById('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

async function sendChat() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message || !currentSectionId) return;
  input.value = '';

  const scroll = document.getElementById('chat-scroll');
  scroll.insertAdjacentHTML('beforeend', renderMsg({ role: 'student', message }));
  scroll.scrollTop = scroll.scrollHeight;

  const res = await fetch(`/api/sections/${currentSectionId}/chat`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ message }),
  });
  const data = await res.json();
  scroll.insertAdjacentHTML('beforeend', renderMsg({ role: 'satoshi', message: data.reply }));
  scroll.scrollTop = scroll.scrollHeight;
}

// ---------- DASHBOARD ----------
async function loadDashboard() {
  const res = await fetch('/api/curriculum', { headers: authHeaders() });
  const data = await res.json();
  const el = document.getElementById('dashboard-content');

  const totalSections = data.chapters.reduce((n, c) => n + c.sections.length, 0);
  const masteredSections = data.chapters.reduce((n, c) => n + c.sections.filter((s) => s.status === 'mastered').length, 0);

  el.innerHTML = `
    <h1 class="dash-title">${student.full_name}'s progress</h1>
    <p class="dash-sub">${masteredSections} of ${totalSections} sections mastered · Satoshi is building this path as you go, not following a fixed order.</p>
    ${data.chapters.map((ch) => `
      <div class="chapter-card">
        <div class="chapter-card-head">
          <h3>Ch ${ch.number} · ${ch.title}</h3>
          <span>${ch.sections.filter((s) => s.status === 'mastered').length}/${ch.sections.length}</span>
        </div>
        <div class="chip-row">
          ${ch.sections.map((s) => `<div class="chip ${s.status}" title="${s.number} ${s.title} — ${s.status}">${s.number.split('.').pop()}</div>`).join('')}
        </div>
      </div>`).join('')}
  `;
}

// ---------- BOOT ----------
function forceLogout() {
  sessionStorage.clear(); token = null; student = null;
  document.getElementById('app').classList.remove('active');
  document.getElementById('login-screen').style.display = 'flex';
}

if (token && student) {
  enterApp();
}
