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

test('metric roles match the approved protein-first palette', () => {
  assert.equal(lightColors.action, brandColors.primaryPlum);
  assert.equal(lightColors.protein, '#4B2438');
  assert.equal(lightColors.proteinAccent, '#F12A2F');
  assert.equal(lightColors.calories, '#FF5A1F');
  assert.equal(lightColors.caloriesAccent, '#FFB000');
  assert.equal(lightColors.carbs, '#F2B400');
  assert.equal(lightColors.fat, '#2457D6');
  assert.equal(lightColors.fiber, '#00A66A');
});

test('metric label colors retain WCAG AA contrast on neutral cards', () => {
  for (const label of [
    lightColors.caloriesLabel,
    lightColors.carbsLabel,
    lightColors.fatLabel,
    lightColors.fiberLabel,
  ]) {
    assert.ok(contrast(label, lightColors.surface) >= 4.5);
  }
  for (const label of [
    darkColors.caloriesLabel,
    darkColors.carbsLabel,
    darkColors.fatLabel,
    darkColors.fiberLabel,
  ]) {
    assert.ok(contrast(label, darkColors.surface) >= 4.5);
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
