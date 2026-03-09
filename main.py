from __future__ import annotations

import random
from pathlib import Path
from typing import Optional

import numpy as np
import typer
from PIL import Image, ImageDraw, ImageFont

app = typer.Typer(help="Render a phrase as typographic halftone art over a B&W image.")



def find_fonts(font_dir: Path) -> list[Path]:
    """Recursively find all TTF/OTF font files under font_dir."""
    fonts: list[Path] = []
    for ext in ("*.ttf", "*.otf", "*.TTF", "*.OTF"):
        fonts.extend(font_dir.rglob(ext))
    return fonts


def load_font(font_path: Optional[Path], size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if font_path is None:
        return ImageFont.load_default()
    try:
        return ImageFont.truetype(str(font_path), size)
    except Exception:
        return ImageFont.load_default()


def render_text_mask(phrase: str, font: ImageFont.FreeTypeFont | ImageFont.ImageFont, angle: float) -> Image.Image:
    """
    Render `phrase` with `font` onto a transparent RGBA image, then rotate by `angle`.
    Returns the rotated RGBA image (text is opaque, background transparent).
    """
    # Measure text size
    dummy = Image.new("RGBA", (1, 1))
    draw = ImageDraw.Draw(dummy)
    bbox = draw.textbbox((0, 0), phrase, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]

    # Render text onto transparent canvas
    text_img = Image.new("RGBA", (w + 4, h + 4), (0, 0, 0, 0))
    draw = ImageDraw.Draw(text_img)
    draw.text((-bbox[0] + 2, -bbox[1] + 2), phrase, font=font, fill=(0, 0, 0, 255))

    # Rotate with expansion so nothing is clipped
    rotated = text_img.rotate(angle, expand=True, resample=Image.BICUBIC)
    return rotated


def paint(
    source_lum: np.ndarray,
    canvas_arr: np.ndarray,
    coverage_mask: np.ndarray,
    text_img: Image.Image,
    cx: int,
    cy: int,
    gray_shade: int,
    threshold: float,
) -> None:
    """
    Paint `text_img` centered at (cx, cy) onto canvas_arr.
    Text pixels are colored black or gray depending on source_lum.
    Updates coverage_mask in place.
    """
    alpha = np.array(text_img.getchannel("A"))  # H x W uint8
    H_src, W_src = source_lum.shape
    th, tw = alpha.shape

    # Offsets so that text is centered at (cx, cy)
    ox = cx - tw // 2
    oy = cy - th // 2

    # Find pixels where alpha is opaque enough
    rows, cols = np.where(alpha > 128)  # text pixel coords in text_img space

    # Map to canvas coords
    canvas_xs = cols + ox
    canvas_ys = rows + oy

    # Keep only in-bounds pixels
    in_bounds = (
        (canvas_xs >= 0) & (canvas_xs < W_src) &
        (canvas_ys >= 0) & (canvas_ys < H_src)
    )
    canvas_xs = canvas_xs[in_bounds]
    canvas_ys = canvas_ys[in_bounds]

    if canvas_xs.size == 0:
        return

    # Sample luminance from source
    lum = source_lum[canvas_ys, canvas_xs]

    # Determine color: dark area → black (0), light area → gray
    colors = np.where(lum < threshold, 0, gray_shade).astype(np.uint8)

    # Write to canvas (RGBA); set alpha to 255
    canvas_arr[canvas_ys, canvas_xs, 0] = colors
    canvas_arr[canvas_ys, canvas_xs, 1] = colors
    canvas_arr[canvas_ys, canvas_xs, 2] = colors
    canvas_arr[canvas_ys, canvas_xs, 3] = 255

    # Mark coverage
    coverage_mask[canvas_ys, canvas_xs] = True


@app.command()
def main(
    input_image: Path = typer.Argument(..., help="Path to the source B&W image."),
    phrase: str = typer.Argument(..., help="The phrase to render repeatedly."),
    output_image: Path = typer.Argument(..., help="Path to save the output image."),
    font_dir: Path = typer.Option(Path("/usr/share/fonts"), help="Directory to search for fonts."),
    min_size: int = typer.Option(12, help="Minimum font size in pixels."),
    max_size: int = typer.Option(48, help="Maximum font size in pixels."),
    max_rotation: float = typer.Option(60.0, help="Maximum rotation angle in degrees (both directions)."),
    coverage: float = typer.Option(0.85, help="Target canvas coverage fraction (0.0–1.0)."),
    gray_shade: int = typer.Option(180, help="Gray value (0–255) for text over light areas."),
    threshold: float = typer.Option(0.5, help="Luminance threshold separating black vs white areas."),
    seed: Optional[int] = typer.Option(None, help="Random seed for reproducibility."),
    verbose: bool = typer.Option(False, help="Print progress updates."),
) -> None:
    rng = random.Random(seed)
    np.random.seed(seed)

    # --- Load source image ---
    if not input_image.exists():
        typer.echo(f"Error: input image '{input_image}' not found.", err=True)
        raise typer.Exit(1)

    src = Image.open(input_image).convert("L")
    W, H = src.size
    source_lum = np.array(src, dtype=np.float32) / 255.0  # shape (H, W), 0=black 1=white

    # --- Find fonts ---
    fonts = find_fonts(font_dir)
    if not fonts:
        typer.echo(f"No fonts found in '{font_dir}', using Pillow default font.", err=True)

    # --- Create output canvas ---
    canvas_arr = np.full((H, W, 4), 255, dtype=np.uint8)
    coverage_mask = np.zeros((H, W), dtype=bool)

    if verbose:
        typer.echo(f"Canvas: {W}x{H}  Fonts found: {len(fonts)}  Target coverage: {coverage:.0%}")

    iteration = 0
    phrase_count = 0
    next_frame_threshold = 1
    last_captured = -1
    stall_counter = 0
    max_stall = 5000  # give up if this many consecutive placements add nothing
    frames: list[Image.Image] = []

    while True:
        current_coverage = coverage_mask.mean()
        if current_coverage >= coverage:
            break
        if stall_counter >= max_stall:
            typer.echo(
                f"Warning: stalled at {current_coverage:.1%} coverage after {iteration} iterations.",
                err=True,
            )
            break

        iteration += 1

        # Random placement parameters
        angle = rng.uniform(-max_rotation, max_rotation)
        size = rng.randint(min_size, max_size)
        font_path = rng.choice(fonts) if fonts else None
        font = load_font(font_path, size)

        text_img = render_text_mask(phrase, font, angle)

        # Constrain center so the phrase stays fully within the canvas
        tw, th = text_img.size
        cx = rng.randint(tw // 2, max(tw // 2, W - 1 - tw // 2))
        cy = rng.randint(th // 2, max(th // 2, H - 1 - th // 2))

        before = coverage_mask.sum()
        paint(source_lum, canvas_arr, coverage_mask, text_img, cx, cy, gray_shade, threshold)
        after = coverage_mask.sum()

        phrase_count += 1
        if phrase_count >= next_frame_threshold:
            frames.append(Image.fromarray(canvas_arr, mode="RGBA").convert("RGB"))
            last_captured = phrase_count
            next_frame_threshold = phrase_count + max(1, phrase_count // 2)

        if after == before:
            stall_counter += 1
        else:
            stall_counter = 0

        if verbose and iteration % 500 == 0:
            typer.echo(f"  Iteration {iteration:6d}  coverage {coverage_mask.mean():.1%}")

    if verbose:
        typer.echo(f"Done. {iteration} iterations, final coverage {coverage_mask.mean():.1%}")

    # --- Save output as animated GIF ---
    # Append final frame if it wasn't already captured
    if phrase_count > last_captured:
        frames.append(Image.fromarray(canvas_arr, mode="RGBA").convert("RGB"))

    frames[0].save(
        output_image,
        format="GIF",
        save_all=True,
        append_images=frames[1:],
        loop=0,
        duration=500,
    )
    typer.echo(f"Saved to '{output_image}' ({len(frames)} frames)")


if __name__ == "__main__":
    app()
