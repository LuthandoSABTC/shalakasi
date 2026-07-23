// public/admin.js
let adminKey = sessionStorage.getItem('shalakasi_admin_key');
let curriculumCache = null; // { chapters: [...] } — fetched once, reused per student
let currentDetailStudentId = null;

function adminHeaders() {
  return { 'x-admin-key': adminKey, 'Content-Type': 'application/json' };
}

// ---------- GATE ----------
document.getElementById('gate-submit').addEventListener('click', doGateCheck);
document.getElementById('gate-key').addEventListener('keydown', (e) => { if (e.key === 'Enter') doGateCheck(); });

async function doGateCheck() {
  const key = document.getElementById('gate-key').value.trim();
  const errEl = document.getElementById('gate-error');
  errEl.textContent = '';
  if (!key) { errEl.textContent = 'Enter the admin key.'; return; }

  adminKey = key;
  const res = await fetch('/api/admin/students', { headers: adminHeaders() });
  if (!res.ok) {
    errEl.textContent = 'Incorrect admin key.';
    adminKey = null;
    return;
  }
  sessionStorage.setItem('shalakasi_admin_key', key);
  enterAdmin();
}

document.getElementById('gate-logout').addEventListener('click', () => {
  sessionStorage.removeItem('shalakasi_admin_key');
  adminKey = null;
  document.getElementById('admin-app').classList.remove('active');
  document.getElementById('gate-screen').style.display = 'flex';
  document.getElementById('gate-key').value = '';
});

function enterAdmin() {
  document.getElementById('gate-screen').style.display = 'none';
  document.getElementById('admin-app').classList.add('active');
  loadStudents();
}

// ---------- ADD STUDENT ----------
document.getElementById('add-student-btn').addEventListener('click', async () => {
  const full_name = document.getElementById('new-fullname').value.trim();
  const username = document.getElementById('new-username').value.trim();
  const password = document.getElementById('new-password').value.trim();
  const cohort = document.getElementById('new-cohort').value.trim();
  const statusEl = document.getElementById('add-status');
  statusEl.className = 'add-status';
  statusEl.textContent = '';

  if (!full_name || !username || !password) {
    statusEl.className = 'add-status err';
    statusEl.textContent = 'Full name, username, and password are required.';
    return;
  }

  const res = await fetch('/api/admin/students', {
    method: 'POST', headers: adminHeaders(),
    body: JSON.stringify({ full_name, username, password, cohort }),
  });
  const data = await res.json();

  if (!res.ok) {
    statusEl.className = 'add-status err';
    statusEl.textContent = data.error || 'Could not create student.';
    return;
  }

  statusEl.className = 'add-status ok';
  statusEl.textContent = `Created login for ${data.full_name} (${data.username}).`;
  document.getElementById('new-fullname').value = '';
  document.getElementById('new-username').value = '';
  document.getElementById('new-password').value = '';
  document.getElementById('new-cohort').value = '';
  loadStudents();
});

