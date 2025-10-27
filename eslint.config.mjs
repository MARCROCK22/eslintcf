import { defineConfig } from 'eslint/config';
import theConfig from "./dist/index.js";

export default defineConfig(
    theConfig,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
            },
        },
    },
    {
        rules: {
            '@stylistic/comma-dangle': ['error', {
                "arrays": "always",
                "objects": "always",
                "imports": "always",
                "exports": "always",
                "functions": "never",
                "importAttributes": "always",
                "dynamicImports": "always"
            }]
        }
    }
)