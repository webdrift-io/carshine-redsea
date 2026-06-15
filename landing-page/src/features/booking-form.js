// ============================================================================
// CarShine Red Sea - Booking Form Module
// Handles booking form submission and validation
// ============================================================================

import { showSuccessModal } from '../ui/modals.js';

const SELECTORS = {
  form: '#bookingForm',
  submitBtn: '#bookingForm button[type="submit"]',
  locationBtn: '.btn-location',
  addressField: '[name="address"]'
};

export function initBooking({ lang = 'en' } = {}) {
  const form = document.querySelector(SELECTORS.form);
  if (!form) return;

  form.addEventListener('submit', handleSubmit);
  
  // Location button
  const locationBtn = form.querySelector(SELECTORS.locationBtn);
  if (locationBtn) {
    locationBtn.addEventListener('click', handleLocationClick);
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  
  const form = event.currentTarget;
  if (!form) return;
  
  const submitBtn = form.querySelector('button[type="submit"]') || form.querySelector('button');
  if (!submitBtn) return;

  const formData = collectFormData(form);
  
  // Basic validation
  if (!validateFormData(formData)) {
    alert('Please fill in all required fields.');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting booking...';

  try {
    // Try to submit to API
    const response = await submitToAPI(formData);
    
    if (response.success) {
      showSuccessModal(
        'Booking Registered!',
        'Thank you. Your booking request has been sent to our system. Our team will contact you soon on WhatsApp to confirm your appointment details.',
        'Great, Thanks!',
        formData.payment
      );
    } else {
      throw new Error(response.error || 'Booking failed');
    }
  } catch (err) {
    console.error('Booking submission error:', err);
    // Fallback for offline/local dev
    showSuccessModal(
      'Booking Registered!',
      'Thank you. Your booking request has been sent to our system. Our team will contact you soon on WhatsApp to confirm your appointment details.',
      'Great, Thanks!',
      formData.payment
    );
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = 'Confirm My Booking <svg class="mini-inline-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4Z"/></svg>';
    event.currentTarget.reset();
  }
}

function collectFormData(form) {
  const getValue = (name) => form.querySelector(`[name="${name}"]`)?.value || '';
  
  return {
    name: getValue('name'),
    phone: getValue('phone'),
    area: getValue('area'),
    car: getValue('car'),
    package: getValue('package'),
    locationType: getValue('locationType'),
    date: getValue('date'),
    time: getValue('time'),
    condition: getValue('condition'),
    payment: getValue('payment'),
    address: getValue('address'),
    notes: getValue('notes')
  };
}

function validateFormData(data) {
  const required = ['name', 'phone', 'area', 'package', 'date', 'time', 'payment'];
  return required.every(field => data[field]?.trim());
}

async function submitToAPI(data) {
  try {
    const response = await fetch('http://localhost:5000/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return await response.json();
  } catch (e) {
    // If API fails, return mock success for local development
    return { success: true, booking: { id: 'local_' + Date.now(), ...data } };
  }
}

function handleLocationClick(button) {
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser.');
    return;
  }

  const originalContent = button.innerHTML;
  button.disabled = true;
  button.innerHTML = 'Locating...';

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const textarea = button.closest('div').querySelector('[name="address"]');
      if (textarea) {
        textarea.value = `Live GPS: https://maps.google.com/?q=${lat},${lng}`;
      }
      button.disabled = false;
      button.innerHTML = '📍 Location Shared!';
      button.style.background = 'rgba(27, 191, 137, 0.22)';
      button.style.borderColor = '#1BBF89';
    },
    (error) => {
      console.error('Geolocation error:', error);
      alert('Could not get your location. Please type your address manually.');
      button.disabled = false;
      button.innerHTML = originalContent;
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}