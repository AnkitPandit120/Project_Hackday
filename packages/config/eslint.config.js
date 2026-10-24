import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"],
  },
  {
    rules: {
      "no-console": ["error", { allow: ["error", "warn"] }],
      "no-unused-vars": "off",
    },
  },
];
