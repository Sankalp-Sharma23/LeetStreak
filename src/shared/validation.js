/**
 * Input Validation & Sanitization
 * Prevents XSS and validates user inputs
 */

import { 
  escapeHtml as escapeHtmlUtil, 
  validateUsername as validateUsernameUtil,
  isValidUrl,
  RateLimiter
} from './security-utils.js';

// Re-export for convenience
export { isValidUrl, RateLimiter };

/**
 * Validate and normalize username
 * @param {string} username - Raw username input
 * @returns {string} Normalized username
 * @throws {Error} If username is invalid
 */
export function validateUsername(username) {
  const result = validateUsernameUtil(username);
  if (!result.valid) {
    throw new Error(result.error);
  }
  return result.username;
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
export function escapeHtml(text) {
  return escapeHtmlUtil(text);
}


