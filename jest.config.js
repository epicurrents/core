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
                    "CONFIG/*": ["src/config/*"],
                    "LIB/*": ["src/lib/*"],
                    "RUNTIME*": ["src/runtime/index.ts"],
                    "TYPES/*": ["src/*"],
                    "ROOT/*": ["src/*"],
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
        "^CONFIG/(.*)$": "<rootDir>/src/config/$1",
        "^LIB/(.*)$": "<rootDir>/src/lib/$1",
        "^ROOT/(.*)$": "<rootDir>/src/$1",
        "^RUNTIME/(.*)$": "<rootDir>/src/runtime/$1",
        "^TYPES/(.*)$": "<rootDir>/types/$1",
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
