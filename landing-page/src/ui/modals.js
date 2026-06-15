// ============================================================================
// CarShine Red Sea - Modals Module
// Handles success modal and other modal interactions
// ============================================================================

let modalElement = null;

export function showSuccessModal(title, desc, btnText = 'Great, Thanks!', paymentMethod = '') {
  modalElement = modalElement || document.getElementById('successModal');
  if (!modalElement) return;

  const titleEl = modalElement.querySelector('.web-modal-title');
  const descEl = modalElement.querySelector('.web-modal-desc');
  const btnEl = modalElement.querySelector('.web-modal-btn');

  if (titleEl) titleEl.textContent = title;
  if (descEl) descEl.textContent = desc;
  if (btnEl) btnEl.textContent = btnText;

  // InstaPay details section
  const instapayDetails = modalElement.querySelector('.instapay-details');
  if (instapayDetails) {
    if (paymentMethod === 'InstaPay') {
      instapayDetails.style.display = 'block';
    } else {
      instapayDetails.style.display = 'none';
    }
  }

  modalElement.classList.add('is-active');
  document.body.style.overflow = 'hidden';

  // Focus management
  const btn = modalElement.querySelector('.web-modal-btn');
  if (btn) btn.focus();

  // Trap focus
  trapFocus(modalElement);
}

export function closeSuccessModal() {
  const modal = document.getElementById('successModal');
  if (modal) {
    modal.classList.remove('is-active');
    document.body.style.overflow = '';
  }
}

// Focus trapping for accessibility
function trapFocus(element) {
  const focusableElements = element.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (!focusableElements.length) return;

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  function handleTab(e) {
    if (e.key !== 'Tab') return;

    if (e.shiftKey) {
      if (document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      }
    } else {
      if (document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    }
  }

  element.addEventListener('keydown', handleTab);
  element._focusTrapHandler = handleTab;

  // Cleanup on close
  const closeHandler = () => {
    element.removeEventListener('keydown', handleTab);
    element.removeEventListener('click', closeHandler);
  };
  element.addEventListener('click', closeHandler);
}

// Initialize modal event listeners
export function initModals() {
  const modal = document.getElementById('successModal');
  if (!modal) return;

  // Close button
  const closeBtn = modal.querySelector('.web-modal-btn, .modal-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeSuccessModal);
  }

  // Close on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeSuccessModal();
  });

  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSuccessModal();
  });

  // Expose globally for inline handlers
  window.showSuccessModal = showSuccessModal;
  window.closeSuccessModal = closeSuccessModal;
  }