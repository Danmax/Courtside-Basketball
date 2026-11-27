// Shared validation for browser imports and server saves; no DOM or storage.
export const MAX_IMAGE_CHARS = 48000;
export function validateImage(value) {
  if (value === '') return value;
  if (typeof value !== 'string' || value.length > MAX_IMAGE_CHARS || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('Use a PNG, JPEG or WebP image smaller than 36 KB after resizing.');
  const [header, encoded] = value.split(','); let bytes;
  try { bytes = atob(encoded); } catch { throw new Error('Invalid image data.'); }
  const valid = header.includes('/png;') ? bytes.startsWith('\x89PNG\r\n\x1a\n') : header.includes('/jpeg;') ? bytes.startsWith('\xff\xd8\xff') : bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';
  if (!valid) throw new Error('The image content does not match its format.');
  return value;
}
export function validateProfile(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Invalid player profile.');
  const result = {};
  for (const [key, max] of [['position', 40], ['hometown', 80], ['bio', 500]]) {
    const value = source[key] ?? '';
    if (typeof value !== 'string' || value.trim().length > max) throw new Error(`Invalid profile ${key} (maximum ${max} characters).`);
    result[key] = value.trim();
  }
  const height = source.heightCm ?? null;
  if (height !== null && (!Number.isInteger(height) || height < 40 || height > 280)) throw new Error('Height must be a whole number from 40–280 cm.');
  result.heightCm = height; result.photo = validateImage(source.photo ?? ''); return result;
}
