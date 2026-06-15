// ============================================================================
// CarShine Red Sea - Location Module
// Handles geolocation and map integration
// ============================================================================

export function getLiveLocation(button) {
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser.');
    return;
  }

  const originalHTML = button.innerHTML;
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
      button.innerHTML = originalHTML;
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

export function initLocation({ lang = 'en' } = {}) {
  // Location button handler
  document.querySelectorAll('.btn-location').forEach(button => {
    button.addEventListener('click', () => getLiveLocation(button));
  });
}
