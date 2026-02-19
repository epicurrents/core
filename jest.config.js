const path = require('path')

module.exports = {
    rootDir: path.resolve(__dirname),
    preset: 'ts-jest',
    coverageDirectory: "<rootDir>/tests/coverage/",
    extensionsToTreatAsEsm: ['.ts'],
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
    testPathIgnorePatterns: [
       '<rootDir>/node_modules/'
    ],
    transform: {
        "^.+\\.ts$": ["ts-jest", {
            useESM: true,
            tsconfig: "tsconfig.test.json",
        }],
    },
    transformIgnorePatterns: [
       '<rootDir>/node_modules/'
    ],
    //testRegex: "(tests/.*|(\\.|/)(test|spec))\\.(tsx?)$",
    testRegex: "test\\.(t|j)s$",
    testEnvironment: "jsdom",
    testEnvironmentOptions: {
        url: "http://localhost/"
    }
}
