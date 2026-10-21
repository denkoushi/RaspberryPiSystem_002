import fs from 'node:fs';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import unusedImports from 'eslint-plugin-unused-imports';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// Size ratchet: new source files stay within 600 lines; files listed in the baseline were
// already larger and are capped at their recorded size. Regenerate with
// `node scripts/ci/max-lines-baseline.mjs update api` (it only lowers caps).
const maxLinesBaseline = JSON.parse(fs.readFileSync(new URL('./eslint-max-lines-baseline.json', import.meta.url), 'utf8'));
const maxLinesOptions = { skipBlankLines: true, skipComments: true };
const maxLinesOverrides = [
  {
    files: ['src/**/*.ts'],
    ignores: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx', '**/__tests__/**', 'src/test/**', 'src/generated/**'],
    rules: { 'max-lines': ['error', { max: 600, ...maxLinesOptions }] }
  },
  ...Object.entries(maxLinesBaseline).map(([file, max]) => ({
    files: [file],
    rules: { 'max-lines': ['error', { max, ...maxLinesOptions }] }
  }))
];

export default tseslint.config(
  // Flat config includes JavaScript and dotfiles by default; retain the old .ts-only target set.
  { ignores: ['**/node_modules/**', 'dist/**', '**/.*', '**/*.{js,cjs,mjs}'] },
  {
    files: ['**/*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      importPlugin.flatConfigs.recommended,
      importPlugin.flatConfigs.typescript,
      prettier
    ],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022 },
      sourceType: 'module',
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: { 'unused-imports': unusedImports },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      // Preserve ESLint 8 / typescript-eslint 7 recommended behavior.
      'no-constant-binary-expression': 'off',
      'no-empty-static-block': 'off',
      'no-new-native-nonconstructor': 'off',
      'no-unused-private-class-members': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none' }],
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-var-requires': 'error',
      '@typescript-eslint/prefer-namespace-keyword': 'off',
      // ban-types prohibited {} types, Function and boxed primitives, but allowed empty interfaces.
      '@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'always' }],
      'unused-imports/no-unused-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'import/no-unresolved': 'off',
      'import/order': 'off',
      'import/no-cycle': 'error',
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/services',
              from: './src/routes',
              message: 'services層からroutes層への依存は禁止です（依存方向: routes -> services）。'
            },
            {
              target: './src/lib',
              from: './src/routes',
              message: 'lib層からroutes層への依存は禁止です（依存方向: routes/services -> lib）。'
            },
            {
              target: './src/lib',
              from: './src/services',
              message: 'lib層からservices層への依存は禁止です（依存方向: routes/services -> lib）。'
            },
            {
              target: './src/routes/clients',
              from: './src/routes/kiosk',
              message: 'routes/kiosk から routes/clients への依存は禁止です（機能境界の横断を防止）。'
            },
            {
              target: './src/routes/kiosk',
              from: './src/routes/clients',
              message: 'routes/clients から routes/kiosk への依存は禁止です（機能境界の横断を防止）。'
            },
            {
              target: './src/routes/backup',
              from: './src/routes/imports',
              message: 'routes/imports から routes/backup への依存は禁止です（機能境界の横断を防止）。'
            },
            {
              target: './src/routes/imports',
              from: './src/routes/backup',
              message: 'routes/backup から routes/imports への依存は禁止です（機能境界の横断を防止）。'
            },
            {
              target: './src/routes/system',
              from: './src/routes/kiosk',
              message: 'routes/kiosk から routes/system への依存は禁止です（機能境界の横断を防止）。'
            },
            {
              target: './src/routes/kiosk',
              from: './src/routes/system',
              message: 'routes/system から routes/kiosk への依存は禁止です（機能境界の横断を防止）。'
            }
          ]
        }
      ]
    }
  },
  ...[
    ...maxLinesOverrides,
    {
      "files": [
        "src/services/part-measurement/part-measurement-resolve.service.ts",
        "src/services/mobile-placement/mobile-placement-order-lookup.ts",
        "src/services/mobile-placement/haizen-placement.service.ts",
        "src/services/mobile-placement/mobile-placement-order-placement.service.ts",
        "src/services/mobile-placement/mobile-placement-slip-match.ts",
        "src/services/pallet-visualization/pallet-visualization-schedule-resolver.ts"
      ],
      "rules": {
        "no-restricted-imports": [
          "error",
          {
            "patterns": [
              {
                "group": [
                  "**/part-measurement-schedule-lookup.service",
                  "**/part-measurement-schedule-lookup.service.js",
                  "**/part-measurement-schedule-lookup.service.ts"
                ],
                "message": "日程検索は production-schedule/production-schedule-lookup.service.js を参照する。"
              },
              {
                "group": [
                  "**/part-measurement/index",
                  "**/part-measurement/index.js",
                  "**/part-measurement/index.ts"
                ],
                "importNames": [
                  "listScheduleRowsByProductNo",
                  "listScheduleRowsByFseiban",
                  "resolveMachineNameForSeiban",
                  "PartMeasurementScheduleRowCandidate"
                ],
                "message": "日程検索を part-measurement の再export経由で参照しない。"
              }
            ]
          }
        ]
      }
    },
    {
      "files": [
        "src/services/production-schedule/production-schedule-lookup.service.ts",
        "src/services/production-schedule/production-schedule-snapshot.service.ts",
        "src/services/production-schedule/production-schedule-snapshot-fields.ts",
        "src/services/production-schedule/seiban-progress.service.ts",
        "src/services/production-schedule/production-schedule-effective-completion.sql.ts",
        "src/services/production-schedule/constants.ts",
        "src/services/production-schedule/row-resolver/*.ts"
      ],
      "rules": {
        "no-restricted-imports": [
          "error",
          {
            "patterns": [
              {
                "group": [
                  "**/part-measurement/**",
                  "**/mobile-placement/**",
                  "**/pallet-visualization/**",
                  "**/production-schedule-query.service",
                  "**/production-schedule-query.service.js",
                  "**/production-schedule-query.service.ts",
                  "**/production-schedule-query/**"
                ],
                "message": "日程lookupの読取依存から利用業務や広いquery facadeへ逆依存させない。"
              }
            ]
          }
        ]
      }
    },
    {
      files: [
        'src/services/mobile-placement/mobile-placement.service.ts',
        'src/services/mobile-placement/mobile-placement-order-placement.service.ts',
        'src/services/mobile-placement/haizen-placement.service.ts',
        'src/services/pallet-visualization/pallet-visualization-schedule-resolver.ts',
        'src/services/pallet-visualization/pallet-visualization-query.service.ts'
      ],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: "MemberExpression[property.name='csvDashboardRow'], MemberExpression[computed=true][property.value='csvDashboardRow'], Property[key.name='csvDashboardRow'], Property[key.value='csvDashboardRow']",
            message: '選択済み日程行の読取は production-schedule-snapshot.service.js の公開窓口を使う。'
          }
        ]
      }
    },
    {
      files: ['src/services/part-measurement/self-inspection.service.ts'],
      rules: {
        'max-lines': ['error', { max: 350, skipBlankLines: true, skipComments: true }],
        'max-lines-per-function': [
          'error',
          { max: 40, skipBlankLines: true, skipComments: true, IIFEs: true }
        ],
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/lib/prisma.js', '**/lib/prisma'],
                message: 'SelfInspectionService facade must delegate database work to use cases.'
              }
            ]
          }
        ]
      }
    },
    {
      files: ['src/services/part-measurement/self-inspection/use-cases/**/*.ts'],
      rules: {
        'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
        'max-lines-per-function': [
          'error',
          { max: 220, skipBlankLines: true, skipComments: true, IIFEs: true }
        ],
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/self-inspection.service.js', '**/self-inspection.service'],
                message: 'Self-inspection use cases must not depend on their facade.'
              }
            ]
          }
        ]
      }
    },
    {
      files: ['src/**/*.{test,spec}.ts', 'src/**/__tests__/**/*.{ts,tsx}'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
        'unused-imports/no-unused-imports': 'off'
      }
    }
  ].map(config => ({
    ...config,
    files: config.files.map(file => ['**/*.ts', file])
  }))
);
