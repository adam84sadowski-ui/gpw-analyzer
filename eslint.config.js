import reactPlugin from 'eslint-plugin-react'

export default [
  {
    files: ['**/*.{js,jsx}'],
    plugins: { react: reactPlugin },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
    settings: {
      react: { version: 'detect' },
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        process: 'readonly',
        Promise: 'readonly',
        Date: 'readonly',
        Math: 'readonly',
        JSON: 'readonly',
        Set: 'readonly',
        Map: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'api/**'],
  },
]
