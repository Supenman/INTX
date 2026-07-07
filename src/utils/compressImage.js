/**
 * Compress an image file to JPEG, resizing to fit within maxDimension.
 *
 * Uses URL.createObjectURL to avoid FileReader overhead, so the main thread
 * never sees the raw file data. Returns the compressed data URL plus the
 * original pixel dimensions for display layout.
 *
 * @param {File} file  An image File/Blob.
 * @param {number} [maxDimension=1200]  Longest side in pixels.
 * @param {number} [quality=0.85]  JPEG quality 0–1.
 * @returns {Promise<{ dataUrl: string, width: number, height: number }>}
 */
export function compressImage(file, maxDimension = 1200, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const objUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objUrl);
      try {
        let w = img.naturalWidth;
        let h = img.naturalHeight;

        // Scale down if needed
        if (w > maxDimension || h > maxDimension) {
          const ratio = w / h;
          if (w > h) {
            w = maxDimension;
            h = Math.round(w / ratio);
          } else {
            h = maxDimension;
            w = Math.round(h * ratio);
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        resolve({
          dataUrl: canvas.toDataURL('image/jpeg', quality),
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      } catch (e) {
        reject(e);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objUrl);
      reject(new Error('Image load failed'));
    };

    img.src = objUrl;
  });
}
