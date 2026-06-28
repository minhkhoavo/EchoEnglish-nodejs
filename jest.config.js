export default {
    preset: 'ts-jest',
    extensionsToTreatAsEsm: ['.ts'],
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.d.ts',
        '!src/**/index.ts',
        '!src/types/**/*.ts',
        '!src/**/*.interface.ts',
        '!src/**/*.type.ts',
        '!src/config/**/*.ts',
        '!src/constants/**/*.ts',
        '!src/enum/**/*.ts',
        '!src/routes/**/*.ts',
        '!src/ai/prompts/**/*.ts',
        '!src/models/**/*.ts',
        '!src/dto/**/*.ts',
    ],
    moduleNameMapper: {
        '^~/(.*)\\.js$': '<rootDir>/src/$1.ts',
        '^~/(.*)$': '<rootDir>/src/$1',
        '^(\\.\\.?/.*)\\.js$': '$1',
        '^uuid$': '<rootDir>/__tests__/mocks/uuid.ts',
    },
    transformIgnorePatterns: ['node_modules/(?!(uuid|.*\\.mjs$))'],
    testEnvironment: 'node',
    roots: ['<rootDir>/__tests__', '<rootDir>/src'],
    setupFiles: ['<rootDir>/__tests__/setup.ts'],
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
