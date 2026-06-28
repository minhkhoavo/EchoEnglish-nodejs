export default {
    preset: 'ts-jest',
    extensionsToTreatAsEsm: ['.ts'],
    moduleNameMapper: {
        '^~/(.*)\\.js$': '<rootDir>/src/$1.ts',
        '^~/(.*)$': '<rootDir>/src/$1',
        '^(\\.\\.?/.*)\\.js$': '$1',
        '^uuid$': '<rootDir>/__tests__/mocks/uuid.ts',
    },
    transformIgnorePatterns: ['node_modules/(?!(uuid|.*\\.mjs$))'],
    testEnvironment: 'node',
    roots: ['<rootDir>/__tests__', '<rootDir>/src'],
    testMatch: ['**/__tests__/**/*.test.ts'],
    transform: {
        '^.+\\.[jt]s$': [
            'ts-jest',
            {
                useESM: true,
                allowImportingTsExtensions: true,
                tsconfig: '<rootDir>/__tests__/tsconfig.json',
                diagnostics: {
                    ignoreCodes: [151002, 1343],
                },
            },
        ],
    },
};
