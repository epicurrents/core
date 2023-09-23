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
        "^#@/(.*)$": "<rootDir>/src/$1",
        "^#assets/(.*)$": "<rootDir>/src/assets/$1",
        "^#config/(.*)$": "<rootDir>/src/config/$1",
        "^#root/(.*)$": "<rootDir>/$1",
        "^#runtime/(.*)$": "<rootDir>/src/runtime/$1",
        "^#types/(.*)$": "<rootDir>/types/$1",
        "^#util/(.*)$": "<rootDir>/src/util/$1",
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
