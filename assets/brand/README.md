# MEAT production brand assets

## Source of truth

`meat-t-bone-mark.svg` is the canonical production mark. It is a clean vector recreation traced from the approved Notion brand board. It is not an emoji, AI-generated substitute, or raster crop. Keep the vector as the source of truth and regenerate raster exports after intentional artwork changes.

The simplified shapes are deliberate: the asymmetric steak silhouette, cream fat edge, chili-red muscle, and oversized T-shaped bone survive launcher masking and remain recognizable in a 32-point header treatment.

## Exports

| Asset | Purpose | Alpha |
| --- | --- | --- |
| `app-icon-light.png` | Default and legacy launcher icon | Opaque RGB |
| `app-icon-dark.png` | iOS dark appearance | Opaque RGB |
| `app-icon-tinted.png` | Grayscale iOS tinted appearance | Opaque RGB |
| `meat-t-bone-mark.png` | Header and metric mark | Transparent RGBA |
| `splash-light.png`, `splash-dark.png` | Light/dark splash artwork | Transparent RGBA |
| `adaptive-foreground.png` | Android adaptive foreground | Transparent RGBA |
| `adaptive-background.png` | Android adaptive background | Opaque RGB |
| `adaptive-monochrome.png` | Android 13+ themed icon mask | Transparent RGBA |

The matching SVG files are retained for review and future export needs. The app icon sources intentionally fill the entire square without pre-rounded corners; iOS and Android apply their own masks.

## Regeneration

Run the generator from the repository root with a Python environment containing Pillow:

```sh
python3 scripts/brand/generate-assets.py
```

The generator uses CairoSVG when available, otherwise a local Chrome/Chromium installation. It renders transparent canvases before normalizing dimensions and PNG color modes. Run `npm run test:runtime` afterward; the brand-foundation tests verify dimensions, opacity, transparent layers, configuration paths, vector-only source artwork, approved token roles, and contrast-safe label colors.

Do not configure or trigger an EAS build while iterating on these assets. Verify launcher masking and the production splash in a local native iOS build before the Build 2 approval gate.
