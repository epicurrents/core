const path = require('path')

module.exports = {
    rootDir: path.resolve(__dirname, './'),
    coverageDirectory: "<rootDir>/tests/coverage/",
    extensionsToTreatAsEsm: ['.ts'],
    globals: {
        "vue3-jest": {
            "tsconfig": false
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
                    "@*": ["src/*"],
                    "#assets/*": ["src/assets/*"],
                    "#config/*": ["src/config/*"],
                    "#root/*": ["./*"],
                    "#runtime*": ["src/runtime/index.ts"],
                    "#types/*": ["src/types/*"],
                    "#util/*": ["src/util/*"],
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
        "^.+\\.js$": "babel-jest",
        "^.+\\.ts$": "ts-jest",
    },
    transformIgnorePatterns: [
        "node_modules/(?!(@babel)/)",
    ],
    //testRegex: "(test/.*|(\\.|/)(test|spec))\\.(tsx?)$",
    testRegex: "tests.ts$",
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
