const theConfig = require("./dist/index.js");
const { config } = require("typescript-eslint")

module.exports = config(
    theConfig.default,
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