// ---------- STUDENT LIST ----------
async function loadStudents() {
  const res = await fetch('/api/admin/students', { headers: adminHeaders() });
  const students = await res.json();
  const tbody = document.getElementById('student-rows');

  if (!students.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-note">No students yet — add one above.</td></tr>`;
    return;
  }

  tbody.innerHTML = students.map((s) => `
    <tr class="row-clickable" data-id="${s.id}" data-name="${escapeHtml(s.full_name)}" data-username="${escapeHtml(s.username)}">
      <td>${escapeHtml(s.full_name)}</td>
      <td><span class="pill">${escapeHtml(s.username)}</span></td>
      <td>${escapeHtml(s.cohort || '—')}</td>
      <td><span class="pill ${s.active ? 'active' : ''}">${s.active ? 'active' : 'inactive'}</span></td>
      <td>${new Date(s.created_at).toLocaleDateString()}</td>
    </tr>`).join('');

  document.querySelectorAll('.row-clickable').forEach((row) => {
    row.addEventListener('click', () => openDetail(row.dataset.id, row.dataset.name, row.dataset.username));
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ---------- DETAIL PANEL ----------
document.getElementById('detail-close').addEventListener('click', closeDetail);
document.getElementById('overlay').addEventListener('click', closeDetail);
document.getElementById('reset-password-btn').addEventListener('click', async () => {
  const newPassword = prompt('New password (minimum 8 characters):');
  if (!newPassword) return;
  if (newPassword.length < 8) { alert('Password must be at least 8 characters.'); return; }

  const res = await fetch(`/api/admin/students/${currentDetailStudentId}/password`, {
    method: 'PATCH', headers: adminHeaders(),
    body: JSON.stringify({ password: newPassword }),
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Could not reset password.'); return; }
  alert('Password reset. The student will need to use the new password on their next login.');
});
document.querySelectorAll('.detail-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.detail-tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.detail-section').forEach((s) => s.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('section-' + tab.dataset.tab).classList.add('active');
  });
});

function closeDetail() {
  document.getElementById('detail-panel').classList.remove('active');
  document.getElementById('overlay').classList.remove('active');
}

async function openDetail(studentId, fullName, username) {
  currentDetailStudentId = studentId;
  document.getElementById('detail-name').textContent = fullName;
  document.getElementById('detail-meta').textContent = `@${username}`;
  document.getElementById('detail-panel').classList.add('active');
  document.getElementById('overlay').classList.add('active');

  document.getElementById('section-mastery').innerHTML = `<p class="empty-note">Loading…</p>`;
  document.getElementById('section-decisions').innerHTML = `<p class="empty-note">Loading…</p>`;
  document.getElementById('section-chat').innerHTML = `<p class="empty-note">Loading…</p>`;

  if (!curriculumCache) {
    const cRes = await fetch('/api/admin/curriculum', { headers: adminHeaders() });
    curriculumCache = await cRes.json();
  }

  const [progressRes, decisionsRes, chatRes] = await Promise.all([
    fetch(`/api/admin/students/${studentId}/progress`, { headers: adminHeaders() }),
    fetch(`/api/admin/students/${studentId}/decisions`, { headers: adminHeaders() }),
    fetch(`/api/admin/students/${studentId}/chat`, { headers: adminHeaders() }),
  ]);
  const progress = await progressRes.json();
  const decisions = await decisionsRes.json();
  const chat = await chatRes.json();

  renderMastery(progress);
  renderDecisions(decisions);
  renderChat(chat);
}

function renderMastery(progress) {
  const bySection = Object.fromEntries(progress.map((p) => [p.section_id, p]));
  const el = document.getElementById('section-mastery');

  el.innerHTML = curriculumCache.chapters.map((ch) => `
    <div class="chapter-card">
      <div class="chapter-card-head">
        <h4>Ch ${ch.number} · ${escapeHtml(ch.title)}</h4>
        <span>${ch.sections.filter((s) => bySection[s.id]?.status === 'mastered').length}/${ch.sections.length}</span>
      </div>
      <div class="chip-row">
        ${ch.sections.map((s) => {
          const status = bySection[s.id]?.status || 'locked';
          return `<div class="chip ${status}" title="${s.number} ${escapeHtml(s.title)} — ${status}">${s.number.split('.').pop()}</div>`;
        }).join('')}
      </div>
    </div>`).join('');
}

function renderDecisions(decisions) {
  const el = document.getElementById('section-decisions');
  if (!decisions.length) {
    el.innerHTML = `<p class="empty-note">No adaptive routing decisions yet — this student hasn't completed a checkpoint.</p>`;
    return;
  }
  el.innerHTML = decisions.map((d) => `
    <div class="decision-item">
      <span class="dtype ${d.decision_type}">${d.decision_type}</span>
      <div class="reasoning">${escapeHtml(d.reasoning)}</div>
      <div class="from-to">${d.from ? `${d.from.number} ${d.from.title}` : '—'} → ${d.to ? `${d.to.number} ${d.to.title}` : '—'} · ${new Date(d.created_at).toLocaleString()}</div>
    </div>`).join('');
}

function renderChat(chat) {
  const el = document.getElementById('section-chat');
  if (!chat.length) {
    el.innerHTML = `<p class="empty-note">No chat messages yet.</p>`;
    return;
  }
  el.innerHTML = chat.map((c) => `
    <div class="chat-item ${c.role}">
      <div class="who">${c.role}${c.sections ? `<span class="section-tag">${c.sections.number} ${escapeHtml(c.sections.title)}</span>` : ''}</div>
      <div class="body">${escapeHtml(c.message)}</div>
    </div>`).join('');
}

// ---------- BOOT ----------
if (adminKey) {
  fetch('/api/admin/students', { headers: adminHeaders() }).then((res) => {
    if (res.ok) enterAdmin();
    else sessionStorage.removeItem('shalakasi_admin_key');
  });
}
