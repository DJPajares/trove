import type { EditorialImageReference } from '@/lib/media/editorial-images';

export function carouselIndex(index: number, total: number) {
  return Math.max(0, Math.min(index, Math.max(total - 1, 0)));
}

export function photographicDescription(image: EditorialImageReference | undefined) {
  return image?.altText?.trim().replace(/[—–]/g, '-') || null;
}
