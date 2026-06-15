/**
 * Shared Assets Entry Point
 * Imports common styles, utilities, and components
 * Code-split via Vite for optimal caching
 */

// Shared styles (loaded once, cached)
import './styles.css';

// Shared utilities
export * from './utils.js';
export * from './constants.js';
