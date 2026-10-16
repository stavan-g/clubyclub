const endpoint = window.CLUBYCLUB_CONFIG?.waitlistEndpoint?.trim();
const state = { token: localStorage.getItem('clubyclub_token') || '', email: localStorage.getItem('clubyclub_email') || '' };
const $ = (selector) => document.querySelector(selector);
const protectedSections = document.querySelectorAll('[data-protected]');
const toast = $('[data-toast]');
let roleCache = [];
let selectedRoleId = '';
let toastTimer;

function message(selector, text, error = false) {
  const element = $(selector);
  element.textContent = text;
  element.classList.toggle('error', error);
}
function showToast(title, text, error = false) {
  $('[data-toast-icon]').textContent = error ? '!' : '✓';
  $('[data-toast-title]').textContent = title;
  $('[data-toast-message]').textContent = text;
  toast.classList.toggle('error', error);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 4500);
}
async function call(action, values = {}) {
  if (!endpoint) throw new Error('The backend endpoint is missing.');
  const body = new URLSearchParams({ action, ...values });
  const response = await fetch(endpoint, { method:'POST', mode:'cors', headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'}, body });
  const result = await response.json();
  if (!result.ok) throw new Error(result.error || 'Request failed.');
  return result;
}
function setProtected(visible) {
  protectedSections.forEach((section) => { section.hidden = !visible; });
  $('[data-account-status]').textContent = visible ? 'Signed in' : 'Not signed in';
}
function fillProfile(profile) {
  if (!profile) return;
  const form = $('[data-profile-form]');
  Object.entries(profile).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value || ''; });
}
async function loadSession() {
  if (!state.token) { setProtected(false); return; }
  try {
    const result = await call('session_profile', { token: state.token });
    state.email = result.profile.email;
    fillProfile(result.profile);
    setProtected(true);
    loadMatches();
    loadDashboard();
  } catch (error) {
    localStorage.removeItem('clubyclub_token');
    localStorage.removeItem('clubyclub_email');
    state.token = '';
    setProtected(false);
  }
}

async function loadMatches() {
  const feed = $('[data-match-feed]');
  if (!feed || !state.token) return;

  try {
    const result = await call('matches_list', { token: state.token });
    const heading = $('[data-match-heading]');
    const intro = $('[data-match-intro]');

    if (result.needs_profile) {
      if (heading) heading.textContent = 'Complete your profile first.';
      if (intro) intro.textContent = 'Add your skills and short bio, then we can calculate meaningful fits.';
      feed.innerHTML = '<p class="empty-state">Save your profile to unlock matching.</p>';
      return;
    }

    if (result.mode === 'club') {
      if (heading) heading.textContent = 'Candidates for your roles.';
      if (intro) intro.textContent = 'These candidates are ranked from the skills and experience they added to Clubyclub.';
    } else {
      if (heading) heading.textContent = 'Roles that fit your signal.';
      if (intro) intro.textContent = 'Scores are based on overlap between your profile and each open role.';
    }

    if (!result.matches || !result.matches.length) {
      feed.innerHTML = '<p class="empty-state">' + escapeHtml(result.message || 'No matches yet. Add more detail to your profile or publish an open role.') + '</p>';
      return;
    }

    feed.innerHTML = result.matches.map((match) => {
      const title = result.mode === 'club'
        ? escapeHtml(match.display_name || 'Potential candidate')
        : escapeHtml(match.title);
      const subtitle = result.mode === 'club'
        ? escapeHtml((match.school || 'Student') + ' · for ' + match.role_title)
        : escapeHtml((match.club_name || 'Club') + ' · ' + (match.category || 'Open role'));
      const description = result.mode === 'club'
        ? escapeHtml(match.bio || match.skills || 'Profile details coming soon.')
        : escapeHtml(match.description || 'Role details coming soon.');
      const tags = (match.matched_skills || []).map((term) => '<span>' + escapeHtml(term) + '</span>').join('');
      return '<article class="match-card"><div class="match-card-top"><div><h3>' + title + '</h3><div class="feed-meta">' + subtitle + '</div></div><span class="match-score">' + escapeHtml(match.score) + '% fit</span></div><p>' + description + '</p>' + (tags ? '<div class="match-tags">' + tags + '</div>' : '') + '</article>';
    }).join('');
  } catch (error) {
    feed.innerHTML = '<p class="empty-state">Matching is temporarily unavailable. Try refresh.</p>';
  }
}

