import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import stylistic from '@stylistic/eslint-plugin'
import stylisticTs from '@stylistic/eslint-plugin-ts'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    plugins: {
      "@stylistic": stylistic,
      "@stylistic/ts": stylisticTs,
    },
    rules: {
      // Typescript rules.
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          "args": "all",
          "argsIgnorePattern": "^_",
          "caughtErrors": "all",
          "caughtErrorsIgnorePattern": "^_",
          "destructuredArrayIgnorePattern": "^_",
          "varsIgnorePattern": "^_",
          "ignoreRestSiblings": true,
        },
      ],
      // Coding style rules.
      //
      // The rules kept here are the ones the codebase already follows. Several stylistic rules that
      // contradict it were removed rather than carried as permanent warnings: `i=0; i<n` spacing,
      // trailing rather than leading operators at a line break, parenthesising mixed arithmetic,
      // the delimiter-alignment indent above, and the object-literal value alignment this
      // codebase uses deliberately. A lint run nobody can get to zero is one nobody
      // reads, and these had accumulated some twenty-two hundred warnings against code that is
      // written the way the project means to write it.
      "@stylistic/array-bracket-spacing": ["warn", "never"],
      "@stylistic/ts/block-spacing": ["warn", "always"],
      "@stylistic/ts/brace-style": ["warn", "1tbs", { "allowSingleLine": true }],
      "@stylistic/ts/comma-dangle": ["warn", {
        "arrays": "never",
        "objects": "always-multiline",
        "imports": "always-multiline",
        "exports": "always-multiline",
        "functions": "never",
        "importAttributes": "never",
        "dynamicImports": "never"
      }],
      "@stylistic/ts/function-call-spacing": ["warn", "never"],
      "@stylistic/implicit-arrow-linebreak": ["warn", "beside"],
      "@stylistic/keyword-spacing": ["warn", { "before": true, "after": true }],
      // Continuation lines are aligned to their opening delimiter throughout this codebase, which
      // no single `indent` configuration expresses; the rule is off rather than reformatting some
      // thirty-five hundred lines to satisfy it. The 120-column cap below is what actually keeps
      // the shape of the code honest.
      "@stylistic/ts/indent": "off",
      "@stylistic/max-len": ["warn", { "code": 120 }],
      "@stylistic/new-parens": ["warn", "always"],
      "@stylistic/no-confusing-arrow": ["warn"],
      "@stylistic/no-mixed-spaces-and-tabs": ["warn"],
      "@stylistic/no-multiple-empty-lines": ["warn", { "max": 1, "maxEOF": 1, "maxBOF": 0 }],
      "@stylistic/no-trailing-spaces": ["warn"],
      "@stylistic/no-whitespace-before-property": ["warn"],
      "@stylistic/ts/object-curly-spacing": ["warn", "always"],
      "@stylistic/one-var-declaration-per-line": ["warn"],
      "@stylistic/padded-blocks": ["warn", "never"],
      "@stylistic/quotes": ["warn", "single", { "allowTemplateLiterals": true, "avoidEscape": true }],
      "@stylistic/ts/semi": ["warn", "never"],
      "@stylistic/ts/space-before-blocks": ["warn", "always"],
      "@stylistic/ts/space-before-function-paren": ["warn", "always"],
      "@stylistic/space-in-parens": ["warn", "never"],
      "@stylistic/space-unary-ops": ["warn", { "words": true, "nonwords": false }],
      "@stylistic/spaced-comment": ["warn", "always"],
      "@stylistic/switch-colon-spacing": ["warn", { "after": true, "before": false }],
      "@stylistic/template-tag-spacing": ["warn", "never"],
      "@stylistic/ts/type-annotation-spacing": ["warn"],
      "@stylistic/wrap-iife": ["warn", "outside"],
    },
  },
  {
    ignores: [
      "eslint.config.mjs",
      "dist/**",
      "**/*.mjs",
      "**/*.js",
    ],
  },
  {
    languageOptions: {
      parserOptions: {
        allowDefaultProject: ["/*.js"],
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
)
