import { SecureStorage, generateSecureRandom } from './security-utils.js';

/**
 * Store a token securely using AES-GCM encryption
 * @param {string} keyName - The base key name (e.g. 'github_token')
 * @param {string} token - The raw token to encrypt
 */
export async function storeEncryptedToken(keyName, token) {
  // Generate a random encryption password
  const password = generateSecureRandom(32);
  
  // Encrypt the token
  const encrypted = await SecureStorage.encrypt(token, password);
  
  // Store both the encrypted data and the key used
  const dataToStore = {};
  dataToStore[`${keyName}_encrypted`] = encrypted;
  dataToStore[`${keyName}_key`] = password;
  
  await chrome.storage.local.set(dataToStore);
  return true;
}

/**
 * Retrieve and decrypt a securely stored token
 * @param {string} keyName - The base key name (e.g. 'github_token')
 * @returns {Promise<string|null>} The decrypted token, or null if not found
 */
export async function retrieveEncryptedToken(keyName) {
  const keys = [`${keyName}_encrypted`, `${keyName}_key`];
  const data = await chrome.storage.local.get(keys);
  
  const encrypted = data[`${keyName}_encrypted`];
  const password = data[`${keyName}_key`];
  
  if (!encrypted || !password) {
    return null;
  }
  
  try {
    const decrypted = await SecureStorage.decrypt(encrypted, password);
    return decrypted;
  } catch (error) {
    console.error(`Failed to decrypt ${keyName}:`, error);
    return null;
  }
}
