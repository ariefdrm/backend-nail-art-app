// @ts-check

import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

// Production runs on Node, so src/ must not depend on Bun-only APIs.
const bunImportPatterns = [
  { group: ["bun", "bun:*"], message: "Bun-only APIs are not allowed in src/ (production runs on Node)." },
];

const prismaImportPatterns = [
  {
    group: ["@prisma/client", "@prisma/client/*", "@prisma/adapter-pg", "**/generated/prisma", "**/generated/prisma/*"],
    message: "Only repositories/ (and utils/prisma.ts) may import Prisma.",
  },
];

/**
 * Layer rule: routes -> controllers -> services -> repositories.
 * `forbidden` lists the layers a given layer must not import.
 * @param {string} files
 * @param {string[]} forbidden
 * @param {boolean} blockPrisma
 */
function layer(files, forbidden, blockPrisma = true) {
  return {
    files: [files],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...bunImportPatterns,
            ...(blockPrisma ? prismaImportPatterns : []),
            ...forbidden.map((name) => ({
              group: [`**/${name}/*`, `**/${name}`],
              message: `This layer must not import from ${name}/ (routes -> controllers -> services -> repositories).`,
            })),
          ],
        },
      ],
    },
  };
}

export default defineConfig(
  globalIgnores(["dist", "coverage", "node_modules", "src/generated"]),
  {
    files: ["**/*.ts"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      tseslint.configs.strict,
      tseslint.configs.stylistic,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "Bun", message: "Bun-only APIs are not allowed in src/ (production runs on Node)." },
      ],
      "no-restricted-imports": ["error", { patterns: [...bunImportPatterns, ...prismaImportPatterns] }],
    },
  },
  {
    // bun:test types `expect(...).rejects.*` as void although it returns a promise at runtime.
    files: ["tests/**/*.ts"],
    rules: { "@typescript-eslint/await-thenable": "off" },
  },
  layer("src/routes/**/*.ts", ["services", "repositories"]),
  layer("src/controllers/**/*.ts", ["routes", "repositories"]),
  layer("src/services/**/*.ts", ["routes", "controllers"]),
  // repositories are the only layer allowed to touch Prisma
  layer("src/repositories/**/*.ts", ["routes", "controllers", "services"], false),
  {
    files: ["src/utils/prisma.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: bunImportPatterns }],
    },
  },
);
