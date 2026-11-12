import path from 'node:path';

const ignores = [
  '**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx',
  '**/__tests__/**', 'src/test/**', 'src/generated/**'
];
const wrappers = new Set(['TSNonNullExpression', 'TSAsExpression', 'TSSatisfiesExpression', 'ChainExpression']);
const unwrap = node => {
  while (node && wrappers.has(node.type)) node = node.expression;
  return node;
};
const stringValue = node => {
  node = unwrap(node);
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
};
const memberName = node => node.computed ? stringValue(node.property) : node.property.name;
const errorHelpers = new Set(['isAxiosError', 'AxiosError']);
const tenDigits = value => value === '^\\d{10}$' || value === '^[0-9]{10}$';

function budgetRule(guidance, listeners) {
  return {
    meta: {
      type: 'problem',
      schema: [{
        type: 'object',
        properties: {
          appDir: { type: 'string' },
          baseline: { type: 'object', additionalProperties: { type: 'integer', minimum: 0 } }
        },
        required: ['appDir', 'baseline'], additionalProperties: false
      }],
      messages: {
        budget: `${guidance} このファイルの上限 {{cap}} 件、現在 {{count}} 件。減らした後は node scripts/ci/copy-pattern-baseline.mjs update {{app}} で更新してください。`
      }
    },
    create(context) {
      const { appDir, baseline } = context.options[0];
      const file = path.relative(appDir, context.filename).split(path.sep).join('/');
      const nodes = [];
      const visitors = listeners(context, node => nodes.push(node));
      return {
        ...visitors,
        'Program:exit'(node) {
          visitors['Program:exit']?.(node);
          const cap = Object.hasOwn(baseline, file) ? baseline[file] : 0;
          if (nodes.length <= cap) return;
          for (const match of nodes) context.report({
            node: match, messageId: 'budget',
            data: { cap, count: nodes.length, app: path.basename(appDir) }
          });
        }
      };
    }
  };
}

export const copyPatternBudgetPlugin = {
  rules: {
    'x-client-key-literal': budgetRule(
      'x-client-key は src/api/http.ts のインターセプタが全リクエストに自動で付けるので手書きしないでください。',
      (_context, add) => {
        const inspect = node => {
          if (stringValue(node)?.toLowerCase() === 'x-client-key') add(node);
        };
        return { Literal: inspect, TemplateLiteral: inspect };
      }
    ),
    'manual-api-error-message': budgetRule(
      'src/api/errors.ts の getApiErrorMessage を使ってください。',
      (_context, add) => {
        const matches = [];
        return {
          MemberExpression(node) {
            let current = node;
            for (const name of ['message', 'data', 'response']) {
              current = unwrap(current);
              if (current?.type !== 'MemberExpression' || memberName(current) !== name) return;
              current = current.object;
            }
            matches.push(node);
          },
          'Program:exit'() {
            const matched = new Set(matches);
            for (const node of matches) {
              let parent = node.parent;
              let child = node;
              let duplicate = false;
              while (parent && (wrappers.has(parent.type) || (parent.type === 'MemberExpression' && parent.object === child))) {
                if (matched.has(parent)) duplicate = true;
                child = parent;
                parent = parent.parent;
              }
              if (!duplicate) add(node);
            }
          }
        };
      }
    ),
    'direct-http-client': budgetRule(
      'HTTP 通信は src/api/ のクライアント（src/api/http.ts）経由にしてください。API 以外のホスト（ローカルエージェント等）への通信も src/api/ 側に関数を置いて呼んでください。',
      (context, add) => {
        const axiosVariables = new Set();
        const candidates = [];
        function isAxios(node) {
          node = unwrap(node);
          if (node?.type !== 'Identifier') return false;
          for (let scope = context.sourceCode.getScope(node); scope; scope = scope.upper) {
            const variable = scope.set.get(node.name);
            if (variable) return axiosVariables.has(variable);
          }
          return false;
        }
        return {
          ImportDeclaration(node) {
            if (node.source.value !== 'axios' || node.importKind === 'type') return;
            for (const specifier of node.specifiers) {
              if (specifier.importKind === 'type') continue;
              if (specifier.type === 'ImportSpecifier') {
                if (!errorHelpers.has(specifier.imported.name ?? specifier.imported.value)) add(specifier);
              } else {
                for (const variable of context.sourceCode.getDeclaredVariables(specifier)) axiosVariables.add(variable);
              }
            }
          },
          ImportExpression(node) {
            if (stringValue(node.source) === 'axios') add(node);
          },
          CallExpression(node) {
            const callee = unwrap(node.callee);
            if (callee?.type === 'Identifier' && callee.name === 'fetch') add(node);
            else if (callee?.type === 'MemberExpression' && memberName(callee) === 'fetch' &&
              ['window', 'globalThis', 'self'].includes(unwrap(callee.object)?.name)) add(node);
            else if (callee?.type === 'Identifier' && callee.name === 'require' && stringValue(node.arguments[0]) === 'axios') add(node);
            else candidates.push([node, callee]);
          },
          MemberExpression(node) {
            if (!errorHelpers.has(memberName(node))) candidates.push([node, node.object]);
          },
          'Program:exit'() {
            for (const [node, receiver] of candidates) if (isAxios(receiver)) add(node);
          }
        };
      }
    ),
    'ten-digit-regex': budgetRule(
      '10桁の番号判定は packages/shared-types の製番ヘルパーを使ってください。',
      (_context, add) => {
        const inspect = node => {
          if (node.callee.type === 'Identifier' && node.callee.name === 'RegExp' && node.arguments[0]?.type === 'Literal' && tenDigits(stringValue(node.arguments[0]))) add(node);
        };
        return {
          Literal(node) { if (node.regex && tenDigits(node.regex.pattern)) add(node); },
          NewExpression: inspect,
          CallExpression: inspect
        };
      }
    )
  }
};

export function copyPatternBudgetConfigs({ app, appDir, baseline }) {
  const targets = app === 'web' ? {
    'x-client-key-literal': ['src/api/domains/**', 'src/features/**'],
    'manual-api-error-message': ['src/features/**', 'src/pages/**'],
    'direct-http-client': ['src/**'],
    'ten-digit-regex': ['src/**']
  } : { 'ten-digit-regex': ['src/**'] };
  const extensions = app === 'web' ? ['**/*.ts', '**/*.tsx'] : ['**/*.ts'];
  return [
    { plugins: { 'copy-pattern-budget': copyPatternBudgetPlugin } },
    ...Object.entries(targets).map(([rule, files]) => ({
      files: files.flatMap(file => extensions.map(extension => [extension, file])),
      ignores: rule === 'direct-http-client' ? [...ignores, 'src/api/**'] : ignores,
      rules: { [`copy-pattern-budget/${rule}`]: ['error', { appDir, baseline: baseline[rule] ?? {} }] }
    }))
  ];
}