async function loadRoles() {
  const feed = $('[data-role-feed]');
  try {
    const response = await fetch(endpoint + '?action=roles_list');
    const result = await response.json();
    roleCache = result.roles || [];
    renderRoles();
  } catch (error) { feed.innerHTML = '<p class="empty-state">Roles are temporarily unavailable. Try refresh.</p>'; }
}
function renderRoles() {
  const feed = $('[data-role-feed]');
  const query = String($('[data-role-search']?.value || '').toLowerCase().trim();
  const category = $('[data-role-category']?.value || '');
  const roles = roleCache.filter((role) => {
    const haystack = [role.title, role.club_name, role.category, role.skills, role.location, role.description].join(' ').toLowerCase();
    return (!query || haystack.includes(query)) && (!category || role.category === category);
  });
  if (!roles.length) { feed.innerHTML = '<p class="empty-state">No roles match those filters.</p>'; return; }
  feed.innerHTML = roles.map((role) => {
    const deadline = role.deadline ? 'Apply by ' + escapeHtml(role.deadline) : 'Applications open';
    const skills = role.skills ? '<div class="role-tags">' + role.skills.split(',').map((skill) => '<span>' + escapeHtml(skill.trim()) + '</span>').join('') + '</div>' : '';
    return '<article class="feed-role"><div class="feed-role-top"><div><h3>' + escapeHtml(role.title) + '</h3><div class="feed-meta">' + escapeHtml(role.club_name) + ' · ' + escapeHtml(role.category) + '</div></div><span class="status-pill success">' + escapeHtml(role.status) + '</span></div><p>' + escapeHtml(role.description) + '</p><div class="feed-meta role-facts">' + escapeHtml(role.commitment || 'Flexible commitment') + ' · ' + escapeHtml(role.location || 'Location flexible') + ' · ' + deadline + '</div>' + skills + '<div class="role-actions"><button class="button button-small button-dark" type="button" data-role-details="' + escapeHtml(role.role_id) + '">View details</button><button class="button button-small button-primary" type="button" data-apply-role="' + escapeHtml(role.role_id) + '">Apply</button></div></article>';
  }).join('');
}
function showRoleDetails(roleId) {
  const role = roleCache.find((item) => item.role_id === roleId);
  if (!role) return;
  showToast(role.title, [role.club_name, role.location || 'Location flexible', role.skills || 'Skills flexible', role.deadline ? 'Deadline: ' + role.deadline : 'No deadline'].join(' · '));
}
async function applyToRole(roleId) {
  if (!state.token) { showToast('Sign in required', 'Verify your email before applying.', true); return; }
  const note = window.prompt('Add a short note for the club (optional):', '');
  if (note === null) return;
  try {
    const result = await call('application_create', { token: state.token, role_id: roleId, note });
    showToast('Application sent', result.message || 'The club received your application.');
    loadDashboard();
  } catch (error) { showToast('Application not sent', error.message, true); }
}
async function loadDashboard() {
  const feed = $('[data-dashboard-feed]');
  if (!feed || !state.token) return;
  try {
    const result = await call('dashboard_data', { token: state.token });
    $('[data-dashboard-heading]').textContent = result.mode === 'club' ? 'Your club workspace.' : 'Your candidate workspace.';
    const applications = result.applications || [];
    const roles = result.roles || [];
    feed.innerHTML = '<div class="dashboard-stat"><strong>' + (result.mode === 'club' ? roles.length : applications.length) + '</strong><span>' + (result.mode === 'club' ? 'open roles' : 'applications') + '</span></div><div class="dashboard-panel"><h3>' + (result.mode === 'club' ? 'Recent roles' : 'Application status') + '</h3>' + (result.mode === 'club' ? (roles.length ? roles.slice(0, 5).map((role) => '<p><strong>' + escapeHtml(role.title) + '</strong><br><span class="feed-meta">' + escapeHtml(role.club_name) + ' · ' + escapeHtml(role.status) + '</span></p>').join('') : '<p class="empty-state">Publish your first role above.</p>') : (applications.length ? applications.slice(0, 5).map((application) => '<p><strong>' + escapeHtml(application.role_title) + '</strong><br><span class="feed-meta">' + escapeHtml(application.club_name) + ' · ' + escapeHtml(application.status) + '</span></p>').join('') : '<p class="empty-state">You have not applied to a role yet.</p>')) + '</div><div class="dashboard-panel"><h3>' + (result.mode === 'club' ? 'Applicants' : 'Profile signal') + '</h3>' + (result.mode === 'club' ? '<p class="dashboard-number">' + (result.applicant_count || 0) + '</p><span class="feed-meta">applications received</span>' : '<p>' + escapeHtml(result.profile.skills || 'Add skills to improve your matches.') + '</p>') + '</div>';
  } catch (error) { feed.innerHTML = '<p class="empty-state">Dashboard is temporarily unavailable. Try refresh.</p>'; }
}
function escapeHtml(value) { return String(value || '').replace(/[&<>"]/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[character])); }

$('[data-start-form]').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  try {
    const result = await call('account_start', data);
    state.email = data.email.trim().toLowerCase();
    $('[data-verify-form]').hidden = false;
    message('[data-account-message]', result.message || 'Check your email for the verification code.');
  } catch (error) { message('[data-account-message]', error.message, true); }
});
$('[data-verify-form]').addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = event.currentTarget.elements.code.value.trim();
  try {
    const result = await call('account_verify', { email: state.email, code });
    state.token = result.token;
    localStorage.setItem('clubyclub_token', state.token);
    localStorage.setItem('clubyclub_email', state.email);
    fillProfile(result.profile);
    setProtected(true);
    message('[data-account-message]', 'Verified. Your profile and role tools are unlocked.');
    showToast('Account ready', 'Your Clubyclub workspace is unlocked.');
    loadMatches();
  } catch (error) { message('[data-account-message]', error.message, true); }
});
$('[data-profile-form]').addEventListener('submit', async (event) => {
  event.preventDefault();
  try { const result = await call('profile_save', { token: state.token, ...Object.fromEntries(new FormData(event.currentTarget)) }); fillProfile(result.profile); message('[data-profile-message]', 'Profile saved.'); showToast('Profile saved', 'Your information is ready for matching.'); loadMatches(); }
  catch (error) { message('[data-profile-message]', error.message, true); }
});
$('[data-role-form]').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await call('role_create', {
      token: state.token,
      ...Object.fromEntries(new FormData(form))
    });
    form.reset();
    message('[data-role-message]', 'Role published to the open-role feed.');
    showToast('Role published', 'Clubs can now start finding candidates.');
    loadRoles();
    loadMatches();
  }
  catch (error) { message('[data-role-message]', error.message, true); }
});
$('[data-refresh-roles]').addEventListener('click', loadRoles);
$('[data-refresh-matches]').addEventListener('click', loadMatches);
$('[data-refresh-dashboard]')?.addEventListener('click', loadDashboard);
$('[data-role-search]')?.addEventListener('input', renderRoles);
$('[data-role-category]')?.addEventListener('change', renderRoles);
$('[data-role-feed]')?.addEventListener('click', (event) => {
  const details = event.target.closest('[data-role-details]');
  const apply = event.target.closest('[data-apply-role]');
  if (details) showRoleDetails(details.dataset.roleDetails);
  if (apply) applyToRole(apply.dataset.applyRole);
});
loadSession();
loadRoles();