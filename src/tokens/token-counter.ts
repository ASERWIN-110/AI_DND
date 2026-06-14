// @ts-nocheck
import { getEncoding } from 'js-tiktoken';

let encoder;

export function countTokens(text) {
  const value = String(text || '');

  try {
    encoder ||= getEncoding('cl100k_base');
    return encoder.encode(value).length;
  } catch {
    return estimateTokens(value);
  }
}

export function estimateTokens(text) {
  const value = String(text || '');
  const ascii = value.replace(/[^\x00-\x7F]/g, '');
  const nonAsciiCount = value.length - ascii.length;
  return Math.ceil(ascii.length / 4) + nonAsciiCount;
}

