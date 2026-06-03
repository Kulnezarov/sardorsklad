import { productApi } from '../api/client';

export const MAX_INTAKE_PHOTOS = 12;

/** Пути фото товара из ответа API склада. */
export function productGalleryFromApi(p) {
  const raw = Array.isArray(p?.image_urls) ? p.image_urls : [];
  const list = raw.map((u) => String(u || '').split('?')[0].trim()).filter(Boolean);
  const legacy = String(p?.image_url || '').split('?')[0].trim();
  if (legacy && !list.includes(legacy)) list.unshift(legacy);
  return list;
}

export function dataUrlToBlob(dataUrl) {
  const [header, base64] = String(dataUrl).split(',');
  const mime = header?.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
  const bin = atob(base64 || '');
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

/** Сжатие фото перед сохранением в накладной (синхронизация с сервером). */
export function compressImageFile(file, maxDim = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      const scale = Math.min(1, maxDim / Math.max(width, height, 1));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas недоступен'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не удалось прочитать изображение'));
    };
    img.src = url;
  });
}

async function galleryCount(productId) {
  try {
    const r = await productApi.getById(productId);
    return productGalleryFromApi(r.data).length;
  } catch {
    return 0;
  }
}

/** Загрузка фото из позиции накладной (data URL) на карточку товара. */
export async function uploadPendingPhotosForLine(line, productId) {
  const pending = Array.isArray(line?.intake_photo_data)
    ? line.intake_photo_data.filter((u) => String(u || '').startsWith('data:'))
    : [];
  if (!pending.length || !productId) {
    return {
      urls: Array.isArray(line?.warehouse_image_urls) ? [...line.warehouse_image_urls] : [],
      uploaded: 0,
      error: null,
    };
  }

  let urls = productGalleryFromApi({ image_urls: line.warehouse_image_urls });
  let uploaded = 0;

  for (const dataUrl of pending) {
    const count = await galleryCount(productId);
    if (count >= MAX_INTAKE_PHOTOS) {
      return {
        urls,
        uploaded,
        error: `Не больше ${MAX_INTAKE_PHOTOS} фото на товар`,
      };
    }
    const blob = dataUrlToBlob(dataUrl);
    const file = new File([blob], `intake_${Date.now()}.jpg`, { type: 'image/jpeg' });
    const r = await productApi.uploadProductImage(productId, file);
    const next = r?.data?.image_urls;
    if (Array.isArray(next) && next.length) {
      urls = next;
      uploaded += 1;
    }
  }

  return { urls, uploaded, error: null };
}
