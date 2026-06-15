// ============================================================================
// CarShine Red Sea - Core UI Module
// Handles navigation, menu, language, scroll state, and base interactions
// ============================================================================

const SELECTORS = {
  topbar: '#topbar',
  loader: '#loader',
  menuToggle: '#menuToggle',
  megaMenu: '#megaMenu',
  languageSelect: '#languageSelect',
  menuLinks: '#megaMenu a',
  faqButtons: '.faq-button',
  sliderButtons: '[data-slide-prev], [data-slide-next]',
  joinForm: '.join-form'
};

function initUI({ lang = 'en', dir = 'ltr' } = {}) {
  const topbar = document.querySelector(SELECTORS.topbar);
  const loader = document.querySelector(SELECTORS.loader);
  const menuToggle = document.querySelector(SELECTORS.menuToggle);
  const megaMenu = document.querySelector(SELECTORS.megaMenu);
  const languageSelect = document.querySelector(SELECTORS.languageSelect);
  const menuLinks = megaMenu?.querySelectorAll('a') || [];

  function finishLoader() {
    if (!loader) {
      document.body.classList.remove('is-loading');
      return;
    }
    loader.classList.add('is-done');
    document.body.classList.remove('is-loading');
  }

  // Scroll state for topbar
  function setScrolledState() {
    if (topbar) {
      topbar.classList.toggle('is-scrolled', window.scrollY > 24);
    }
  }

  // Menu management
  function closeMenu() {
    if (!megaMenu || !menuToggle) return;
    menuToggle.classList.remove('is-active');
    menuToggle.setAttribute('aria-expanded', 'false');
    megaMenu.classList.remove('is-open');
    megaMenu.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('menu-open');
  }

  function toggleMenu() {
    if (!megaMenu || !menuToggle) return;
    const isOpen = megaMenu.classList.toggle('is-open');
    menuToggle.classList.toggle('is-active', isOpen);
    menuToggle.setAttribute('aria-expanded', String(isOpen));
    megaMenu.setAttribute('aria-hidden', String(!isOpen));
    document.body.classList.toggle('menu-open', isOpen);
  }

  // Language selector
  if (languageSelect) {
    languageSelect.addEventListener('change', (event) => {
      window.location.assign(event.currentTarget.value);
    });
  }

  // Menu link clicks - close menu on navigation
  menuLinks.forEach((link) => {
    link.addEventListener('click', closeMenu);
  });

  // Keyboard navigation
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });

  // Click outside to close menu
  document.addEventListener('click', (event) => {
    if (!megaMenu?.classList.contains('is-open')) return;
    if (megaMenu.contains(event.target) || menuToggle?.contains(event.target)) return;
    closeMenu();
  });

  // Scroll listener for topbar state
  window.addEventListener('scroll', setScrolledState, { passive: true });

  // Initialize scrolled state
  setScrolledState();
  window.setTimeout(finishLoader, 2600);

  // Initialize sliders
  initSliders();

  // Initialize FAQ
  initFAQ();

  // Initialize join form
  initJoinForm();

  // Return public API
  return {
    closeMenu,
    toggleMenu,
    setScrolledState
  };
}

function initSliders() {
  document.querySelectorAll(SELECTORS.sliderButtons).forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.slidePrev || button.dataset.slideNext;
      const slider = document.querySelector(`[data-slider="${key}"]`);
      if (!slider) return;
      const direction = button.dataset.slideNext ? 1 : -1;
      slider.scrollBy({
        left: direction * Math.max(280, slider.clientWidth * 0.72),
        behavior: 'smooth'
      });
    });
  });
}

function initFAQ() {
  document.querySelectorAll(SELECTORS.faqButtons).forEach((button) => {
    button.addEventListener('click', () => {
      const item = button.closest('.faq-item');
      if (!item) return;
      const isOpen = item.classList.toggle('is-open');
      button.setAttribute('aria-expanded', String(isOpen));
      const icon = item.querySelector('.faq-icon');
      if (icon) icon.textContent = isOpen ? '−' : '+';
    });
  });
}

function initJoinForm() {
  const form = document.querySelector(SELECTORS.joinForm);
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Sending...';

    // Simulate API call
    await new Promise(r => setTimeout(r, 800));

    btn.disabled = false;
    btn.textContent = 'Send information';
    form.reset();

    // Show success modal
    const { showSuccessModal } = await import('../ui/modals.js');
    showSuccessModal(
      'Application Received!',
      'Thank you for your interest in joining CarShine Red Sea. We have received your details and we will contact you soon on WhatsApp.'
    );
  });
}

export { initUI };
