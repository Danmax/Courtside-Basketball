import { node } from './ui.js';
import { validateImage } from './profiles.js';
export function imageUpload(parent, label, initial = '') {
  let value = initial, pending = false, failure = '', generation = 0;
  const wrap = node('div', '', parent, 'image-editor');
  const preview = node('img', '', wrap, 'profile-photo'); preview.alt = label + ' preview';
  function show() { preview.hidden = !value; if (value) preview.src = value; else preview.removeAttribute('src'); }
  show();
  const field = node('label', label, wrap), input = node('input', '', field); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp';
  node('small', 'PNG, JPEG or WebP · up to 8 MB. Resized automatically for storage.', wrap, 'muted');
  const status = node('p', '', wrap); status.setAttribute('role', 'status');
  const remove = node('button', 'Remove image', wrap); remove.type = 'button';
  remove.onclick = () => { generation++; value = ''; pending = false; failure = ''; input.value = ''; status.textContent = ''; show(); };
  input.onchange = async () => {
    const file = input.files[0], current = ++generation; if (!file) return;
    pending = true; failure = ''; status.textContent = 'Preparing image…'; let bitmap;
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error('Choose a PNG, JPEG or WebP file up to 8 MB.');
      bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > 24000000) throw new Error('Choose an image smaller than 24 megapixels.');
      const canvas = document.createElement('canvas'), scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const prepared = validateImage(canvas.toDataURL('image/webp', 0.7));
      if (current === generation) { value = prepared; status.textContent = 'Image ready. Save to apply.'; show(); }
    } catch (error) { if (current === generation) { failure = error.message || 'Could not read image.'; status.textContent = failure; } }
    finally { bitmap?.close(); if (current === generation) pending = false; }
  };
  return () => { if (pending) throw new Error('Wait for the image to finish preparing.'); if (failure) throw new Error(failure); return value; };
}
export function profileImage(parent, source, alt, className = 'profile-photo') {
  if (!source) return;
  const image = node('img', '', parent, className); image.src = source; image.alt = alt; image.loading = 'lazy'; return image;
}
