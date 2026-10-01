import js from "@eslint/js"
import eslintConfigPrettier from "eslint-config-prettier"
import pluginImportX from "eslint-plugin-import-x"
import globals from "globals"
import tseslint from "typescript-eslint"

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "temp_research/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    plugins: {
      "import-x": pluginImportX,
    },
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.builtin,
        Bun: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/ban-ts-comment": [
        "warn",
        {
          "ts-expect-error": true,
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-check": false,
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-non-null-asserted-optional-chain": "warn",
      "no-useless-assignment": "warn",
      "no-useless-catch": "warn",
      "no-useless-escape": "warn",
      "preserve-caught-error": "warn",
      "prefer-const": "warn",
      "no-empty": "warn",
      "import-x/order": [
        "warn",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
        },
      ],
      "no-restricted-syntax": [
        "warn",
        {
          selector: "TSAsExpression > TSAnyKeyword",
          message: "Never use 'as any' per AGENTS.md conventions.",
        },
      ],
    },
  },
  {
    // Disallow default exports in src/ with sole exceptions documented in AGENTS.md
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/v2-plugin.ts", "src/tui.ts"],
    rules: {
      "no-restricted-exports": [
        "error",
        {
          restrictDefaultExports: {
            direct: true,
            named: true,
            defaultFrom: true,
            namedFrom: true,
            namespaceFrom: true,
          },
        },
      ],
    },
  },
  eslintConfigPrettier,
)
