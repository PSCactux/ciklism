"""Pack downloaded CC0 source maps into bounded, offline runtime assets.
Run with Pillow: python3 scripts/prepare-textures.py /path/to/source-maps
Source URLs and license are recorded in public/textures/README.md.
"""
from pathlib import Path
import sys
from PIL import Image
source = Path(sys.argv[1])
out = Path(__file__).resolve().parents[1] / 'public' / 'textures'
out.mkdir(parents=True, exist_ok=True)
for name, size, quality in [('asphalt-Diffuse', 1024, 82), ('asphalt-nor_gl', 512, 85),
                            ('grass-Diffuse', 1024, 82), ('grass-nor_gl', 512, 85),
                            ('gravel-Diffuse', 512, 80), ('bark_diff', 512, 80)]:
    files = list(source.glob(name + '.*'))
    image = Image.open(files[0]).convert('RGB')
    image = image.resize((size, size), Image.Resampling.LANCZOS)
    image.save(out / (name + '.webp'), quality=quality, method=6)
Image.open(source / 'sky.jpg').resize((2048, 1024), Image.Resampling.LANCZOS).save(out / 'sky.webp', quality=82, method=6)
pine = Image.open(out.parents[1] / 'assets' / 'source' / 'pine-tree.png')
pine.thumbnail((512, 1024))
pine.save(out / 'pine-tree.webp', quality=86, method=6)
valley = Image.open(out.parents[1] / 'assets' / 'source' / 'valley-trees.png')
valley.thumbnail((1024, 1024))
valley.save(out / 'valley-trees.webp', quality=88, method=6)
for file in sorted(out.glob('*.webp')):
    print(file.name, file.stat().st_size)
