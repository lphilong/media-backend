const tsParser = require("@typescript-eslint/parser");
const noControllerResponseRule = require("./tools/eslint/no-controller-response");

module.exports = [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["src/modules/**/*.controller.ts"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: "error",
    },
    plugins: {
      "boundary-lock": {
        rules: {
          "no-controller-response": noControllerResponseRule,
        },
      },
    },
    rules: {
      "boundary-lock/no-controller-response": "error",
    },
  },
];
