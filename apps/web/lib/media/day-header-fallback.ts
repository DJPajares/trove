/**
 * Trove's own cover artwork: the photograph a screen shows when it has no trip
 * of its own to show - the signed-out pages, the welcome tour, and the covers
 * of Home, Trips, Finds, Kit and a day with no photo yet.
 *
 * Bundled with the app rather than hotlinked, so it costs no provider request
 * and is there offline. Used under https://www.pexels.com/license/, which asks
 * for no credit; Trove credits it anyway, in small type on the photograph
 * (`CoverArtworkCredit`).
 */
export const dayHeaderFallback = {
  attribution: {
    photographerName: 'Sanket Barik',
    photographerUrl: 'https://www.pexels.com/@sanket-barik-2808574',
    providerName: 'pexels',
    providerPageUrl:
      'https://www.pexels.com/photo/snow-covered-mountain-peak-under-white-clouds-7846481/',
  },
  externalPhotoId: '7846481',
  preview:
    'data:image/webp;base64,UklGRr4BAABXRUJQVlA4ILIBAADwDACdASooADwAPu1qrVGppaQiqrQLATAdiWYArz/d9xPj8fT+Lv6Z9rn20q2iYKB3H5gefo2a0tNWG2SwgJiBgdGzS38clNzRh/oFOZwptLZRm80rim4SeUMX85OZAuENP0is2scMECRCQSAl/SAAAP61qtglqhv8Ao3GmOXjF5kIY4d5/LZ4+BsDaZnXcwkKR4tYTP2l9kriPZFCIjgy6ZqN2uIGtaS06Z2OVefV6JFHeyAErljiPJRMniW03EA0weGvY6MtHkHp0Gx1uZMYpyH8Gc8kKai5naRLN1HTsp1gDtp6/J4IDPjegSDucqgTfv5We3rt5v6rAYgcB0LFFcG28fJRmnWFgiaYYzsdWVpMXmbjiYnsPi9SjYCt8vxAuFxrhibgcXgO+pZ3z/xbE+p+rxwbJ57+mSQPvBEHzgRxyOV1xVoaC0vRe8R9KDK+LfgD7MrJLqRIVds5sweCUYFpiTdlRpCDeQwz6K29swimKdXSupRxPYAXIht7pHluXkCKw7rglGUlrPBCkw78yfEbP5pPm3rOwhMLL5V9T9iKiNGg4GP3XQuX6H4XBiQAAA==',
  src: { src: '/media/cover-artwork.webp', width: 2000, height: 3000 },
};
