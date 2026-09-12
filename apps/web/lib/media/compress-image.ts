/**
 * Shrinks a picked image before it is written to Supabase Storage.
 *
 * Trove uploads straight from the browser to Storage, so this is the only
 * moment anything sees the bytes: the API is handed a path and a size, never a
 * file. Left alone that means a phone's own 12 MP, 3 MB JPEG is what gets
 * stored, and - because `media-frame` renders storage media `unoptimized` - it
 * is also what gets delivered, at every size, forever. Downscaling and
 * re-encoding here is the one edit that makes both bills smaller.
 *
 * WebP rather than AVIF because every bucket's `allowed_mime_types`, every
 * client allowlist and the API's own checks already accept `image/webp`, so
 * emitting it needs no migration and no contract change - and because Chrome's
 * canvas cannot encode AVIF at all.
 *
 * The contract callers depend on, in order of importance:
 *
 *   - This never throws. Anything undecodable, any missing browser API and any
 *     result that came out larger than its source all return the original bytes
 *     unchanged, so the worst case is exactly today's behaviour.
 *   - `sizeBytes` always matches `body`, and is never larger than the file.
 *   - `recompressed` is true only alongside `image/webp` and a `.webp`
 *     filename, which is what keeps a stored object's extension honest.
 */

export type ImageTarget = { maxEdge: number; quality: number };

export type CompressedUpload = {
  /** The original blob itself when nothing was re-encoded. */
  body: Blob;
  contentType: string;
  fileName: string;
  recompressed: boolean;
  sizeBytes: number;
};

const WEBP = 'image/webp';

/**
 * 2048 is where `deviceSizes` in `next.config.ts` stops and where
 * `pexels-loader` caps a hotlink: past it, no slot in the app can use the
 * pixels. It is a hard ceiling here rather than a hint, because `unoptimized`
 * means the stored object is delivered verbatim.
 *
 * Memory photos stay at the ceiling deliberately. This re-encode is
 * irreversible and it is the traveller's only copy of their own keepsake - a
 * cover can be uploaded again, a memory cannot.
 */
export const memoryPhotoTarget: ImageTarget = { maxEdge: 2048, quality: 0.82 };

/** Decoration behind a scrim and a title, so the cheapest of the full-size targets. */
export const tripCoverTarget: ImageTarget = { maxEdge: 2048, quality: 0.8 };

/** The largest avatar the app draws is 76px, so 512 is already generous. */
export const avatarTarget: ImageTarget = { maxEdge: 512, quality: 0.82 };

/**
 * Boarding passes and confirmation screenshots, where small text is the whole
 * payload and ringing around glyphs is the failure mode.
 */
export const reservationImageTarget: ImageTarget = { maxEdge: 2048, quality: 0.85 };

/**
 * The size to draw at, never larger than the source.
 *
 * Upsizing would spend bytes inventing pixels, which is the one regression here
 * that would quietly make storage worse rather than better.
 */
export function scaledDimensions(width: number, height: number, maxEdge: number) {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { height, width };

  const scale = maxEdge / longest;
  // A panorama's short edge rounds towards zero, and a canvas of zero height
  // cannot be encoded at all.
  return {
    height: Math.max(1, Math.round(height * scale)),
    width: Math.max(1, Math.round(width * scale)),
  };
}

/**
 * Renames a file for its new format.
 *
 * `memoryPhotoPath` derives a stored object's extension from its filename, so
 * without this every re-encoded photo would be named `.jpg` while holding WebP
 * bytes.
 */
export function webpFileName(fileName: string) {
  const base = fileName.trim().replace(/\.[^./\\]*$/, '');
  return `${base || 'photo'}.webp`;
}

/**
 * Whether the encode was worth taking.
 *
 * A flat-colour PNG and an already-optimised WebP both genuinely grow, and an
 * empty result is a failed encode rather than a spectacular one. Equal is not
 * worth a generation of quality.
 */
export function shouldKeepEncoded(originalBytes: number, encodedBytes: number) {
  return encodedBytes > 0 && encodedBytes < originalBytes;
}

/**
 * The preferred path: Chrome and Safari 16.4+ encode off the main thread here,
 * leaving only `drawImage` to block.
 */
async function encodeWithOffscreenCanvas(file: File, target: ImageTarget) {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return null;

  let bitmap: ImageBitmap;
  try {
    // The EXIF rotation does not survive a re-encode, so a photo drawn without
    // applying it first would be stored permanently on its side.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // No decoder for this format. HEIC outside Safari is the usual case, and it
    // is a pass-through rather than an error: the bucket accepts HEIC already.
    return null;
  }

  try {
    if (!bitmap.width || !bitmap.height) return null;
    const { height, width } = scaledDimensions(bitmap.width, bitmap.height, target.maxEdge);

    const canvas = new OffscreenCanvas(width, height);
    if (typeof canvas.convertToBlob !== 'function') return null;
    const context = canvas.getContext('2d');
    // A device that has run out of canvas contexts, which iOS does in practice.
    if (!context) return null;

    context.drawImage(bitmap, 0, 0, width, height);
    return await canvas.convertToBlob({ quality: target.quality, type: WEBP });
  } catch {
    return null;
  } finally {
    // A 12 MP bitmap is ~48 MB of live pixels. Releasing it before the next one
    // is decoded is what lets a phone compress a handful of photos in a row
    // without the tab being killed.
    bitmap.close();
  }
}

/** Decodes through an element so the browser applies EXIF orientation for us. */
function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

/**
 * The fallback, for a browser with a canvas but no `OffscreenCanvas`.
 *
 * It decodes through an `<img>` rather than an `ImageBitmap` on purpose: canvas
 * WebP encoding reached Safari two major versions before `createImageBitmap`'s
 * `imageOrientation` option did, so a bitmap decode here would have a window of
 * Safari versions that strip the rotation tag without ever applying it.
 */
async function encodeWithCanvasElement(file: File, target: ImageTarget) {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return null;

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    if (!image?.naturalWidth || !image.naturalHeight) return null;

    const { height, width } = scaledDimensions(
      image.naturalWidth,
      image.naturalHeight,
      target.maxEdge,
    );

    const canvas = document.createElement('canvas');
    canvas.height = height;
    canvas.width = width;
    const context = canvas.getContext('2d');
    if (!context) return null;

    context.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, WEBP, target.quality);
    });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function compressImage(file: File, target: ImageTarget): Promise<CompressedUpload> {
  const original: CompressedUpload = {
    body: file,
    contentType: file.type,
    fileName: file.name,
    recompressed: false,
    sizeBytes: file.size,
  };

  // A reservation's PDF is a document, not an image, and has to arrive byte for
  // byte. Deciding that here rather than at the call site keeps the rule in one
  // place and lets every caller compress unconditionally.
  if (!file.type.startsWith('image/')) return original;

  const encoded =
    (await encodeWithOffscreenCanvas(file, target)) ??
    (await encodeWithCanvasElement(file, target));
  if (!encoded) return original;

  // Both `toBlob` and `convertToBlob` answer an unsupported format with a PNG
  // rather than an error. A PNG of a photograph is larger than the JPEG it came
  // from, so without this check an old browser would store more bytes than it
  // was handed and register them under a content type they do not have.
  if (encoded.type !== WEBP) return original;
  if (!shouldKeepEncoded(file.size, encoded.size)) return original;

  return {
    body: encoded,
    contentType: WEBP,
    fileName: webpFileName(file.name),
    recompressed: true,
    sizeBytes: encoded.size,
  };
}
