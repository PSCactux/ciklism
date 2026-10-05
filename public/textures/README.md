# Landscape assets

These files ship with the app and are precached for offline use. Nothing is
requested from texture providers during a ride. Source images are resized and
compressed with `scripts/prepare-textures.py` and `scripts/prepare-roadside.py`
(Pillow, NumPy).

| WebP files | Source | License / preparation |
| --- | --- | --- |
| `asphalt-Diffuse`, `asphalt-nor_gl` | [Asphalt 02, Poly Haven](https://polyhaven.com/a/asphalt_02) | CC0; colour 1024², OpenGL normal 512² |
| `grass-Diffuse`, `grass-nor_gl` | [Leafy Grass, Poly Haven](https://polyhaven.com/a/leafy_grass) | CC0; colour 1024², OpenGL normal 512² |
| `gravel-Diffuse` | [Gravel Road, Poly Haven](https://polyhaven.com/a/gravel_road) | CC0; colour 512² |
| `bark_diff` | [Pine Tree 01, Poly Haven](https://polyhaven.com/a/pine_tree_01) | CC0; 512² bark atlas |
| `sky` | [Kloofendal 48d Partly Cloudy, Poly Haven](https://polyhaven.com/a/kloofendal_48d_partly_cloudy) | CC0; tone-mapped JPG, downscaled to 2048×1024 |
| `road-grain`, `road-normal` | [Clean Asphalt, Poly Haven](https://polyhaven.com/a/clean_asphalt) | CC0; colour 1024², normal 512² |
| `verge-gravel` | [Gravel Floor 02, Poly Haven](https://polyhaven.com/a/gravel_floor_02) | CC0; grey gravel 512² |
| `pine-tree` | AI-generated for this project | RGBA source in `assets/source/pine-tree.png`, reduced to 512×768 keeping alpha |
| `valley-trees` | AI-generated for this project | Spruce + alder RGBA atlas in `assets/source/valley-trees.png`, 1024×683 |
| `meadow-summer` | AI-generated for this project | Source in `assets/source/meadow-summer.png`, colour 1024² |
| `surface-field` | Generated numerically | Periodic 256² field: R = broad variation, G/B = ripple slopes, A = opaque. Linear data |

[Poly Haven asset license](https://polyhaven.com/license). The 1k originals of the
road and verge materials are kept in `assets/source/materials/`. Close-up grass is
opaque geometry, with no cutout atlas.

## Generation prompts

**Summer meadow** (`meadow-summer`):

> Use case: photorealistic-natural. Asset: seamless tileable albedo texture for a realistic European riverside meadow in a mobile 3D cycling game. Square 1024x1024, orthographic photograph looking straight down at ONE square metre of dense natural short meadow grass, fine narrow irregular blades bending in many directions, mostly living muted sage and olive greens mixed with a few dry straw blades and tiny clover leaves. Dense organic fine detail, no bare soil patches, no large leaves, no visible flowers, no paving, no patterns of mowing or stripes. Completely even diffuse overcast lighting; no directional shadows, no highlights or vignette, flat exposure and consistent average colour across the entire image. All four edges tile seamlessly. Real photographic texture, not illustration. No text, no border, no objects, no grid. Texture must not have large distinct features or any recognizable repeated pattern.

**Pine** (`pine-tree`, the generated image already had alpha):

> Use case: photorealistic-natural. Asset type: transparent RGBA tree cutout for efficient distant vegetation in a 3D cycling landscape. Generate ONE exceptionally realistic mature Scots pine / Mediterranean mountain pine, entire tree including trunk base and highest needles, isolated on a genuinely transparent background with no ground or cast shadow. Tall asymmetrical naturally grown tree, about 12 metres tall, dense irregular layered crown with substantial depth, numerous fine olive green needle clusters and weathered gray-brown bark, a little orange bark high on the trunk, natural gaps between branches, lower trunk visible up to 25 percent of total height. Straight-on eye-level telephoto botanical photograph, minimal perspective, neutral overcast soft daylight with subtle soft directional light from upper left. Needles and twigs sharp, realistic muted forest green, no black silhouettes. Fill a portrait composition, centered with small transparent margins, full tree not cropped. No text, labels, objects, scenery, background color, checkerboard, illustration, stylization or decorative effects. Preserve real transparency between needles and around all branches.

**River valley forest** (`valley-trees`, used for crowns and their baked shadows):

> Use case: photorealistic-natural. Asset type: transparent RGBA tree billboard atlas for a real-time 3D cycling landscape. Create a landscape 1536x1024 image containing exactly TWO separate full mature trees side by side, each centered in its own half of the image, both trunk bases aligned 3 percent above bottom edge and treetops 3 percent below top edge. LEFT: a dense European Norway spruce, conical irregular tiered silhouette, dark forest green needles, thick opaque foliage covering nearly all branches down to the lower trunk. RIGHT: a mature European alder, a dense rounded oval canopy of rich medium green leaves, mostly opaque with small realistic gaps, branching grey trunk visible in lower fifth. Entire trees from tip to base, clean separation of 5 percent transparent gutter between trees. Telephoto botanical photography, soft neutral daylight, subtle highlights upper left, realistic depth and internal canopy shade, detailed organic leaf clusters. Truly transparent background and transparency around silhouettes; no background, no ground, no cast shadow, no halo, no scenery, no text, no labels. These will be rendered as individual 20m-tall forest trees, prioritize dense legible crowns over sparse twigs. NOT an illustration or flat vector.
