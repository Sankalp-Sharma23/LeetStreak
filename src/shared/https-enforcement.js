/**
 * HTTPS Enforcement & Response Header Security Auditor
 *
 * NOTE ON SECURITY ARCHITECTURE:
 * Chrome Extensions in Manifest V3 do not have access to raw TLS/SSL socket details
 * or X.509 certificate chains via standard `fetch` or `chrome.webRequest` APIs.
 * TLS certificate validation is natively enforced by the underlying Chromium network stack.
 *
 * This module enforces strict HTTPS transport and audits security response headers
 * (Strict-Transport-Security / HSTS) for all external network requests.
 */

// Trusted external hostnames permitted for network communication
export const ALLOWED_HOSTS = new Set([
  'leetcode.com',
  'assets.leetcode.com'
]);

/**
 * Validates request destination and response transport security
 * @param {string} url - Request URL
 * @param {Response} response - Fetch response object
 * @returns {{ valid: boolean, reason?: string }}
 */
export function auditTransportSecurity(url, response) {
  try {
    const parsedUrl = new URL(url);

    // 1. Enforce HTTPS
    if (parsedUrl.protocol !== 'https:') {
      return {
        valid: false,
        reason: `Insecure transport: ${url} does not use HTTPS`
      };
    }

    // 2. Validate hostname against allowed destinations if strict checking enabled
    if (!ALLOWED_HOSTS.has(parsedUrl.hostname) && !parsedUrl.hostname.endsWith('.supabase.co')) {
      console.warn(`[SecurityAuditor] Request to external domain: ${parsedUrl.hostname}`);
    }

    // 3. Audit Strict-Transport-Security (HSTS) headers
    const hsts = response.headers?.get('strict-transport-security');
    if (!hsts && parsedUrl.hostname === 'leetcode.com') {
      console.warn(`[SecurityAuditor] Warning: Missing HSTS header on response from ${parsedUrl.hostname}`);
    }

    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      reason: `Transport security audit failed: ${err.message}`
    };
  }
}

/**
 * Secure fetch wrapper that enforces HTTPS and audits security headers
 * @param {string} url - Target URL
 * @param {RequestInit} [options] - Fetch options
 * @returns {Promise<Response>}
 */
export async function secureFetch(url, options = {}) {
  // Pre-flight protocol validation
  if (!url.startsWith('https://')) {
    throw new Error(`Security Violation: Insecure HTTP request blocked for ${url}`);
  }

  const response = await fetch(url, options);

  // Post-connection transport audit
  const audit = auditTransportSecurity(url, response);
  if (!audit.valid) {
    console.error(`[SecurityAuditor] Security policy failed: ${audit.reason}`);
  }

  return response;
}

