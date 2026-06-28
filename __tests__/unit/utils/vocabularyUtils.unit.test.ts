/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
import fs from 'fs';

describe('vocabularyUtils', () => {
    let existsSpy: jest.SpyInstance;
    let readSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        existsSpy = jest.spyOn(fs, 'existsSync');
        readSpy = jest.spyOn(fs, 'readFileSync');
    });

    afterEach(() => {
        existsSpy.mockRestore();
        readSpy.mockRestore();
    });

    describe('extractTranscript', () => {
        it('should join and format text segments properly', () => {
            let extractTranscript: any;
            jest.isolateModules(() => {
                extractTranscript =
                    require('~/utils/vocabularyUtils.js').extractTranscript;
            });
            const data = {
                segments: [
                    { text: '  Hello ' },
                    { text: 'world   !' },
                    { missingText: true },
                ],
            };
            expect(extractTranscript(data)).toBe('Hello world !');
        });

        it('should handle missing segments safely', () => {
            let extractTranscript: any;
            jest.isolateModules(() => {
                extractTranscript =
                    require('~/utils/vocabularyUtils.js').extractTranscript;
            });
            expect(extractTranscript({})).toBe('');
        });
    });

    describe('normalizeWord', () => {
        it('should lowercase and remove non-alphabet/apostrophe characters', () => {
            let normalizeWord: any;
            jest.isolateModules(() => {
                normalizeWord =
                    require('~/utils/vocabularyUtils.js').normalizeWord;
            });
            expect(normalizeWord('HELLO')).toBe('hello');
            expect(normalizeWord('world!')).toBe('world');
            expect(normalizeWord("it's")).toBe("it's");
            expect(normalizeWord('123abc456')).toBe('abc');
        });

        it('should handle falsy values', () => {
            let normalizeWord: any;
            jest.isolateModules(() => {
                normalizeWord =
                    require('~/utils/vocabularyUtils.js').normalizeWord;
            });
            expect(normalizeWord(null as any)).toBe('');
            expect(normalizeWord(undefined as any)).toBe('');
            expect(normalizeWord('')).toBe('');
        });
    });

    describe('mapScoreToLevel', () => {
        it('should map score properly', () => {
            let mapScoreToLevel: any;
            jest.isolateModules(() => {
                mapScoreToLevel =
                    require('~/utils/vocabularyUtils.js').mapScoreToLevel;
            });
            expect(mapScoreToLevel(85)).toBe('excellent');
            expect(mapScoreToLevel(100)).toBe('excellent');
            expect(mapScoreToLevel(70)).toBe('good');
            expect(mapScoreToLevel(84)).toBe('good');
            expect(mapScoreToLevel(69)).toBe('fair');
            expect(mapScoreToLevel(0)).toBe('fair');
        });
    });

    describe('resolveCefrPath', () => {
        it('should return first candidate if exists', () => {
            existsSpy.mockImplementation((p: string) => p.includes('dist'));
            let resolveCefrPath: any;
            jest.isolateModules(() => {
                resolveCefrPath =
                    require('~/utils/vocabularyUtils.js').resolveCefrPath;
            });
            const result = resolveCefrPath();
            expect(result).toContain('dist');
            expect(result).toContain('cefr_words.json');
        });

        it('should return second candidate if first fails', () => {
            existsSpy.mockImplementation((p: string) => p.includes('src'));
            let resolveCefrPath: any;
            jest.isolateModules(() => {
                resolveCefrPath =
                    require('~/utils/vocabularyUtils.js').resolveCefrPath;
            });
            const result = resolveCefrPath();
            expect(result).toContain('src');
            expect(result).toContain('cefr_words.json');
        });

        it('should handle fs.existsSync throwing error and fall through', () => {
            existsSpy.mockImplementation((p: string) => {
                if (p.includes('dist')) throw new Error('Permission denied');
                return p.includes('src');
            });
            let resolveCefrPath: any;
            jest.isolateModules(() => {
                resolveCefrPath =
                    require('~/utils/vocabularyUtils.js').resolveCefrPath;
            });
            const result = resolveCefrPath();
            expect(result).toContain('src');
        });

        it('should return null if no candidates exist', () => {
            existsSpy.mockReturnValue(false);
            let resolveCefrPath: any;
            jest.isolateModules(() => {
                resolveCefrPath =
                    require('~/utils/vocabularyUtils.js').resolveCefrPath;
            });
            expect(resolveCefrPath()).toBeNull();
        });
    });

    describe('loadCefrMap', () => {
        it('should return empty object if path is not resolved', () => {
            existsSpy.mockReturnValue(false);
            let loadCefrMap: any;
            jest.isolateModules(() => {
                loadCefrMap = require('~/utils/vocabularyUtils.js').loadCefrMap;
            });
            expect(loadCefrMap()).toEqual({});
        });

        it('should read file and parse JSON if path resolves', () => {
            existsSpy.mockReturnValue(true);
            readSpy.mockReturnValue('{"apple":"A1","banana":"A2"}');
            let loadCefrMap: any;
            jest.isolateModules(() => {
                loadCefrMap = require('~/utils/vocabularyUtils.js').loadCefrMap;
            });
            expect(loadCefrMap()).toEqual({ apple: 'A1', banana: 'A2' });
        });

        it('should return empty object if parsing JSON returns falsy', () => {
            existsSpy.mockReturnValue(true);
            readSpy.mockReturnValue('null');
            let loadCefrMap: any;
            jest.isolateModules(() => {
                loadCefrMap = require('~/utils/vocabularyUtils.js').loadCefrMap;
            });
            expect(loadCefrMap()).toEqual({});
        });

        it('should catch error and return empty object on fs read error or invalid json', () => {
            existsSpy.mockReturnValue(true);
            readSpy.mockImplementation(() => {
                throw new Error('File read error');
            });
            let loadCefrMap: any;
            jest.isolateModules(() => {
                loadCefrMap = require('~/utils/vocabularyUtils.js').loadCefrMap;
            });
            expect(loadCefrMap()).toEqual({});
        });
    });
});
