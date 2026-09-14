"""Source-exact record contracts, independent of model answers and correctness votes."""
import hashlib
import json
import re
import unicodedata


def normalize(value):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', value).lower())


def fact_matches(question, fact):
    # Closed record-reading grammar: additional conditions and engineering judgments fall back.
    scope, subject = normalize(fact['scope']), normalize(fact['subject'])
    return bool(re.fullmatch(re.escape(scope + 'の' + subject) +
                            r'(?:は|を教えて(?:ください)?|を確認したい|について教えて(?:ください)?)[?？。！!]*', normalize(question)))


def validate_fact_metadata(fact):
    if not isinstance(fact, dict) or set(fact) != {'version', 'scope', 'subject'} or fact['version'] != 1:
        raise ValueError('Invalid source fact contract')
    if not isinstance(fact['scope'], str) or not 1 <= len(fact['scope']) <= 100 or fact['subject'] not in ('記録内容', '記載本文'):
        raise ValueError('Invalid source fact scope')


def label(value):
    return (isinstance(value, str) and 1 <= len(value) <= 60 and value.strip() == value
            and all(unicodedata.category(c)[0] in 'LN' or c in '_.-/ ' for c in value))


def text(value):
    return isinstance(value, str) and bool(value.strip())


def reconstruct(packet):
    """Rebuild allowed answer bytes from authenticated, fingerprint-bound detail fields."""
    ref, detail = packet['source'], packet['detail']
    fingerprint = hashlib.sha256(json.dumps(detail, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
    if detail.get('isError') or ref['sha256'] != fingerprint or detail['content'][0]['type'] != 'text':
        raise ValueError('Source fact detail fingerprint mismatch')
    r = json.loads(detail['content'][0]['text'])
    if (r.get('kind'), r.get('id')) != (ref['kind'], ref['id']):
        raise ValueError('Source fact identity mismatch')
    if r['kind'] == 'nonconformity':
        if 'partNumber' not in r or (r.get('partNumber') is not None and not label(r['partNumber'])) or not label(r.get('nonconformityNo')) or r.get('provenance', {}).get('activeLatest') is not True:
            return None
        fields = [('condition', '不適合内容'), ('remarks', '備考'), ('disposition', '処置内容'), ('correctiveContent', '個別是正内容'),
                  ('partName', '品名'), ('machineName', '機械名'), ('originDepartmentCode', '起因部署コード'),
                  ('originDepartmentName', '起因部署名'), ('discoveredOn', '発見日'), ('sourceVersionDate', '元データ更新日')]
        if (any(r.get(k) is not None and not isinstance(r[k], str) for k, _ in fields)
                or not any(text(r.get(k)) for k, _ in fields[:4])):
            return None
        scope = f"不適合記録{r['nonconformityNo']}"
        if r.get('partNumber') is None:
            fields.insert(0, ('partNumber', '図番'))
        else:
            scope += f"・図番{r['partNumber']}"
        subject = '記録内容'
        answer = scope + '\n過去記録の引用であり、現在の作業指示ではありません。\n' + '\n'.join(
            name + '：' + (r[k] if text(r.get(k)) else '未記録') for k, name in fields)
    elif r['kind'] == 'work_instruction':
        rows = r.get('rows')
        if not label(r.get('partNumber')) or r.get('public') is not True or not label(r.get('shootingTarget')) or not isinstance(rows, list) or len(rows) != 1:
            return None
        row = rows[0]
        steps = row.get('steps', [])
        if (not row.get('publication', {}).get('publishedVersionId') or not text(row.get('sourceVersionDate')) or not steps
                or any(type(s.get('step')) is not int or s['step'] < 1 or not text(s.get('effectiveText')) for s in steps)
                or any(b['step'] <= a['step'] for a, b in zip(steps, steps[1:]))):
            return None
        scope = f"図番{r['partNumber']}・対象{r['shootingTarget']}の公開要領"
        subject = '記載本文'
        answer = (scope + '\n公開された本文の引用です。画像等は元資料で確認してください。\n元データ更新日：'
                  + row['sourceVersionDate'] + '\n' + '\n'.join(f"手順{s['step']}：{s['effectiveText']}" for s in steps))
    else:
        return None
    question = scope + 'の' + subject + 'は？'
    if len(question) > 100 or len(answer) > 4000:
        return None
    return {'question': question, 'answer': answer, 'sources': [ref], 'queries': [question],
            'fact': {'version': 1, 'scope': scope, 'subject': subject}}


def certify(current, candidate, evidence, fingerprints):
    """Only certified additions; no edits to ordinary model answers in this adoption path."""
    if evidence.get('version') != 1 or not isinstance(evidence.get('records'), list) or len(evidence['records']) > 4:
        raise ValueError('Invalid bounded source fact evidence')
    proofs = {}
    for packet in evidence['records']:
        ref = packet['source']
        if fingerprints.get(ref['kind'] + ':' + ref['id']) != ref['sha256']:
            raise ValueError('Source fact is stale or unavailable')
        proof = reconstruct(packet)
        if proof:
            if proof['question'] in proofs:
                raise ValueError('Conflicting source fact scope')
            proofs[proof['question']] = proof
    added = []
    for key, case in candidate.items():
        if current.get(key) == case:
            continue
        proof = proofs.get(key)
        if not proof or case != proof:
            raise ValueError('Candidate is not an exact source fact')
        added.append(proof)
    # Removal is only allowed when a current source is no longer available/current.
    for key, case in current.items():
        if key not in candidate and all(fingerprints.get(s['kind'] + ':' + s['id']) == s['sha256'] for s in case['sources']):
            raise ValueError('Source fact adoption may not remove a current answer')
    return added


def fact_checks(proofs):
    """Source-grounded synthetic tests; never claim these estimate real-user accuracy."""
    checks = []
    for i, p in enumerate(proofs):
        scope, subject = p['fact']['scope'], p['fact']['subject']
        for j, suffix in enumerate(('を教えてください', 'を確認したい')):
            checks.append({'id': f'fact-{i}-positive-{j}', 'question': scope + 'の' + subject + suffix,
                           'expectedSource': p['sources'][0], 'exactAnswer': p['answer']})
        # These do not assert a fabricated business fact; the contract must decline them.
        for j, question in enumerate((scope + 'の' + subject + 'は80℃でも適用できる？',
                                     scope + 'の原因を推測して', '別製品' + scope + 'の' + subject + 'を教えて',
                                     scope + 'の' + subject + 'を省略して教えて')):
            checks.append({'id': f'fact-{i}-negative-{j}', 'question': question})
    return checks
