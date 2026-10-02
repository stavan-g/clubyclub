const header = document.querySelector('[data-header]');
const menuToggle = document.querySelector('[data-menu-toggle]');
const mobileMenu = document.querySelector('[data-mobile-menu]');
const year = document.querySelector('[data-year]');

year.textContent = new Date().getFullYear();

window.addEventListener('scroll', () => {
  header.classList.toggle('scrolled', window.scrollY > 24);
}, { passive: true });

menuToggle.addEventListener('click', () => {
  const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
  menuToggle.setAttribute('aria-expanded', String(!isOpen));
  menuToggle.setAttribute('aria-label', isOpen ? 'Open menu' : 'Close menu');
  mobileMenu.classList.toggle('open', !isOpen);
  document.body.classList.toggle('menu-open', !isOpen);
});

mobileMenu.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Open menu');
    mobileMenu.classList.remove('open');
    document.body.classList.remove('menu-open');
  });
});

const revealObserver = new IntersectionObserver((entries, observer) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('in-view');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.13 });

document.querySelectorAll('.reveal').forEach((element) => revealObserver.observe(element));

const filterButtons = document.querySelectorAll('[data-filter]');
const roleRows = document.querySelectorAll('[data-category]');

filterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    filterButtons.forEach((item) => {
      item.classList.remove('active');
      item.setAttribute('aria-selected', 'false');
    });

    button.classList.add('active');
    button.setAttribute('aria-selected', 'true');
    const filter = button.dataset.filter;

    roleRows.forEach((row) => {
      row.classList.toggle('is-hidden', filter !== 'all' && row.dataset.category !== filter);
    });
  });
});

const personaButtons = document.querySelectorAll('[data-persona]');
const emailInput = document.querySelector('#email');
const roleChoice = document.querySelector('[data-role-choice]');
const roleSelect = document.querySelector('#role');

function setPersona(persona) {
  personaButtons.forEach((item) => item.classList.toggle('active', item.dataset.persona === persona));
  emailInput.placeholder = 'you@example.com';
  roleChoice.hidden = persona !== 'find_role';
  roleSelect.required = persona === 'find_role';

  if (persona !== 'find_role') roleSelect.value = '';
}

personaButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setPersona(button.dataset.persona);
  });
});

document.querySelector('[data-profile-cta]').addEventListener('click', () => {
  document.querySelector('#roles').scrollIntoView({ behavior: 'smooth' });
});

document.querySelectorAll('[data-role-cta]').forEach((button) => {
  button.addEventListener('click', () => {
    setPersona('find_role');
    roleSelect.value = button.dataset.role;
    document.querySelector('#join').scrollIntoView({ behavior: 'smooth' });
  });
});

const signupForm = document.querySelector('[data-signup-form]');
const toast = document.querySelector('[data-toast]');
const toastIcon = document.querySelector('[data-toast-icon]');
const toastTitle = document.querySelector('[data-toast-title]');
const toastMessage = document.querySelector('[data-toast-message]');
const submitButton = document.querySelector('[data-submit-button]');
let toastTimer;

function showToast({ title, message, error = false }) {
  toastIcon.textContent = error ? '!' : '✓';
  toastTitle.textContent = title;
  toastMessage.textContent = message;
  toast.classList.toggle('error', error);
  toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 4800);
}

signupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!signupForm.reportValidity()) return;

  const endpoint = window.CLUBYCLUB_CONFIG?.waitlistEndpoint?.trim();
  if (!endpoint) {
    showToast({
      title: 'The signup form is not connected yet.',
      message: 'Add the Google Apps Script URL in config.js before launch.',
      error: true,
    });
    return;
  }

  const activePersona = document.querySelector('[data-persona].active');
  const payload = new URLSearchParams({
    email: emailInput.value.trim(),
    intent: activePersona?.dataset.persona || 'waitlist',
    role: roleSelect.value,
    client_time: new Date().toISOString(),
    user_agent: navigator.userAgent,
    company: signupForm.elements.company.value,
  });

  submitButton.disabled = true;
  submitButton.firstChild.textContent = 'Saving… ';

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: payload,
    });
    const result = await response.json();

    if (result.status === 'duplicate_24h') {
      showToast({
        title: 'You’re already on the list.',
        message: 'We already have this email for that role from the last 24 hours.',
      });
      return;
    }

    if (result.status === 'email_sent') {
      signupForm.reset();
      showToast({
        title: 'You’re on the list.',
        message: 'Your signup was saved. Check your inbox for confirmation.',
      });
      return;
    }

    if (['quota_reserved_for_summary', 'quota_exceeded', 'email_failed', 'sender_mismatch'].includes(result.status)) {
      signupForm.reset();
      showToast({
        title: 'Your signup was saved.',
        message: 'We could not send the confirmation email right now, but your place was saved.',
      });
      return;
    }

    if (['email_invalid', 'invalid_intent', 'invalid_role'].includes(result.status)) {
      showToast({
        title: 'Please check your details.',
        message: result.status === 'email_invalid' ? 'Enter a valid email address and try again.' : 'Please choose a valid signup option.',
        error: true,
      });
      return;
    }

    if (result.status === 'spam_blocked') {
      showToast({
        title: 'We couldn’t save that signup.',
        message: 'Please try again without filling hidden fields.',
        error: true,
      });
      return;
    }

    showToast({
      title: 'We couldn’t confirm your signup.',
      message: 'Please try again or email hello@clubyclub.com.',
      error: true,
    });
  } catch (error) {
    showToast({
      title: 'We couldn’t save your signup.',
      message: 'Please try again in a moment or email hello@clubyclub.com.',
      error: true,
    });
  } finally {
    submitButton.disabled = false;
    submitButton.firstChild.textContent = 'Save my spot ';
  }
});
