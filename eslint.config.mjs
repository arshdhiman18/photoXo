import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Architectural guardrails. The secure path must be the easy path:
 * Mongoose models may only be imported by the data-access layer
 * (repositories), the auth bootstrap, and scripts/tests. Pages, actions and
 * services go through scoped repositories, which always apply agency +
 * actor visibility.
 */
const restrictModelImports = {
  files: ["src/**/*.{ts,tsx}"],
  ignores: [
    "src/server/db/**",
    "src/server/repositories/**",
    "src/server/auth/**",
    "src/server/activity/**",
  ],
  rules: {
    "@typescript-eslint/no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@/server/db/models", "@/server/db/models/*"],
            allowTypeImports: true,
            message:
              "Do not query models directly. Use a scoped repository in src/server/repositories (applies agency + actor visibility).",
          },
          {
            group: ["mongoose", "mongodb"],
            allowTypeImports: true,
            message: "Database drivers are only allowed in src/server/db and repositories.",
          },
        ],
      },
    ],
  },
};

/** Client components must never import server modules. */
const restrictServerInClient = {
  files: ["src/components/**/*.{ts,tsx}", "src/features/**/components/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@/server/*", "!@/server/actions"],
            message: "UI components may not import server modules (only server actions).",
          },
        ],
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  restrictModelImports,
  restrictServerInClient,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".data/**", "coverage/**"]),
]);

export default eslintConfig;
