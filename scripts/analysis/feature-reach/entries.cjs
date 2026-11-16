// 入口の一覧を作る。node scripts/analysis/feature-reach/entries.cjs <web|api|sched> <出力.json>
// web: apps/web/src/pages 配下のページ(テストを除く)
// api: apps/api/src/routes 配下で窓口を登録するファイル。登録しないファイルは理由とともに標準エラーへ出す
// sched: apps/api/src 配下でファイル名に scheduler を含むファイル(テストを除く)
const fs = require('fs'), path = require('path');
const [, , kind, outFile] = process.argv;
const isTest = f => /\.(test|spec)\.tsx?$/.test(f) || /\/__tests__\//.test(f);
function walk(d, acc = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, acc); else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts') && !isTest(p)) acc.push(p); } return acc; }
const REG = /\.(get|post|put|patch|delete|head|options|all)\s*(<[\s\S]*?>)?\s*\(|\.route\s*(<[\s\S]*?>)?\s*\(/;
let out = [];
if (kind === 'web') out = walk('apps/web/src/pages').filter(f => f.endsWith('.tsx')).map(f => ({ name: '画面 ' + path.relative('apps/web/src/pages', f), entries: [f] }));
else if (kind === 'api') {
  for (const f of walk('apps/api/src/routes')) {
    if (path.basename(f) === 'index.ts') continue;
    const s = fs.readFileSync(f, 'utf8');
    if (REG.test(s)) out.push({ name: 'API ' + path.relative('apps/api/src/routes', f), entries: [f] });
    else console.error('入口にしない(窓口の登録が無い):', f);
  }
} else if (kind === 'sched') out = walk('apps/api/src').filter(f => /scheduler/.test(path.basename(f))).map(f => ({ name: '定期 ' + path.relative('apps/api/src', f), entries: [f] }));
else { console.error('種類は web / api / sched'); process.exit(1); }
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
console.error(kind, out.length, '件');
