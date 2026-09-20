import baseFixture from './base-fixture.json' with { type: 'json' };

const additionalRecords = [
  {
    id: 'fixture-nc-004',
    rawText: '工程：旋盤加工。現象：外径が規格上限を0.08 mm超過。処置：選別して隔離。',
    expectedClassification: { process: 'turning', phenomenon: 'oversize', treatment: 'segregate', cause: 'unknown' },
  },
  {
    id: 'fixture-nc-005',
    rawText: '工程：フライス加工。現象：側面に打痕を確認。処置：再加工を実施。',
    expectedClassification: { process: 'milling', phenomenon: 'surface_damage', treatment: 'rework', cause: 'unknown' },
  },
  {
    id: 'fixture-nc-006',
    rawText: '工程：検査。現象：刻印が一部欠落。処置：選別して隔離。原因は記載なし。',
    expectedClassification: { process: 'inspection', phenomenon: 'missing_marking', treatment: 'segregate', cause: 'unknown' },
  },
];

const query = (id, text, expectedClassification, expectedRecordIds) => ({
  id,
  text,
  expectedClassification,
  expectedRecordIds,
});

export default {
  schemaVersion: 2,
  fixtureId: 'hermes-jev-record-pilot-expanded-v1',
  classificationAxes: baseFixture.classificationAxes,
  records: [...baseFixture.records, ...additionalRecords],
  queries: [
    query('query-expanded-display-turning-treatment', '旋盤加工で寸法が上限を超えた不適合の処置を確認したい。', { process: 'turning', phenomenon: 'oversize', treatment: 'unknown', cause: 'unknown' }, ['fixture-nc-001', 'fixture-nc-004']),
    query('query-expanded-display-milling-treatment', 'フライス加工で表面に打痕がある不適合を探したい。処置も確認したい。', { process: 'milling', phenomenon: 'surface_damage', treatment: 'unknown', cause: 'unknown' }, ['fixture-nc-002', 'fixture-nc-005']),
    query('query-expanded-rework-turning', '旋盤加工で寸法が上限を超え、再加工した不適合記録を探して原文を確認したい。', { process: 'turning', phenomenon: 'oversize', treatment: 'rework', cause: 'unknown' }, ['fixture-nc-001']),
    query('query-expanded-segregate-turning', '旋盤加工で寸法が上限を超え、選別して隔離した不適合記録を探して原文を確認したい。', { process: 'turning', phenomenon: 'oversize', treatment: 'segregate', cause: 'unknown' }, ['fixture-nc-004']),
    query('query-expanded-segregate-milling', 'フライス加工で表面に打痕があり、選別して隔離した不適合記録を探したい。', { process: 'milling', phenomenon: 'surface_damage', treatment: 'segregate', cause: 'unknown' }, ['fixture-nc-002']),
    query('query-expanded-rework-milling', 'フライス加工で表面に打痕があり、再加工した不適合記録を探したい。', { process: 'milling', phenomenon: 'surface_damage', treatment: 'rework', cause: 'unknown' }, ['fixture-nc-005']),
  ],
};
