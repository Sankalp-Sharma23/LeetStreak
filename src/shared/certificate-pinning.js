/**
 * Deprecated: Replaced by https-enforcement.js
 * In Chrome Extensions MV3, true raw TLS certificate pinning is not exposed by browser APIs.
 * This file maintains backwards compatibility by re-exporting secureFetch from https-enforcement.js.
 */
export { secureFetch, auditTransportSecurity } from './https-enforcement.js';
