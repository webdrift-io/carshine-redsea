/**
 * Shared Constants
 * Configuration values used across all landing page languages
 */

export const APP_CONFIG = {
  name: 'Carshine Redsea',
  displayPhone: '01555567205',
  phone: '+201555567205',
  whatsapp: '201555567205',
  instapayMobile: '01555567205',
  email: 'booking@carshineredsea.com',
  apiUrl: 'https://api.carshineredsea.com',
  apiEndpoint: '/api',
  version: '1.0.0',
  buildTime: new Date().toISOString()
};

export const AREAS = ['El Gouna', 'Hurghada', 'Sahl Hasheesh'];

export const PACKAGES = [
  { id: 'trial', price: 150, label: 'Trial Wash', duration: '1 wash' },
  { id: 'smart', price: 300, label: 'Smart Plan', duration: '3 washes/month' },
  { id: 'premium', price: 500, label: 'Premium Plan', duration: '5 washes/month' }
];

export const PAYMENT_METHODS = [
  'Cash', 'InstaPay', 'Vodafone Cash', 'Orange Cash', 'Fawry', 'Bank Transfer'
];

export const LANGUAGES = [
  { code: 'en', label: 'English', dir: 'ltr' },
  { code: 'ar', label: 'العربية', dir: 'rtl' },
  { code: 'de', label: 'Deutsch', dir: 'ltr' }
];

export const DEFAULT_LANG = 'en';
