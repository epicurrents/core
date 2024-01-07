const path = require('path')

module.exports = {
    rootDir: path.resolve(__dirname, './'),
    coverageDirectory: "<rootDir>/tests/coverage/",
    extensionsToTreatAsEsm: ['.ts'],
    globals: {
        'babel-jest': {
            useESM: true,
        },
        'ts-jest': {
            useESM: true,
            tsconfig: {
                "target": "esnext",
                "module": "esnext",
                "lib": [
                    "es5", "es6", "esnext",
                    "dom", "webworker",
                ],
                "strict": true,
                "noImplicitReturns": true,
                "moduleResolution": "node",
                "allowSyntheticDefaultImports": true,
                "esModuleInterop": true,
                "baseUrl": "./",
                "paths": {
                    "#root/*": ["./*"],
                    "#runtime*": ["src/runtime/index.ts"],
                    "#*": ["src/*"],
                }
            }
        },
    },
    moduleFileExtensions: [
        "js",
        "ts",
        "json",
    ],
    moduleNameMapper: {
        "^#runtime$": "<rootDir>/src/runtime/index.ts",
        "^#root/(.*)$": "<rootDir>/$1",
        "^#(.*)$": "<rootDir>/src/$1",
    },
    modulePaths: [
        "<rootDir>/src/",
    ],
    roots: [
        "<rootDir>/tests/",
    ],
    snapshotSerializers: [
    ],
    transform: {
        "^.+\\.ts$": "ts-jest",
    },
    transformIgnorePatterns: [
    ],
    //testRegex: "(test/.*|(\\.|/)(test|spec))\\.(tsx?)$",
    testRegex: "tests.(t|j)s$",
    testEnvironment: "jsdom",
    testEnvironmentOptions: {
        browsers: [
            "chrome",
            "firefox",
            "safari"
        ],
        url: "http://localhost/"
    }
}
