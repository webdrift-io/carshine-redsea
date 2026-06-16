// ============================================================================
// CarShine Red Sea - Core Application
// Main entry point that initializes all modules
// ============================================================================

import './shared/styles.css';
import { initUI } from './ui/core.js';
import { initAnimations } from './ui/animations.js';
import { initBooking } from './features/booking-form.js';
import { initModals } from './ui/modals.js';
import { initOffer } from './features/offer-popup.js';
import { initLocation } from './features/location.js';
import { initBookingResult } from './features/booking-result.js';

// Get language from HTML attribute
const LANG = document.documentElement.lang || 'en';
const DIR = document.documentElement.dir || 'ltr';

// Initialize all modules
document.addEventListener('DOMContentLoaded', () => {
  initUI({ lang: LANG, dir: DIR });
  initModals();
  initBookingResult(); // Mounts the booking-result renderer into #bookingFormStatus (added by M0-004A) and exposes window.renderBookingState for the Hermes-owned submit handler.
  initBooking({ lang: LANG });
  initOffer({ lang: LANG });
  initLocation({ lang: LANG });
});

// Initialize Three.js hero after a short delay to ensure canvas is ready
// Loaded as a separate chunk for code splitting
setTimeout(() => {
  import('./ui/hero-three.js').then(({ initHero }) => {
    try {
      initHero();
      initAnimations();
    } catch (e) {
      console.warn('Hero scene initialization failed:', e);
    }
  });
}, 100);

// Handle page visibility for performance
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    window.dispatchEvent(new CustomEvent('app:pause'));
  } else {
    window.dispatchEvent(new CustomEvent('app:resume'));
  }
});

// Export for global access (needed by inline handlers)
window.getLiveLocation = (button) => import('./features/location.js').then(m => m.getLiveLocation(button));
window.showSuccessModal = (title, desc, btnText, paymentMethod) => import('./ui/modals.js').then(m => m.showSuccessModal(title, desc, btnText, paymentMethod));
window.closeSuccessModal = () => import('./ui/modals.js').then(m => m.closeSuccessModal());