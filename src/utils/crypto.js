import crypto from "node:crypto";

/**
 * Generate a timestamp in the format Nagad expects.
 *
 * Nagad validates the request time against Bangladesh local time (UTC+6), so a
 * plain UTC timestamp is rejected as stale on every request.
 *
 * @param {number} [offsetHours=6] - Hours ahead of UTC. Bangladesh is +6.
 * @returns {string} e.g. "20240101180000"
 */
export function getTimestamp(offsetHours = 6) {
  return new Date(Date.now() + offsetHours * 3_600_000)
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
  return crypto
    .randomBytes(Math.ceil(length / 2))
    .toString("hex")
    .slice(0, length);
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
