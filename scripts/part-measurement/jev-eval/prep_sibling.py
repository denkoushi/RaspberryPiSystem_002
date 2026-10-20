"""Task (1): pairwise 'same part family?' over the 30 active drawings. Title block masked, long side <= 1568."""
import json, uuid, itertools
from PIL import Image, ImageDraw
from crops import img
from common import *
cd = S/'data/sib'; cd.mkdir(exist_ok=True)
vids = sorted(by_vid, key=lambda v: vt[v]['name'])
paths = {}
for v in vids:
    im = img(v).copy(); W, H = im.size
    ImageDraw.Draw(im).rectangle((int(0.55 * W), int(0.78 * H), W, H), fill='white')  # title block (品名・図番) hidden
    s = min(1568 / max(W, H), 1.0); im = im.resize((max(int(W * s), 256), max(int(H * s), 256)), Image.LANCZOS)
    p = cd/f'{v[:8]}.jpg'; im.save(p, quality=88); paths[v] = str(p)
fam = {v: base(vt[v]['name']) for v in vids}
with open(S/'data/m_sib.jsonl', 'w') as f:
    for a, b in itertools.combinations(vids, 2):
        ra, rb = str(uuid.uuid4()), str(uuid.uuid4())
        f.write(json.dumps(dict(id=f'{a[:8]}-{b[:8]}', gold=['same'] if fam[a] == fam[b] else ['different'], n=2,
            state={'drawing_a': ra, 'drawing_b': rb},
            criteria={'same': '`drawing_a` と `drawing_b` は同じ系統の部品(同じ種類の部品の別サイズ・左右違い・別機種向けなど)の図面',
                      'different': '`drawing_a` と `drawing_b` は別の種類の部品の図面'},
            assets={ra: paths[a], rb: paths[b]}), ensure_ascii=False) + '\n')
print(len(vids), 'drawings', sum(1 for _ in open(S/'data/m_sib.jsonl')), 'pairs', sum(1 for a, b in itertools.combinations(vids, 2) if fam[a] == fam[b]), 'same-family pairs')
