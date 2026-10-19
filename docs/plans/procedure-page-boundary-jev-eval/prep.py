# Build the labelled page sequence for the JEV image boundary evaluation.
import json, random, re, sys, os, pymupdf
D = os.path.expanduser('~/Downloads'); K = os.path.expanduser('~/RaspiKnowledgeSamples/files/pdfs')
OUT = sys.argv[1]
G = [f'{D}/産1-G0{n}AAK.pdf' for n in range(12, 19)] + [f'{K}/{f}' for f in sorted(os.listdir(K)) if f.startswith('_1-G')]
docs = [(f, list(range(5))) for f in G]
random.seed(20261015)
for f in random.sample(G, 4):  # 4 docs keep their near-blank template pages 6-7
    docs[[d[0] for d in docs].index(f)] = (f, list(range(7)))
docs += [(f'{D}/TEST-002.pdf', [0, 1, 2]), (f'{D}/産2-U004BBC_No_02.pdf', [0]),
         (f'{K}/SD000032603____OP-01_33cbcbdc-4321-4b5a-85dd-f4e295f0355a.pdf', [0]),
         (f'{D}/20260106161155.pdf', [0]), (f'{D}/7161足（2）.pdf', [0]), (f'{D}/7161ベース (1).pdf', [0])]
random.shuffle(docs)
os.makedirs(f'{OUT}/pages', exist_ok=True)
pages = []
for di, (f, idx) in enumerate(docs):
    pdf = pymupdf.open(f)
    for i in idx:
        p = pdf[i]
        s = 1568 / max(p.rect.width, p.rect.height)
        pix = p.get_pixmap(matrix=pymupdf.Matrix(s, s))
        w, h = pix.width, pix.height
        assert 256 <= min(w, h) and max(w, h) <= 1568 and 78400 <= w * h <= 2458624, (f, i, w, h)
        pid = f'd{di:02d}p{i+1}'
        path = f'{OUT}/pages/{pid}.jpg'
        pix.save(path, jpg_quality=85)
        text = p.get_text()
        pages.append({'id': pid, 'doc': di, 'source': os.path.basename(f), 'page': i + 1, 'start': i == idx[0],
                      'blank': len(text.strip()) < 20 and not p.get_images(), 'w': w, 'h': h, 'bytes': os.path.getsize(path),
                      'docTokens': sorted(set(re.findall(r'[A-Z0-9産]{1,4}\d?-[A-Z0-9]{3,}(?:-\d)?', text.replace(' ', ''))))})
json.dump(pages, open(f'{OUT}/dataset.json', 'w'), ensure_ascii=False, indent=1)
print(len(docs), 'docs', len(pages), 'pages', sum(p['start'] for p in pages[1:]), 'boundaries', sum(p['blank'] for p in pages), 'blank')
print('max bytes', max(p['bytes'] for p in pages))
for a, b in zip(pages, pages[1:]):
    if b['start']: print(' ', a['source'][:14], '->', b['source'][:14])
