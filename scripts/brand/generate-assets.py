#!/usr/bin/env python3
"""Generate MEAT launcher, splash, and reusable mark assets from the vector source.

The canonical artwork is assets/brand/meat-t-bone-mark.svg. Raster exports are
generated assets; never trace a mockup crop or substitute emoji artwork here.

The renderer uses CairoSVG when available, then a local Chromium-family browser
with a transparent canvas. Pillow is used only to normalize PNG dimensions and
alpha modes.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
ASSET_DIR = ROOT / "assets" / "brand"
MARK_PATH = ASSET_DIR / "meat-t-bone-mark.svg"
MONOCHROME_PATH = ASSET_DIR / "meat-t-bone-monochrome.svg"


def inner_svg(path: Path) -> str:
    source = path.read_text(encoding="utf-8")
    return source[source.index(">") + 1 : source.rindex("</svg>")]


def svg_document(body: str, *, size: int = 1024) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
        f'viewBox="0 0 {size} {size}">\n{body}\n</svg>\n'
    )


def full_color_mark(*, transform: str, shadow: bool = False) -> str:
    shadow_definition = ""
    shadow_attribute = ""
    if shadow:
        shadow_definition = (
            '<defs><filter id="markShadow" x="-30%" y="-30%" width="160%" height="170%">'
            '<feDropShadow dx="0" dy="20" stdDeviation="18" flood-color="#120D10" '
            'flood-opacity="0.38"/></filter></defs>'
        )
        shadow_attribute = ' filter="url(#markShadow)"'
    return f'{shadow_definition}<g transform="{transform}"{shadow_attribute}>{inner_svg(MARK_PATH)}</g>'


def monochrome_mark(*, transform: str, color: str) -> str:
    mark = inner_svg(MONOCHROME_PATH).replace("#000000", color)
    return f'<g transform="{transform}">{mark}</g>'


def icon_background(start: str, end: str) -> str:
    return (
        '<defs>'
        '<linearGradient id="iconBackground" x1="90" y1="60" x2="930" y2="980" '
        'gradientUnits="userSpaceOnUse">'
        f'<stop offset="0" stop-color="{start}"/><stop offset="1" stop-color="{end}"/>'
        '</linearGradient>'
        '<radialGradient id="iconLight" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" '
        'gradientTransform="translate(250 175) rotate(42) scale(590)">'
        '<stop stop-color="#FFFFFF" stop-opacity="0.10"/>'
        '<stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>'
        '</radialGradient>'
        '</defs>'
        '<rect width="1024" height="1024" fill="url(#iconBackground)"/>'
        '<rect width="1024" height="1024" fill="url(#iconLight)"/>'
    )


def write_sources() -> dict[str, tuple[Path, int, bool]]:
    icon_transform = "translate(90 74) scale(1.65)"
    adaptive_transform = "translate(179 176) scale(1.3)"
    splash_transform = "translate(0 2) scale(2)"

    sources = {
        "app-icon-light": svg_document(
            icon_background("#6A3B55", "#3D1C30")
            + full_color_mark(transform=icon_transform, shadow=True)
        ),
        "app-icon-dark": svg_document(
            icon_background("#3D1C30", "#120D10")
            + full_color_mark(transform=icon_transform, shadow=True)
        ),
        "app-icon-tinted": svg_document(
            icon_background("#707070", "#242424")
            + monochrome_mark(transform=icon_transform, color="#FFFFFF")
        ),
        "splash-light": svg_document(full_color_mark(transform=splash_transform), size=1024),
        "splash-dark": svg_document(full_color_mark(transform=splash_transform), size=1024),
        "adaptive-background": svg_document(icon_background("#6A3B55", "#3D1C30")),
        "adaptive-foreground": svg_document(
            full_color_mark(transform=adaptive_transform, shadow=True)
        ),
        "adaptive-monochrome": svg_document(
            monochrome_mark(transform=adaptive_transform, color="#000000")
        ),
    }

    outputs: dict[str, tuple[Path, int, bool]] = {}
    for name, source in sources.items():
        svg_path = ASSET_DIR / f"{name}.svg"
        svg_path.write_text(source, encoding="utf-8")
        outputs[name] = (svg_path, 1024, name.startswith("app-icon") or name == "adaptive-background")

    outputs["meat-t-bone-mark"] = (MARK_PATH, 512, False)
    outputs["meat-t-bone-monochrome"] = (MONOCHROME_PATH, 512, False)
    return outputs


def render_svg(svg_path: Path, png_path: Path, size: int, *, opaque: bool) -> None:
    with tempfile.TemporaryDirectory(prefix="meat-brand-render-") as temporary_directory:
        temporary_path = Path(temporary_directory)
        rendered_path = temporary_path / "rendered.png"

        try:
            import cairosvg  # type: ignore[import-not-found]
        except ImportError:
            cairosvg = None

        chrome_candidates = (
            shutil.which("google-chrome"),
            shutil.which("chromium"),
            Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        )
        chrome_path = next(
            (Path(candidate) for candidate in chrome_candidates if candidate and Path(candidate).exists()),
            None,
        )

        if cairosvg is not None:
            cairosvg.svg2png(
                url=str(svg_path),
                write_to=str(rendered_path),
                output_width=size,
                output_height=size,
            )
        elif chrome_path is not None:
            subprocess.run(
                [
                    str(chrome_path),
                    "--headless=new",
                    "--disable-gpu",
                    "--hide-scrollbars",
                    "--force-device-scale-factor=1",
                    f"--window-size={size},{size}",
                    "--default-background-color=00000000",
                    f"--screenshot={rendered_path}",
                    svg_path.resolve().as_uri(),
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        else:
            raise RuntimeError("Install CairoSVG or Chrome to regenerate MEAT brand PNG assets.")

        with Image.open(rendered_path) as rendered:
            normalized = rendered.resize((size, size), Image.Resampling.LANCZOS)
            if opaque:
                normalized = normalized.convert("RGB")
            else:
                normalized = normalized.convert("RGBA")
            normalized.save(png_path, format="PNG", optimize=True)


def main() -> None:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    for name, (source, size, opaque) in write_sources().items():
        render_svg(source, ASSET_DIR / f"{name}.png", size, opaque=opaque)


if __name__ == "__main__":
    main()
