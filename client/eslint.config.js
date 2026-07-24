import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // `motion`/`AnimatePresence` are used only inside JSX (`<motion.div>`),
      // which this config can't detect without eslint-plugin-react, so they'd
      // be flagged as unused. Ignore them alongside the capitalized-name pattern.
      'no-unused-vars': ['error', { varsIgnorePattern: '^(motion|AnimatePresence|[A-Z_])' }],
      // Allow exporting a constant alongside a component (e.g. ArchetypeDialog's
      // archetypeDescriptions map) — react-refresh still works for the component.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // Context files intentionally co-locate their provider component with the
    // consumer hook(s) — an idiomatic pattern the dev-only react-refresh rule
    // can't accommodate. The rule has no runtime impact, so disable it here.
    files: ['src/contexts/**/*.jsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
