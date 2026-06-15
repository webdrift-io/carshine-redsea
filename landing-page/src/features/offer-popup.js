// ============================================================================
// CarShine Red Sea - Offer Popup Module
// Handles the limited-time offer popup
// ============================================================================

export function initOffer({ lang = 'en' } = {}) {
  const offerPop = document.getElementById('offerPop');
  if (!offerPop) return;

  const hideOffer = () => {
    offerPop.classList.remove('is-visible');
    offerPop.setAttribute('aria-hidden', 'true');
    sessionStorage.setItem('carshineOfferDismissed', '1');
  };

  const showOffer = () => {
    if (!offerPop || sessionStorage.getItem('carshineOfferDismissed') === '1') return;
    offerPop.classList.add('is-visible');
    offerPop.setAttribute('aria-hidden', 'false');
    window.removeEventListener('scroll', handleOfferScroll);
  };

  function handleOfferScroll() {
    const pageHeight = document.documentElement.scrollHeight;
    const viewportMiddle = window.scrollY + window.innerHeight / 2;
    if (pageHeight > 0 && viewportMiddle / pageHeight >= 0.5) showOffer();
  }

  // Close button
  const closeBtn = offerPop.querySelector('.offer-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', hideOffer);
  }

  // "Later" button
  const laterBtn = offerPop.querySelector('.offer-later');
  if (laterBtn) {
    laterBtn.addEventListener('click', hideOffer);
  }

  // "Book now" button
  const bookBtn = offerPop.querySelector('.offer-book');
  if (bookBtn) {
    bookBtn.addEventListener('click', () => {
      offerPop.classList.remove('is-visible');
      offerPop.setAttribute('aria-hidden', 'true');
    });
  }

  // Scroll listener
  window.addEventListener('scroll', handleOfferScroll, { passive: true });
  
  // Check on load after delay
  window.addEventListener('load', () => {
    setTimeout(handleOfferScroll, 4200);
  }, { once: true });
}