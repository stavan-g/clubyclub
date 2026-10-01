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

personaButtons.forEach((button) => {
  button.addEventListener('click', () => {
    personaButtons.forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    emailInput.placeholder = button.dataset.persona === 'hiring'
      ? 'you@school.edu'
      : 'student@school.edu';
  });
});

document.querySelector('[data-profile-cta]').addEventListener('click', () => {
  document.querySelector('#roles').scrollIntoView({ behavior: 'smooth' });
});

document.querySelectorAll('[data-role-cta]').forEach((button) => {
  button.addEventListener('click', () => {
    personaButtons.forEach((item) => item.classList.toggle('active', item.dataset.persona === 'applying'));
    emailInput.placeholder = 'student@school.edu';
    document.querySelector('#join').scrollIntoView({ behavior: 'smooth' });
  });
});

const signupForm = document.querySelector('[data-signup-form]');
const toast = document.querySelector('[data-toast]');
let toastTimer;

signupForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!signupForm.reportValidity()) return;

  signupForm.reset();
  toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 4200);
});
