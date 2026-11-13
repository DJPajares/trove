/**
 * The profile's world map, drawn by Trove rather than a map provider: a grid
 * of dots wherever there is land, with the places a traveller has been lit on
 * top. It costs no request and carries no provider terms.
 *
 * The outlines are deliberately rough - a few dozen points a continent - since
 * at this dot spacing a finer coastline would not change a single dot. They
 * are decoration, never a basis for geography.
 */
const LAND: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [
    [-168, 66],
    [-162, 70],
    [-140, 70],
    [-128, 70],
    [-110, 73],
    [-95, 72],
    [-82, 73],
    [-70, 67],
    [-62, 60],
    [-55, 52],
    [-66, 45],
    [-70, 42],
    [-76, 38],
    [-81, 31],
    [-80, 25],
    [-82, 29],
    [-90, 30],
    [-97, 27],
    [-97, 21],
    [-90, 21],
    [-87, 15],
    [-83, 9],
    [-80, 8],
    [-85, 11],
    [-92, 15],
    [-105, 20],
    [-110, 23],
    [-115, 30],
    [-118, 34],
    [-124, 40],
    [-124, 48],
    [-133, 55],
    [-145, 60],
    [-155, 58],
    [-165, 60],
  ],
  [
    [-55, 60],
    [-44, 60],
    [-20, 70],
    [-18, 80],
    [-40, 83],
    [-60, 82],
    [-72, 77],
    [-58, 70],
  ],
  [
    [-80, 8],
    [-72, 12],
    [-62, 10],
    [-50, 0],
    [-35, -5],
    [-38, -13],
    [-40, -22],
    [-48, -28],
    [-58, -38],
    [-65, -42],
    [-68, -52],
    [-72, -50],
    [-74, -40],
    [-71, -30],
    [-70, -18],
    [-76, -13],
    [-81, -5],
    [-80, 0],
  ],
  [
    [-10, 36],
    [-9, 43],
    [-2, 44],
    [-5, 48],
    [2, 51],
    [5, 53],
    [8, 57],
    [5, 62],
    [12, 66],
    [20, 70],
    [30, 71],
    [42, 68],
    [40, 60],
    [30, 55],
    [28, 48],
    [30, 45],
    [26, 41],
    [22, 37],
    [16, 38],
    [12, 44],
    [10, 44],
    [3, 42],
    [-2, 37],
  ],
  [
    [-6, 50],
    [2, 51],
    [0, 54],
    [-3, 58],
    [-6, 56],
  ],
  [
    [-24, 64],
    [-14, 64],
    [-14, 66],
    [-22, 66],
  ],
  [
    [-17, 15],
    [-17, 21],
    [-13, 28],
    [-6, 35],
    [10, 37],
    [20, 32],
    [32, 31],
    [35, 28],
    [43, 12],
    [51, 12],
    [44, 0],
    [40, -15],
    [35, -25],
    [20, -35],
    [17, -29],
    [12, -17],
    [13, -5],
    [9, 4],
    [0, 5],
    [-8, 4],
    [-14, 10],
  ],
  [
    [44, -25],
    [49, -14],
    [50, -16],
    [47, -25],
  ],
  [
    [30, 45],
    [40, 42],
    [35, 36],
    [35, 31],
    [39, 22],
    [43, 13],
    [52, 16],
    [56, 25],
    [60, 25],
    [67, 24],
    [72, 20],
    [77, 8],
    [80, 15],
    [88, 22],
    [92, 21],
    [98, 16],
    [100, 13],
    [104, 10],
    [106, 9],
    [109, 12],
    [108, 21],
    [118, 24],
    [122, 30],
    [121, 38],
    [125, 40],
    [130, 42],
    [140, 48],
    [143, 54],
    [160, 60],
    [180, 66],
    [180, 72],
    [140, 73],
    [110, 77],
    [80, 73],
    [60, 70],
    [42, 68],
    [40, 60],
    [30, 55],
    [28, 48],
  ],
  [
    [130, 31],
    [135, 34],
    [140, 35],
    [142, 40],
    [141, 45],
    [145, 44],
    [140, 42],
    [136, 37],
    [131, 34],
  ],
  [
    [100, 6],
    [103, 1],
    [104, 2],
    [101, 7],
  ],
  [
    [95, 5],
    [106, -6],
    [104, -5],
    [98, 2],
  ],
  [
    [109, 1],
    [117, 7],
    [119, 1],
    [116, -4],
    [110, -3],
  ],
  [
    [105, -6],
    [115, -8],
    [114, -8.6],
    [106, -7.4],
  ],
  [
    [131, -1],
    [141, -3],
    [150, -10],
    [141, -9],
    [135, -4],
  ],
  [
    [120, 18],
    [122, 18],
    [126, 7],
    [122, 7],
  ],
  [
    [114, -22],
    [122, -18],
    [130, -12],
    [137, -12],
    [142, -11],
    [146, -19],
    [153, -26],
    [150, -37],
    [141, -38],
    [135, -35],
    [129, -32],
    [115, -34],
  ],
  [
    [172, -34],
    [178, -38],
    [174, -41],
    [171, -45],
    [167, -46],
    [172, -41],
  ],
  [
    [80, 6],
    [82, 7],
    [81, 10],
    [80, 9],
  ],
];

/** The drawing's frame: an equirectangular slice from 80°N to 56°S. */
export const WORLD_VIEW = { height: 150, north: 80, south: -56, width: 360 } as const;
const STEP_DEGREES = 4.2;

function inside(
  longitude: number,
  latitude: number,
  outline: ReadonlyArray<readonly [number, number]>,
) {
  let crossed = false;
  for (let index = 0, previous = outline.length - 1; index < outline.length; previous = index++) {
    const [x1, y1] = outline[index] as readonly [number, number];
    const [x2, y2] = outline[previous] as readonly [number, number];
    if (
      y1 > latitude !== y2 > latitude &&
      longitude < ((x2 - x1) * (latitude - y1)) / (y2 - y1) + x1
    ) {
      crossed = !crossed;
    }
  }
  return crossed;
}

/** Where a longitude and latitude fall in the drawing. */
export function projectToWorld(longitude: number, latitude: number) {
  const { height, north, south, width } = WORLD_VIEW;
  return {
    x: ((longitude + 180) / 360) * width,
    y: ((north - latitude) / (north - south)) * height,
  };
}

let cached: { x: number; y: number }[] | null = null;

/** Every land dot, computed once and kept: the outlines never change. */
export function worldLandDots() {
  if (cached) return cached;
  const dots: { x: number; y: number }[] = [];
  for (let latitude = WORLD_VIEW.north; latitude > WORLD_VIEW.south; latitude -= STEP_DEGREES) {
    for (let longitude = -180 + STEP_DEGREES / 2; longitude < 180; longitude += STEP_DEGREES) {
      if (LAND.some((outline) => inside(longitude, latitude, outline))) {
        dots.push(projectToWorld(longitude, latitude));
      }
    }
  }
  cached = dots;
  return dots;
}
