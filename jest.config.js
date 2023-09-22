const path = require('path')

module.exports = {
    rootDir: path.resolve(__dirname, './'),
    coverageDirectory: "<rootDir>/tests/coverage/",
    extensionsToTreatAsEsm: ['.ts', '.vue'],
    globals: {
        "vue3-jest": {
            "tsconfig": false
        },
        'ts-jest': {
            useESM: true,
            tsconfig: {
                "target": "es2020",
                "module": "esnext",
                "lib": [
                    "es5", "es6", "esnext",
                    "webworker",
                ],
                "strict": true,
                "noImplicitReturns": true,
                "moduleResolution": "node",
                "baseUrl": "./",
                "paths": {
                    "ASSETS/*": ["src/assets/*"],
                    "CONFIG/*": ["src/config/*"],
                    "ROOT/*": ["./*"],
                    "RUNTIME*": ["src/runtime/index.ts"],
                    "SRC/*": ["src/*"],
                    "TYPES/*": ["types/*"],
                    "TYPES/*": ["src/util/*"],
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
        "^@/(.*)$": "<rootDir>/src/$1",
        "^ASSETS/(.*)$": "<rootDir>/src/assets/$1",
        "^CONFIG/(.*)$": "<rootDir>/src/config/$1",
        "^ROOT/(.*)$": "<rootDir>/$1",
        "^RUNTIME/(.*)$": "<rootDir>/src/runtime/$1",
        "^SRC/(.*)$": "<rootDir>/src/$1",
        "^TYPES/(.*)$": "<rootDir>/types/$1",
        "^UTIL/(.*)$": "<rootDir>/src/util/$1",
    },
    modulePaths: [
        "<rootDir>/src/",
    ],
    roots: [
        "<rootDir>/tests/",
    ],
    snapshotSerializers: [
        "jest-serializer-vue",
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
