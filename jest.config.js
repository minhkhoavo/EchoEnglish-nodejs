export default {
    preset: 'ts-jest',
    extensionsToTreatAsEsm: ['.ts'],
    moduleNameMapper: {
        '^~/(.*)\\.js$': '<rootDir>/src/$1.ts',
        '^~/(.*)$': '<rootDir>/src/$1',
        '(\\..+)\\.js$': '$1',
        '^uuid$': '<rootDir>/node_modules/uuid/dist/index.js',
    },
    transformIgnorePatterns: ['node_modules/(?!(uuid|.*\\.mjs$))'],
    testEnvironment: 'node',
    roots: ['<rootDir>/__tests__', '<rootDir>/src'],
    testMatch: ['**/__tests__/**/*.test.ts'],
    transform: {
        '^.+\\.ts$': [
            'ts-jest',
            {
                useESM: true,
                allowImportingTsExtensions: true,
                diagnostics: {
                    ignoreCodes: [151002],
                },
                tsconfig: {
                    allowJs: true,
                },
            },
        ],
    },
};
