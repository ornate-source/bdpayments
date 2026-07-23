/**
 * Registry of module-level caches (auth tokens, SDK clients) that must be
 * dropped when credentials change.
 *
 * Adapters register their own reset function on load; `clearConfig()` calls
 * `resetCaches()`. Keeping the registry here avoids a circular import between
 * `config.js` and the gateway adapters.
 *
 * @type {Set<() => void>}
 */
const resettables = new Set();

/**
 * Register a cache-reset callback.
 *
 * @param {() => void} reset
 */
export function registerCache(reset) {
  resettables.add(reset);
}

/**
 * Reset every registered cache.
 */
export function resetCaches() {
  for (const reset of resettables) {
    reset();
  }
}
