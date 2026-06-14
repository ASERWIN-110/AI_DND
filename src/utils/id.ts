// @ts-nocheck
export function createId(prefix = 'id') {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${time}_${random}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function assertPlainObject(value, name = 'value') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be a plain object`);
  }
}

export function ensureString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

