// ============================================================================
// CarShine Red Sea - Animations Module
// GSAP ScrollTrigger animations for scroll-based effects
// ============================================================================

let gsapInitialized = false;

export function initAnimations() {
  if (typeof window.gsap === 'undefined' || typeof window.ScrollTrigger === 'undefined') {
    console.warn('GSAP or ScrollTrigger not loaded, skipping animations');
    return;
  }

  if (gsapInitialized) return;
  gsapInitialized = true;

  const gsap = window.gsap;
  gsap.registerPlugin(ScrollTrigger);

  // Fade-in animations for content sections
  const motionItems = gsap.utils.toArray([
    '.mini-head', '.way-panel', '.vision-card', '.mini-step',
    '.eco-main', '.eco-panel', '.mini-feature', '.mini-package',
    '.gallery-slide', '.team-card', '.testimonial-slide',
    '.area-card', '.mini-form', '.faq-item', '.future-card',
    '.mini-footer', '.hero-content', '.hero-title', '.hero-copy',
    '.hero-actions', '.hero-steps', '.hero-benefits',
    '.mini-band', '.section-pill', '.mini-title', '.mini-copy'
  ]);

  motionItems.forEach((item, index) => {
    // Skip if already animated
    if (item.classList.contains('motion-item')) return;
    item.classList.add('motion-item');

    gsap.from(item, {
      opacity: 0,
      y: 42,
      scale: 0.985,
      duration: 0.8,
      delay: (index % 3) * 0.035,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: item,
        start: 'top 88%',
        once: true
      }
    });
  });

  // Parallax effects for larger elements
  gsap.utils.toArray('.benefit-road, .redsea-map, .eco-main, .hero-canvas').forEach((item) => {
    gsap.to(item, {
      y: -24,
      ease: 'none',
      scrollTrigger: {
        trigger: item,
        start: 'top bottom',
        end: 'bottom top',
        scrub: 0.8
      }
    });
  });

  // Hero content animation on load
  animateHeroOnLoad();
}

function animateHeroOnLoad() {
  const gsap = window.gsap;
  const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

  // Hero title
  tl.from('.hero-title', {
    opacity: 0,
    y: 30,
    duration: 1,
    ease: 'power3.out'
  })
  .from('.hero-copy', {
    opacity: 0,
    y: 20,
    duration: 0.8
  }, '-=0.6')
  .from('.hero-actions', {
    opacity: 0,
    y: 20,
    duration: 0.8
  }, '-=0.5')
  .from('.hero-steps', {
    opacity: 0,
    y: 20,
    duration: 0.8
  }, '-=0.4')
  .from('.hero-benefits', {
    opacity: 0,
    y: 20,
    duration: 0.8
  }, '-=0.3');

  // Stagger hero steps
  gsap.from('.hero-step', {
    opacity: 0,
    x: -30,
    duration: 0.6,
    stagger: 0.15,
    ease: 'power3.out',
    delay: 1
  });

  // Stagger hero benefits
  gsap.from('.hero-benefits span', {
    opacity: 0,
    y: 15,
    duration: 0.5,
    stagger: 0.08,
    ease: 'power2.out',
    delay: 1.2
  });
}

// Utility for reduced motion preference
export function respectsReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Cleanup ScrollTrigger instances
export function killAllScrollTriggers() {
  if (window.ScrollTrigger) {
    ScrollTrigger.getAll().forEach(st => st.kill());
  }
}