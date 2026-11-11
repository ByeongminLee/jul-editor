import type { UploadFn } from '@jul-editor/core';

/** Store local demo images as safe raster data; attachments remain queued for a host upload. */
export const uploadLocalImage: UploadFn = async (file, { kind }) => {
  if (kind !== 'image') throw new Error('No attachment upload handler configured.');
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  if (/^data:image\/(?:png|jpeg|gif|webp|bmp);base64,/i.test(data)) return { src: data };
  const image = new Image();
  image.src = data;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  return { src: canvas.toDataURL('image/png') };
};
