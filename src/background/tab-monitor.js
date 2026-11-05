/**
 * Hardcore Motivation Mode - Tab Monitor & Blocker Bridge
 *
 * Responsibilities:
 * - Initializes the declarativeNetRequest Blocker Manager.
 * - Bridges service worker events and storage changes to the Blocker Manager.
 * - Provides supplementary in-tab and native notifications when appropriate.
 */

import { initializeBlockerManager, syncBlockerRules, isBlockerActive, evaluateUrl } from './blocker-manager.js';

export function initializeTabMonitor() {
  // Initialize authoritative declarative network request blocker
  initializeBlockerManager();

  if (typeof chrome === 'undefined' || !chrome.tabs) {
    console.warn('[TabMonitor] chrome.tabs API not available');
    return;
  }

  // Supplementary tab check on full completion
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab?.url) {
      try {
        const status = await isBlockerActive();
        if (!status.active) return;

        const evalResult = evaluateUrl(tab.url);
        if (evalResult.isDistraction && !tab.url.includes('blocked.html')) {
          const redirectUrl = chrome.runtime.getURL(`blocked.html?blocked=${encodeURIComponent(tab.url)}&label=${encodeURIComponent(evalResult.label)}`);
          chrome.tabs.update(tabId, { url: redirectUrl });
        }
      } catch (err) {
        // Fallback
      }
    }
  });

  console.log('✅ [TabMonitor] Hardcore Mode Tab Monitor and Blocker initialized');
}

export { syncBlockerRules, isBlockerActive, evaluateUrl };
