/**
 * Shared Utilities
 * Common helper functions used across the application
 */

/**
 * Debounce function for performance-sensitive events
 */
export function debounce(fn, delay = 300) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Throttle function for scroll/resize handlers
 */
export function throttle(fn, limit = 100) {
  let inThrottle;
  return function (...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * IntersectionObserver helper for lazy loading
 */
export function observeElements(selector, callback, options = {}) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        callback(entry.target);
        observer.unobserve(entry.target);
      }
    });
  }, { rootMargin: '50px', threshold: 0.1, ...options });
  
  document.querySelectorAll(selector).forEach((el) => observer.observe(el));
  return observer;
}

/**
 * Format phone number for WhatsApp link
 */
export function formatWhatsAppLink(phone, message = '') {
  const cleanPhone = phone.replace(/[^\d]/g, '');
  return `https://wa.me/${cleanPhone}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
}

/**
 * Get current language from URL or HTML attribute
 */
export function getCurrentLang() {
  const path = window.location.pathname;
  if (path.startsWith('/ar/') || path === '/ar') return 'ar';
  if (path.startsWith('/de/') || path === '/de') return 'de';
  return document.documentElement.lang || 'en';
}

/**
 * Localized date formatting
 */
export function formatDate(date, lang = 'en') {
  const locales = { en: 'en-US', ar: 'ar-EG', de: 'de-DE' };
  return new Intl.DateTimeFormat(locales[lang] || 'en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  }).format(new Date(date));
}

/**
 * Build a safe CSS class name (BEM-style)
 */
export function bemClass(block, element, modifier) {
  let cls = block;
  if (element) cls += `__${element}`;
  if (modifier) cls += `--${modifier}`;
  return cls;
}
