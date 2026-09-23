module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true
  },
  parserOptions: {
    sourceType: 'module',
    project: './tsconfig.eslint.json'
  },
  plugins: ['unused-imports', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier'
  ],
  parser: '@typescript-eslint/parser',
  rules: {
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
  },
  overrides: [
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
  ]
};
