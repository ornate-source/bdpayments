import crypto from "node:crypto";

/**
 * Generate a UTC timestamp in the format Nagad expects.
 *
 * @returns {string} e.g. "20240101120000"
 */
export function getTimestamp() {
  const now = new Date();
  return now
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14);
}

/**
 * Generate a random challenge string.
 *
 * @param {number} [length=40]
 * @returns {string}
 */
export function generateChallenge(length = 40) {
  return crypto.randomBytes(length).toString("hex").slice(0, length);
}

/**
 * Encrypt data with a public key (RSA).
 *
 * @param {string} data - Data to encrypt.
 * @param {string} publicKey - PEM public key.
 * @returns {string} Base64-encoded ciphertext.
 */
export function encryptWithPublicKey(data, publicKey) {
  const buffer = Buffer.from(data, "utf-8");
  const encrypted = crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    buffer
  );
  return encrypted.toString("base64");
}

/**
 * Sign data with a private key (RSA).
 *
 * @param {string} data - Data to sign.
 * @param {string} privateKey - PEM private key.
 * @returns {string} Base64-encoded signature.
 */
export function signWithPrivateKey(data, privateKey) {
  const sign = crypto.createSign("SHA256");
  sign.update(data);
  sign.end();
  return sign.sign(privateKey, "base64");
}

/**
 * Decrypt data using a private key.
 *
 * @param {string} data - Base64-encoded encrypted data.
 * @param {string} privateKey - PEM private key.
 * @returns {string} Decrypted data.
 */
export function decryptWithPrivateKey(data, privateKey) {
  const buffer = Buffer.from(data, "base64");
  const decrypted = crypto.privateDecrypt(
    {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    buffer
  );
  return decrypted.toString("utf-8");
}
