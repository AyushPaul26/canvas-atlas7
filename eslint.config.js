import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
export default tseslint.config({ignores:['**/out/**','node_modules/**','release/**','test-results/**','playwright-report/**','.test-tmp/**','private/**']}, js.configs.recommended, ...tseslint.configs.recommended, {
  files:['**/*.{ts,tsx,js,mjs}'],languageOptions:{globals:{...globals.node,...globals.browser}},
  rules:{'@typescript-eslint/no-explicit-any':'off','@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}]},
});
