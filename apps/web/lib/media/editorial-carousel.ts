import type { EditorialImageReference } from '@/lib/media/editorial-images';

export function carouselIndex(index: number, total: number) {
  return Math.max(0, Math.min(index, Math.max(total - 1, 0)));
}

export function photographicDescription(image: EditorialImageReference | undefined) {
  if (image?.matchKind === 'generic') return null;

  return image?.altText?.trim().replace(/[—–]/g, '-') || null;
}
