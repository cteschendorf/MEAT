import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { inflateSync } from 'node:zlib';

import { brandColors, darkColors, lightColors } from '../src/ui/theme/colors';

const root = path.resolve(import.meta.dirname, '..');

interface DecodedPng {
  colorType: number;
  height: number;
  pixels: Uint8Array;
  width: number;
}

function paeth(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function decodePng(relativePath: string): DecodedPng {
  const png = readFileSync(path.join(root, relativePath));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

  let width = 0;
  let height = 0;
  let colorType = -1;
  const compressed: Buffer[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (type === 'IHDR') {
      width = png.readUInt32BE(dataStart);
      height = png.readUInt32BE(dataStart + 4);
      assert.equal(png[dataStart + 8], 8, `${relativePath} must be an 8-bit PNG`);
      colorType = png[dataStart + 9] ?? -1;
    } else if (type === 'IDAT') {
      compressed.push(png.subarray(dataStart, dataStart + length));
    }
    offset = dataStart + length + 4;
  }

  const bytesPerPixel = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  assert.ok(bytesPerPixel > 0, `${relativePath} must use RGB or RGBA pixels`);
  const inflated = inflateSync(Buffer.concat(compressed));
  const rowLength = width * bytesPerPixel;
  const pixels = new Uint8Array(rowLength * height);
  let sourceOffset = 0;

  for (let row = 0; row < height; row += 1) {
    const filter = inflated[sourceOffset] ?? -1;
    sourceOffset += 1;
    const rowOffset = row * rowLength;
    for (let column = 0; column < rowLength; column += 1) {
      const encoded = inflated[sourceOffset + column] ?? 0;
      const left = column >= bytesPerPixel ? pixels[rowOffset + column - bytesPerPixel] ?? 0 : 0;
      const above = row > 0 ? pixels[rowOffset - rowLength + column] ?? 0 : 0;
      const upperLeft =
        row > 0 && column >= bytesPerPixel
          ? pixels[rowOffset - rowLength + column - bytesPerPixel] ?? 0
          : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? above
              : filter === 3
                ? Math.floor((left + above) / 2)
                : filter === 4
                  ? paeth(left, above, upperLeft)
                  : -1;
      assert.notEqual(predictor, -1, `${relativePath} contains unsupported PNG filter ${filter}`);
      pixels[rowOffset + column] = (encoded + predictor) & 0xff;
    }
    sourceOffset += rowLength;
  }

  return { colorType, height, pixels, width };
}

function channel(value: string): number {
  const normalized = Number.parseInt(value, 16) / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const red = channel(hex.slice(1, 3));
  const green = channel(hex.slice(3, 5));
  const blue = channel(hex.slice(5, 7));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

test('brand roles match the gold/monochrome Figma Make palette', () => {
  assert.deepEqual(
    {
      background: brandColors.bg,
      border: brandColors.border,
      card: brandColors.cardDark,
      elevated: brandColors.elevatedDark,
      gold: brandColors.gold,
      goldDeep: brandColors.goldDeep,
      ink: brandColors.ink,
      raised: brandColors.raisedDark,
      surfaceDark: brandColors.surfaceDark,
      warmBackground: brandColors.warmBackground,
    },
    {
      background: '#080808',
      border: '#2A2A2A',
      card: '#191919',
      elevated: '#222222',
      gold: '#C8A45A',
      goldDeep: '#8C6633',
      ink: '#181410',
      raised: '#333333',
      surfaceDark: '#111111',
      warmBackground: '#F5F1E8',
    },
  );

  // One gold accent carries selection, action, and protein emphasis
  // everywhere at once — the role TWA red used to play — in both schemes.
  for (const colors of [lightColors, darkColors]) {
    assert.equal(colors.action, colors.brand);
    assert.equal(colors.protein, colors.action);
    assert.equal(colors.proteinAccent, colors.action);
    assert.equal(colors.caloriesAccent, colors.action);
    // No dedicated light "parchment" panel in this concept: chrome text is
    // just the ordinary primary text color, not a separate parchment ink.
    assert.equal(colors.textOnChrome, colors.textPrimary);
  }

  assert.equal(lightColors.action, brandColors.goldDeep);
  assert.equal(lightColors.background, brandColors.warmBackground);
  assert.equal(lightColors.chrome, '#FFFFFF');
  assert.equal(lightColors.textOnAction, '#FFFFFF');

  assert.equal(darkColors.action, brandColors.gold);
  assert.equal(darkColors.background, brandColors.bg);
  assert.equal(darkColors.chrome, brandColors.surfaceDark);
  // Gold sits mid-lightness against this near-black canvas, so its own
  // buttons take dark text — the one field the palette swap flips the
  // polarity of.
  assert.equal(darkColors.textOnAction, brandColors.bg);
});

test('text retains WCAG AA contrast on every surface, chrome, and action fill', () => {
  for (const colors of [lightColors, darkColors]) {
    assert.ok(contrast(colors.textPrimary, colors.background) >= 4.5);
    assert.ok(contrast(colors.textPrimary, colors.surface) >= 4.5);
    assert.ok(contrast(colors.textSecondary, colors.surface) >= 4.5);
    assert.ok(contrast(colors.textOnChrome, colors.chrome) >= 4.5);
    assert.ok(contrast(colors.textSecondaryOnChrome, colors.chrome) >= 4.5);
    assert.ok(contrast(colors.accentOnChrome, colors.chrome) >= 4.5);
    assert.ok(contrast(colors.textOnAction, colors.action) >= 4.5);
    // Destructive buttons stay a saturated red in both schemes and always
    // pair with light text, unlike `textOnAction`, which flips polarity.
    assert.ok(contrast(colors.textOnDestructive, colors.destructiveAction) >= 4.5);
    assert.ok(contrast(colors.textOnDestructive, colors.destructiveActionPressed) >= 4.5);
    // Non-text contrast: the energy progress bar's fill against its track.
    assert.ok(contrast(colors.action, colors.surfaceMuted) >= 3);
    assert.ok(contrast(colors.destructive, colors.surfaceMuted) >= 3);
  }
});

test('production icon exports are square, opaque 1024px RGB files', () => {
  for (const filename of ['app-icon-light.png', 'app-icon-dark.png', 'app-icon-tinted.png']) {
    const icon = decodePng(`assets/brand/${filename}`);
    assert.equal(icon.width, 1024);
    assert.equal(icon.height, 1024);
    assert.equal(icon.colorType, 2, `${filename} must not contain transparency`);
  }
});

test('reusable mark, splash, and adaptive foreground exports retain transparent backgrounds', () => {
  for (const [filename, size] of [
    ['meat-t-bone-mark.png', 512],
    ['splash-light.png', 1024],
    ['splash-dark.png', 1024],
    ['adaptive-foreground.png', 1024],
    ['adaptive-monochrome.png', 1024],
  ] as const) {
    const image = decodePng(`assets/brand/${filename}`);
    assert.equal(image.width, size);
    assert.equal(image.height, size);
    assert.equal(image.colorType, 6);
    assert.equal(image.pixels[3], 0, `${filename} must have a transparent top-left pixel`);
    assert.ok(
      image.pixels.some((value, index) => index % 4 === 3 && value === 255),
      `${filename} must retain visible opaque artwork`,
    );
  }
});

test('the canonical mark is vector artwork rather than embedded raster or emoji', () => {
  const vector = readFileSync(path.join(root, 'assets/brand/meat-t-bone-mark.svg'), 'utf8');
  assert.match(vector, /<path\b/);
  assert.match(vector, /MEAT T-bone mark/);
  assert.doesNotMatch(vector, /<image\b|data:image|emoji/i);
});

test('Expo config selects all production brand assets and configured light and dark splash screens', () => {
  const appConfig = JSON.parse(readFileSync(path.join(root, 'app.json'), 'utf8')) as {
    expo: {
      icon: string;
      ios: { icon: Record<'dark' | 'light' | 'tinted', string> };
      android: { adaptiveIcon: Record<'backgroundImage' | 'foregroundImage' | 'monochromeImage', string> };
      plugins: unknown[];
    };
  };
  const splashPlugin = appConfig.expo.plugins.find(
    (plugin): plugin is [string, { backgroundColor: string; image: string; dark: { backgroundColor: string; image: string } }] =>
      Array.isArray(plugin) && plugin[0] === 'expo-splash-screen',
  );
  assert.ok(splashPlugin);
  assert.equal(splashPlugin[1].backgroundColor, '#FAF8F6');
  assert.equal(splashPlugin[1].dark.backgroundColor, '#120D10');

  const configuredAssets = [
    appConfig.expo.icon,
    ...Object.values(appConfig.expo.ios.icon),
    ...Object.values(appConfig.expo.android.adaptiveIcon),
    splashPlugin[1].image,
    splashPlugin[1].dark.image,
  ];
  for (const asset of configuredAssets) {
    assert.ok(existsSync(path.resolve(root, asset)), `${asset} must exist`);
  }
});
