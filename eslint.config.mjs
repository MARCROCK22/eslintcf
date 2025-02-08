import theConfig from "./dist/index.js";
import { config } from "typescript-eslint"

export default config(
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