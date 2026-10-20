from PIL import Image, ImageDraw
from common import S, vt
Image.MAX_IMAGE_PIXELS = None
_cache = {}
def img(vid):
    if vid not in _cache:
        if len(_cache) > 4: _cache.clear()
        _cache[vid] = Image.open(S/'data/img'/vt[vid]['file']).convert('RGB')
    return _cache[vid]
def crop(vid, x, y, frac=0.15, out=640, ring=0.13, marker=None):
    """Square crop of side frac*W centred at ratio (x,y); red ring at centre (and optional second point)."""
    im = img(vid); W, H = im.size; side = max(int(frac * W), 64)
    cx, cy = x * W, y * H; l, t = int(cx - side / 2), int(cy - side / 2)
    c = Image.new('RGB', (side, side), 'white'); c.paste(im.crop((max(l, 0), max(t, 0), min(l + side, W), min(t + side, H))), (max(-l, 0), max(-t, 0)))
    c = c.resize((out, out), Image.LANCZOS); d = ImageDraw.Draw(c); r = ring * out
    d.ellipse((out/2 - r, out/2 - r, out/2 + r, out/2 + r), outline=(230, 0, 0), width=3)
    if marker:
        mx = (marker[0] * W - l) / side * out; my = (marker[1] * H - t) / side * out
        d.ellipse((mx - 14, my - 14, mx + 14, my + 14), fill=(0, 90, 230))
    return c
