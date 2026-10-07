const endpoint = window.CLUBYCLUB_CONFIG?.waitlistEndpoint?.trim();
const state = { token: localStorage.getItem('clubyclub_token') || '', email: localStorage.getItem('clubyclub_email') || '' };
const $ = (selector) => document.querySelector(selector);
const protectedSections = document.querySelectorAll('[data-protected]');
const toast = $('[data-toast]');
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
    if (!result.ok || !result.roles.length) { feed.innerHTML = '<p class="empty-state">No roles are published yet. Be the first club to post one.</p>'; return; }
    feed.innerHTML = result.roles.map((role) => '<article class="feed-role"><div class="feed-role-top"><div><h3>' + escapeHtml(role.title) + '</h3><div class="feed-meta">' + escapeHtml(role.club_name) + ' · ' + escapeHtml(role.category) + '</div></div><span class="status-pill success">' + escapeHtml(role.status) + '</span></div><p>' + escapeHtml(role.description) + '</p><p class="feed-meta">' + escapeHtml(role.commitment || 'Flexible commitment') + ' · ' + escapeHtml(role.location || 'Location flexible') + '</p></article>').join('');
  } catch (error) { feed.innerHTML = '<p class="empty-state">Roles are temporarily unavailable. Try refresh.</p>'; }
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
loadSession();
loadRoles();