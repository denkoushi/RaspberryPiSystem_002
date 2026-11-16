// 型チェッカーで、import した名前ごとに「定義されているファイル」まで解決してたどる(まとめ役の index を素通りする)。
const ts = require(process.env.TSPATH ? require("path").resolve(process.env.TSPATH) : require("path").resolve("apps/api/node_modules/typescript"));
const fs = require('fs'), path = require('path');
const ROOT = process.cwd();
const [, , app, groupsFile, outFile] = process.argv;
const cfgPath = path.join(ROOT, 'apps', app, 'tsconfig.json');
const cfg = ts.getParsedCommandLineOfConfigFile(cfgPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
// テストも含めてプログラムに入れる
const extra = [];
(function walk(d){ for (const e of fs.readdirSync(d,{withFileTypes:true})) { if (['node_modules','dist','generated'].includes(e.name)) continue; const p=path.join(d,e.name); if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) extra.push(p);} })(path.join(ROOT,'apps',app,'src'));
const opts = { ...cfg.options, noEmit: true, skipLibCheck: true, types: cfg.options.types };
// 共有パッケージは src を見る
opts.paths = {}; opts.baseUrl = ROOT;
for (const p of fs.readdirSync(path.join(ROOT,'packages'))) { const j = JSON.parse(fs.readFileSync(path.join(ROOT,'packages',p,'package.json'))); opts.paths[j.name] = ['packages/'+p+'/src/index.ts']; opts.paths[j.name+'/*'] = ['packages/'+p+'/src/*']; }
const program = ts.createProgram({ rootNames: [...new Set([...cfg.fileNames, ...extra])], options: opts });
const checker = program.getTypeChecker();
const mine = f => f && !f.includes('/node_modules/') && !f.endsWith('.d.ts') && (f.startsWith(path.join(ROOT,'apps',app,'src')) || f.startsWith(path.join(ROOT,'packages')));
const depCache = new Map();
function declFiles(sym) {
  const out = new Set();
  if (!sym) return out;
  let s = sym; try { if (s.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s); } catch {}
  for (const d of (s.declarations||[])) out.add(path.resolve(d.getSourceFile().fileName));
  return out;
}
function deps(fileName) {
  if (depCache.has(fileName)) return depCache.get(fileName);
  const sf = program.getSourceFile(fileName); const out = new Set();
  depCache.set(fileName, out);
  if (!sf) return out;
  const modFile = (spec) => { const s = checker.getSymbolAtLocation(spec); const d = s && s.declarations && s.declarations[0]; return d ? path.resolve(d.getSourceFile().fileName) : null; };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const spec = node.moduleSpecifier; if (!spec) return;
      const mf = modFile(spec);
      let named = [];
      if (ts.isImportDeclaration(node)) {
        const ic = node.importClause;
        if (!ic) { if (mf) out.add(mf); return; } // 副作用 import
        if (process.env.RUNTIME && ic.isTypeOnly) return;
        if (ic.name) named.push(ic.name);
        const nb = ic.namedBindings;
        if (nb && ts.isNamespaceImport(nb)) { if (mf) out.add(mf); }
        else if (nb) for (const el of nb.elements) { if (process.env.RUNTIME && el.isTypeOnly) continue; named.push(el.name); }
      } else {
        // export ... from: まとめ役。ここ自身の依存としては、名前ごとの定義元を足す(export * はモジュールごと)
        if (process.env.RUNTIME && node.isTypeOnly) return;
        if (node.exportClause && ts.isNamedExports(node.exportClause)) for (const el of node.exportClause.elements) named.push(el.name);
        else if (mf) out.add(mf);
      }
      for (const n of named) { const s = checker.getSymbolAtLocation(n); const fs_ = declFiles(s); if (fs_.size) fs_.forEach(f => out.add(f)); else if (mf) out.add(mf); }
      return;
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0]) { const mf = modFile(node.arguments[0]); if (mf) out.add(mf); }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  for (const f of [...out]) if (!mine(f) || f === path.resolve(fileName)) out.delete(f);
  return out;
}
function closure(entries) { const seen = new Set(); const st = [...entries]; while (st.length) { const f = st.pop(); if (seen.has(f)) continue; seen.add(f); for (const d of deps(f)) if (!seen.has(d)) st.push(d); } return seen; }
const isTest = f => /\.(test|spec)\.tsx?$/.test(f) || /\/__tests__\//.test(f);
const sizes = new Map(); const sz = f => { if (!sizes.has(f)) { const s = fs.readFileSync(f,'utf8'); sizes.set(f, { lines: s.split('\n').length, chars: s.length }); } return sizes.get(f); };
const testsOf = new Map();
for (const t of extra.filter(isTest).map(f=>path.resolve(f))) for (const d of deps(t)) { if (!testsOf.has(d)) testsOf.set(d, new Set()); testsOf.get(d).add(t); }
const groups = JSON.parse(fs.readFileSync(groupsFile,'utf8'));
const res = groups.map(g => {
  const c = closure(g.entries.map(e => path.resolve(e)));
  let lines = 0, chars = 0; for (const f of c) { const s = sz(f); lines += s.lines; chars += s.chars; }
  const own = new Set(); for (const f of c) for (const t of (testsOf.get(f)||[])) own.add(t);
  // 入口に近いテストだけ: 入口そのもの、または入口と同じフォルダ以下のファイルを import するテスト
  let tc = 0; for (const t of own) tc += sz(t).chars;
  return { name: g.name, files: c.size, lines, chars, tests: own.size, testChars: tc, closure: [...c].map(f => path.relative(ROOT, f)) };
});
fs.writeFileSync(outFile, JSON.stringify(res, null, 1));
for (const r of [...res].sort((a,b)=>b.chars-a.chars)) console.log([r.name, r.files, r.lines, Math.round(r.chars/3.5/1000)+'k', r.tests, Math.round(r.testChars/3.5/1000)+'k'].join('\t'));
if (process.env.DUMP) { const adj = {}; for (const f of extra) { const k = path.relative(ROOT, path.resolve(f)); adj[k] = [...deps(path.resolve(f))].map(x => path.relative(ROOT, x)); } for (const [f, d] of depCache) { const k = path.relative(ROOT, f); if (!adj[k]) adj[k] = [...d].map(x => path.relative(ROOT, x)); } fs.writeFileSync(process.env.DUMP, JSON.stringify(adj)); }
