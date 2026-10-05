"""Offline packing only: photographic source maps plus a periodic numerical field.
Run from any directory with Pillow and numpy; no network or credentials needed.
"""
from pathlib import Path
import numpy as np
from PIL import Image

root = Path(__file__).resolve().parents[1]
source, output = root / 'assets/source', root / 'public/textures'
for original, name, size, quality in [
    ('materials/clean_asphalt_diff.jpg', 'road-grain', 1024, 86),
    ('materials/clean_asphalt_nor_gl.jpg', 'road-normal', 512, 88),
    ('materials/gravel_floor_02_diff.jpg', 'verge-gravel', 512, 86),
    ('meadow-summer.png', 'meadow-summer', 1024, 88),
]:
    image = Image.open(source / original)
    image.thumbnail((size, size))
    image.save(output / (name + '.webp'), quality=quality, method=6)

# Bake expensive noise once. RGB = broad field and ripple slopes X/Z; alpha is opaque.
rng = np.random.default_rng(731)
size = 256
field = np.zeros((size, size))
for cells, weight in [(4, .52), (8, .27), (16, .14), (32, .07)]:
    grid = rng.random((cells, cells))
    t = np.arange(size) * cells / size
    index, f = np.floor(t).astype(int), t % 1
    f = f * f * (3 - 2 * f)
    a = grid[index[:, None], index[None, :]]
    b = grid[(index[:, None] + 1) % cells, index[None, :]]
    c = grid[index[:, None], (index[None, :] + 1) % cells]
    d = grid[(index[:, None] + 1) % cells, (index[None, :] + 1) % cells]
    field += ((a * (1-f[:, None]) + b * f[:, None]) * (1-f[None, :]) +
              (c * (1-f[:, None]) + d * f[:, None]) * f[None, :]) * weight
dx = (np.roll(field, -1, axis=1) - np.roll(field, 1, axis=1)) * 8
dz = (np.roll(field, -1, axis=0) - np.roll(field, 1, axis=0)) * 8
channels = np.stack([field, .5 + dx, .5 + dz, np.ones((size, size))], axis=-1)
Image.fromarray(np.uint8(np.clip(channels, 0, 1) * 255)).save(output / 'surface-field.webp', lossless=True, method=6)
