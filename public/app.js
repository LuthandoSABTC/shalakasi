// public/app.js
const API = '';
let token = sessionStorage.getItem('shalakasi_token');
let student = JSON.parse(sessionStorage.getItem('shalakasi_student') || 'null');
let currentSectionId = null;
let currentQuiz = [];
let quizIndex = 0;
let bookCache = null;

function authHeaders() {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// ---------- VOICE (ShalaKasi read-aloud) ----------
const speechSupported = 'speechSynthesis' in window;

function splitIntoSentences(text) {
  const matches = text.match(/[^.!?]+[.!?]+["')\]]?|\s*[^.!?]+$/g);
  return (matches || [text]).map((s) => s.trim()).filter(Boolean);
}

function speakText(text, btn) {
  if (!speechSupported) return;
  if (btn && btn.dataset.speaking === 'true') {
    window.speechSynthesis.cancel();
    return;
  }
  window.speechSynthesis.cancel();
  const sentences = splitIntoSentences(stripHtmlForSpeech(text));
  if (!sentences.length) return;

  document.querySelectorAll('[data-speaking="true"]').forEach((b) => setSpeakingState(b, false));
  if (btn) setSpeakingState(btn, true);

  sentences.forEach((sentence, i) => {
    const utterance = new SpeechSynthesisUtterance(sentence);
    utterance.rate = 0.95;
    const isLast = i === sentences.length - 1;
    if (isLast) {
      utterance.onend = () => { if (btn) setSpeakingState(btn, false); };
      utterance.onerror = () => { if (btn) setSpeakingState(btn, false); };
    }
    window.speechSynthesis.speak(utterance);
  });
}

function setSpeakingState(btn, speaking) {
  btn.dataset.speaking = speaking ? 'true' : 'false';
  btn.classList.toggle('speaking', speaking);
  const stopIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
  const playIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M19 12a7 7 0 0 0-4-6.3M16 12a4 4 0 0 0-2-3.5"/></svg>';
  if (btn.classList.contains('listen-btn')) {
    btn.innerHTML = speaking ? `${stopIcon} Stop` : `${playIcon} Listen`;
  } else {
    btn.innerHTML = speaking ? stopIcon : playIcon;
  }
}

function stripHtmlForSpeech(html) {
  const div = document.createElement('div');
  div.innerHTML = html.replace(/<br\s*\/?>/gi, '. ');
  return div.textContent || div.innerText || '';
}

function stopSpeech() {
  if (speechSupported) window.speechSynthesis.cancel();
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
  stopPriceTicker();
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
  startPriceTicker();
}

// ---------- BTC/ZAR PRICE TICKER ----------
let priceTickerInterval = null;

function startPriceTicker() {
  fetchPrice();
  stopPriceTicker();
  priceTickerInterval = setInterval(fetchPrice, 60_000);
}

function stopPriceTicker() {
  if (priceTickerInterval) clearInterval(priceTickerInterval);
  priceTickerInterval = null;
}

async function fetchPrice() {
  const el = document.getElementById('price-ticker');
  if (!el) return;
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=zar&include_24hr_change=true');
    const data = await res.json();
    const price = data?.bitcoin?.zar;
    const change = data?.bitcoin?.zar_24h_change;
    if (!price) throw new Error('no price');

    const formattedPrice = 'R' + Math.round(price).toLocaleString('en-ZA');
    const changeClass = change >= 0 ? 'up' : 'down';
    const changeSign = change >= 0 ? '+' : '';
    const changeHtml = typeof change === 'number'
      ? `<span class="price-change ${changeClass}">${changeSign}${change.toFixed(1)}%</span>`
      : '';

    el.innerHTML = `<span class="btc-symbol">₿</span><span class="price-value">${formattedPrice}</span>${changeHtml}`;
  } catch (err) {
    el.innerHTML = `<span class="btc-symbol">₿</span><span class="price-value">—</span>`;
  }
}

document.querySelectorAll('.rail-btn').forEach((btn) => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

function showView(name) {
  stopSpeech();
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('.rail-btn').forEach((b) => b.classList.remove('active'));
  document.querySelector(`.rail-btn[data-view="${name}"]`).classList.add('active');

  const titles = { course: 'Course', book: '<b>The Book</b>', satoshi: 'Ask <b>ShalaKasi</b>', dashboard: '<b>Your Progress</b>' };
  document.getElementById('topbar-title').innerHTML = titles[name];

  if (name === 'satoshi') loadChat();
  if (name === 'dashboard') loadDashboard();
  if (name === 'book') loadBook();
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
      <p><b>ShalaKasi:</b> Take your time on this one — you can always ask me if something doesn't click.</p>
    </div>
    ${speechSupported ? '<button class="listen-btn" id="listen-btn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M19 12a7 7 0 0 0-4-6.3M16 12a4 4 0 0 0-2-3.5"/></svg> Listen</button>' : ''}
    <div class="body-text">${(data.section.content_md || 'Content for this section is being written by Sassa — check back soon, or ask ShalaKasi to walk you through it in the meantime.').replace(/\n/g, '<br>')}</div>
    <div id="live-widget-slot"></div>
    <div id="checkpoint-slot"></div>
  `;

  loadLiveBitcoinWidget(data.section.number);

  const listenBtn = document.getElementById('listen-btn');
  if (listenBtn) {
    listenBtn.addEventListener('click', () => {
      const text = data.section.content_md || '';
      speakText(`${data.section.title}. ${text}`, listenBtn);
    });
  }

  renderCheckpoint();
}

// ---------- LIVE BITCOIN NETWORK WIDGET (Chapter 9) ----------
const MEMPOOL_WIDGET_SECTIONS = { '9.3.2': 'blocks', '9.4': 'mempool', '9.5': 'both' };

async function loadLiveBitcoinWidget(sectionNumber) {
  const mode = MEMPOOL_WIDGET_SECTIONS[sectionNumber];
  const slot = document.getElementById('live-widget-slot');
  if (!mode || !slot) return;

  slot.innerHTML = `<div class="live-widget"><div class="live-widget-loading">Fetching live Bitcoin network data…</div></div>`;

  try {
    const calls = [];
    if (mode === 'blocks' || mode === 'both') {
      calls.push(fetch('https://mempool.space/api/blocks/tip/height').then((r) => r.text()));
      calls.push(fetch('https://mempool.space/api/blocks/tip/hash').then((r) => r.text()));
    }
    if (mode === 'mempool' || mode === 'both') {
      calls.push(fetch('https://mempool.space/api/mempool').then((r) => r.json()));
      calls.push(fetch('https://mempool.space/api/v1/fees/recommended').then((r) => r.json()));
    }

    const results = await Promise.all(calls);
    let height, hash, mempoolStats, fees;
    if (mode === 'blocks') [height, hash] = results;
    if (mode === 'mempool') [mempoolStats, fees] = results;
    if (mode === 'both') [height, hash, mempoolStats, fees] = results;

    let html = `<div class="live-widget">
      <div class="live-widget-head"><span class="live-dot"></span> Live from the Bitcoin network right now</div>
      <div class="live-widget-grid">`;

    if (height !== undefined) {
      html += `<div class="live-stat"><div class="live-stat-label">Current block height</div><div class="live-stat-value">${Number(height).toLocaleString()}</div><div class="live-stat-sub">${hash.slice(0, 16)}…</div></div>`;
    }
    if (mempoolStats) {
      html += `<div class="live-stat"><div class="live-stat-label">Transactions waiting in the mempool</div><div class="live-stat-value">${Number(mempoolStats.count).toLocaleString()}</div><div class="live-stat-sub">${(mempoolStats.vsize / 1_000_000).toFixed(1)} MB of pending data</div></div>`;
    }
    if (fees) {
      html += `<div class="live-stat"><div class="live-stat-label">Fee for next-block confirmation</div><div class="live-stat-value">${fees.fastestFee} sat/vB</div><div class="live-stat-sub">Economy: ${fees.economyFee} sat/vB</div></div>`;
    }

    html += `</div><div class="live-widget-note">This is real, live data — not a screenshot. Reload the page in a few minutes and these numbers will have changed.</div></div>`;
    slot.innerHTML = html;
  } catch (err) {
    slot.innerHTML = `<div class="live-widget"><div class="live-widget-loading">Couldn't reach mempool.space right now — this needs an internet connection. The lesson content above still explains the concept either way.</div></div>`;
  }
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
      <div class="checkpoint-head"><div class="checkpoint-label">Checkpoint · ${quizIndex + 1} of ${currentQuiz.length}</div></div>
      <div class="checkpoint-q">${q.question}</div>
      <div class="quiz-options">${q.options.map((opt, i) => `<div class="quiz-opt" data-index="${i}">${opt}</div>`).join('')}</div>
      <div id="decision-slot"></div>
    </div>`;

  document.querySelectorAll('.quiz-opt').forEach((opt) => {
    opt.addEventListener('click', () => submitAnswer(q.id, parseInt(opt.dataset.index, 10)));
  });
}

async function submitAnswer(quizId, selectedIndex) {
  document.querySelectorAll('.quiz-opt').forEach((o) => o.classList.add('disabled'));

  const res = await fetch(`/api/sections/${currentSectionId}/attempt`, {
    method: 'POST', headers: authHeaders(),
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
      <div class="decision-note">💡 <span><b>ShalaKasi:</b> ${data.decision.reasoning}</span></div>
      <button class="continue-btn" id="continue-btn">Continue</button>`;
    document.getElementById('continue-btn').addEventListener('click', loadNextSection);
  }
}

// ---------- BOOK (full curriculum reader) ----------
async function loadBook() {
  const el = document.getElementById('book-content');
  if (bookCache) { renderBook(bookCache); return; }

  el.innerHTML = `<p class="body-text">Loading the full Bitcoin Diploma…</p>`;
  const res = await fetch('/api/book', { headers: authHeaders() });
  if (res.status === 401) return forceLogout();
  const data = await res.json();
  bookCache = data;
  renderBook(data);
}

function renderBook(data) {
  const el = document.getElementById('book-content');

  const toc = data.chapters.map((ch) =>
    `<a href="#book-ch-${ch.number}">Chapter ${ch.number} — ${ch.title}</a>`
  ).join('');

  const chaptersHtml = data.chapters.map((ch) => `
    <div class="book-chapter" id="book-ch-${ch.number}">
      <div class="book-chapter-head">
        <div class="book-chapter-eyebrow">Chapter ${ch.number}</div>
        <div class="book-chapter-title">${ch.title}</div>
      </div>
      ${ch.sections.map((s) => `
        <div class="book-section">
          <div class="book-section-title"><span class="num">${s.number}</span> ${s.title}</div>
          ${s.activity_title ? `<div class="book-activity">✦ Activity: ${s.activity_title}</div>` : ''}
          <div class="book-body">${s.content_md ? s.content_md.replace(/\n/g, '<br>') : '<i style="color:var(--text-faint)">Content for this section is still being written.</i>'}</div>
        </div>
      `).join('')}
    </div>
  `).join('');

  el.innerHTML = `
    <div class="book-title">The Bitcoin Diploma</div>
    <div class="book-sub">The full course, start to finish — read ahead, jump around, or come back to anything you've already covered.</div>
    <div class="book-toc"><h3>Contents</h3>${toc}</div>
    ${chaptersHtml}
  `;
}

// ---------- SHALAKASI CHAT ----------
async function loadChat() {
  if (!currentSectionId) return;
  const res = await fetch(`/api/sections/${currentSectionId}/chat`, { headers: authHeaders() });
  const data = await res.json();
  const scroll = document.getElementById('chat-scroll');
  scroll.innerHTML = data.messages.map(renderMsg).join('') ||
    `<div class="msg from-satoshi">${avatarHtml()}<div><div class="msg-name">ShalaKasi</div><div class="msg-bubble">Hey! Ask me anything about this section.</div></div></div>`;
  scroll.scrollTop = scroll.scrollHeight;
}

function renderMsg(m) {
  const isSat = m.role === 'satoshi';
  const speakBtn = isSat && speechSupported
    ? `<button class="msg-speak-btn" data-text="${encodeURIComponent(m.message)}" title="Listen"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M19 12a7 7 0 0 0-4-6.3M16 12a4 4 0 0 0-2-3.5"/></svg></button>`
    : '';
  return `<div class="msg ${isSat ? 'from-satoshi' : 'from-student'}">
    ${isSat ? avatarHtml() : `<div class="msg-avatar">${(student.full_name || '?')[0]}</div>`}
    <div><div class="msg-name">${isSat ? 'ShalaKasi' : 'You'}${speakBtn}</div><div class="msg-bubble">${m.message}</div></div>
  </div>`;
}
function avatarHtml() {
  return `<div class="msg-avatar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0B0D10" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9 10.5c0-.6.5-1 1-1s1 .4 1 1M13 10.5c0-.6.5-1 1-1s1 .4 1 1"/><path d="M8.5 14.5c1 1 5 1 6 0"/></svg></div>`;
}

document.getElementById('chat-scroll').addEventListener('click', (e) => {
  const btn = e.target.closest('.msg-speak-btn');
  if (!btn) return;
  speakText(decodeURIComponent(btn.dataset.text), btn);
});

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
    <p class="dash-sub">${masteredSections} of ${totalSections} sections mastered · ShalaKasi is building this path as you go, not following a fixed order.</p>
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
