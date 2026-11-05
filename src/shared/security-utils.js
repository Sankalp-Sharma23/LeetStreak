/**
 * Security Utilities
 * Comprehensive security helpers for sanitization, validation, and encryption
 */

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
export function escapeHtml(text) {
  if (typeof text !== 'string') return text;
  
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
    '/': '&#x2F;'
  };
  return text.replace(/[&<>"'/]/g, m => map[m]);
}

/**
 * Sanitize text for safe HTML insertion
 * More aggressive than escapeHtml - strips all HTML tags
 * @param {string} text - Text to sanitize
 * @returns {string} Sanitized text
 */
export function sanitizeText(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/<[^>]*>/g, '').trim();
}

/**
 * Validate URL for security
 * @param {string} url - URL to validate
 * @param {Array<string>} allowedProtocols - Allowed protocols (default: ['https:'])
 * @param {Array<string>} allowedHosts - Allowed hosts (optional)
 * @returns {boolean} True if valid
 */
export function isValidUrl(url, allowedProtocols = ['https:'], allowedHosts = null) {
  try {
    const parsed = new URL(url);
    
    // Check protocol
    if (!allowedProtocols.includes(parsed.protocol)) {
      return false;
    }
    
    // Check host if specified
    if (allowedHosts && !allowedHosts.includes(parsed.hostname)) {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
}



/**
 * Validate username
 * @param {string} username - Username to validate
 * @param {number} minLength - Minimum length (default: 1)
 * @param {number} maxLength - Maximum length (default: 50)
 * @returns {object} { valid: boolean, error: string }
 */
export function validateUsername(username, minLength = 1, maxLength = 50) {
  if (!username || typeof username !== 'string') {
    return { valid: false, error: 'Username is required' };
  }
  
  username = username.trim();
  
  if (username.length < minLength || username.length > maxLength) {
    return { valid: false, error: `Username must be ${minLength}-${maxLength} characters` };
  }
  
  // Only allow alphanumeric, underscore, hyphen
  const usernameRegex = /^[a-zA-Z0-9_-]+$/;
  if (!usernameRegex.test(username)) {
    return { valid: false, error: 'Username contains invalid characters' };
  }
  
  return { valid: true, username: username.toLowerCase() };
}



/**
 * Rate limiter class for API calls
 */
export class RateLimiter {
  constructor(maxCalls, windowMs) {
    this.maxCalls = maxCalls;
    this.windowMs = windowMs;
    this.calls = [];
  }

  /**
   * Check if call is allowed
   * @returns {boolean} True if allowed
   */
  isAllowed() {
    const now = Date.now();
    
    // Remove old calls outside the window
    this.calls = this.calls.filter(timestamp => now - timestamp < this.windowMs);
    
    // Check if under limit
    if (this.calls.length < this.maxCalls) {
      this.calls.push(now);
      return true;
    }
    
    return false;
  }

  /**
   * Get time until next call is allowed
   * @returns {number} Milliseconds until next call
   */
  getTimeUntilReset() {
    if (this.calls.length === 0) return 0;
    
    const now = Date.now();
    const oldestCall = this.calls[0];
    const timeUntilReset = this.windowMs - (now - oldestCall);
    
    return Math.max(0, timeUntilReset);
  }
}

/**
 * Encryption utilities for sensitive data
 */
export class SecureStorage {
  /**
   * Derive encryption key from password
   * @param {string} password - Password to derive key from
   * @param {Uint8Array} salt - Salt for key derivation
   * @returns {Promise<CryptoKey>} Derived key
   */
  static async deriveKey(password, salt) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypt data
   * @param {string} data - Data to encrypt
   * @param {string} password - Password for encryption
   * @returns {Promise<string>} Base64 encoded encrypted data
   */
  static async encrypt(data, password) {
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const key = await this.deriveKey(password, salt);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encoder.encode(data)
    );

    // Combine salt + iv + encrypted data
    const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(encrypted), salt.length + iv.length);

    // Convert to base64
    return btoa(String.fromCharCode(...combined));
  }

  /**
   * Decrypt data
   * @param {string} encryptedData - Base64 encoded encrypted data
   * @param {string} password - Password for decryption
   * @returns {Promise<string>} Decrypted data
   */
  static async decrypt(encryptedData, password) {
    const decoder = new TextDecoder();
    
    // Decode from base64
    const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
    
    // Extract salt, iv, and encrypted data
    const salt = combined.slice(0, 16);
    const iv = combined.slice(16, 28);
    const encrypted = combined.slice(28);

    const key = await this.deriveKey(password, salt);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encrypted
    );

    return decoder.decode(decrypted);
  }
}

/**
 * Safe DOM element creation with text content
 * @param {string} tag - HTML tag name
 * @param {string} text - Text content (will be escaped)
 * @param {Object} attributes - Element attributes
 * @returns {HTMLElement} Created element
 */
export function createSafeElement(tag, text = '', attributes = {}) {
  const element = document.createElement(tag);
  
  // Set text content (automatically escapes)
  if (text) {
    element.textContent = text;
  }
  
  // Set attributes safely
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'style' && typeof value === 'object') {
      Object.assign(element.style, value);
    } else if (key.startsWith('on')) {
      // Don't allow inline event handlers via attributes
      console.warn(`Attempted to set inline event handler: ${key}`);
    } else {
      element.setAttribute(key, value);
    }
  }
  
  return element;
}

/**
 * Validate and sanitize JSON input
 * @param {string} jsonString - JSON string to parse
 * @param {Object} schema - Optional schema to validate against
 * @returns {object} { valid: boolean, data: any, error: string }
 */
export function safeJsonParse(jsonString, schema = null) {
  try {
    const data = JSON.parse(jsonString);
    
    // Basic type validation if schema provided
    if (schema) {
      for (const [key, expectedType] of Object.entries(schema)) {
        if (!(key in data)) {
          return { valid: false, error: `Missing required field: ${key}` };
        }
        
        const actualType = typeof data[key];
        if (actualType !== expectedType) {
          return { 
            valid: false, 
            error: `Invalid type for ${key}: expected ${expectedType}, got ${actualType}` 
          };
        }
      }
    }
    
    return { valid: true, data };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Check if origin is trusted
 * @param {string} origin - Origin to check
 * @returns {boolean} True if trusted
 */
export function isTrustedOrigin(origin) {
  const trustedOrigins = [
    'https://leetcode.com',
    'https://supabase.com',
    'chrome-extension://' // For extension pages
  ];
  
  return trustedOrigins.some(trusted => origin.startsWith(trusted));
}

/**
 * Generate secure random string
 * @param {number} length - Length of string
 * @returns {string} Random string
 */
export function generateSecureRandom(length = 32) {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}
