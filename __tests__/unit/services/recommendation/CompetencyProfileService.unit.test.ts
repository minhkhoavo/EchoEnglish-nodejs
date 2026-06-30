/* eslint-disable @typescript-eslint/no-explicit-any */
import { competencyProfileService } from '~/services/recommendation/CompetencyProfileService.js';
import { User } from '~/models/userModel.js';
import { TestResult } from '~/models/testResultModel.js';

jest.mock('~/models/userModel.js');
jest.mock('~/models/testResultModel.js');

const mockedUser = User as jest.Mocked<typeof User>;
const mockedTestResult = TestResult as jest.Mocked<typeof TestResult>;

function buildMockUser(overrides: any = {}) {
    return {
        _id: 'mock-user-id',
        save: jest.fn().mockResolvedValue(true),
        competencyProfile: undefined,
        ...overrides,
    };
}

function buildMockTestResult(overrides: any = {}) {
    return {
        _id: 'mock-test-id',
        completedAt: new Date(),
        totalScore: 500,
        listeningScore: 250,
        readingScore: 250,
        analysis: undefined,
        ...overrides,
    };
}

describe('CompetencyProfileService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('updateFromTestResult', () => {
        it('should throw Error if user not found', async () => {
            (mockedUser.findById as any) = jest.fn().mockResolvedValue(null);
            await expect(
                competencyProfileService.updateFromTestResult(
                    'userId',
                    'testId'
                )
            ).rejects.toThrow('User or test result not found');
        });

        it('should throw Error if test result not found', async () => {
            (mockedUser.findById as any) = jest
                .fn()
                .mockResolvedValue(buildMockUser());
            (mockedTestResult.findById as any) = jest
                .fn()
                .mockResolvedValue(null);

            await expect(
                competencyProfileService.updateFromTestResult(
                    'userId',
                    'testId'
                )
            ).rejects.toThrow('User or test result not found');
        });

        it('should initialize competencyProfile if not exists and save', async () => {
            const user = buildMockUser();
            const testResult = buildMockTestResult();

            (mockedUser.findById as any) = jest.fn().mockResolvedValue(user);
            (mockedTestResult.findById as any) = jest
                .fn()
                .mockResolvedValue(testResult);

            await competencyProfileService.updateFromTestResult(
                'userId',
                'testId'
            );

            expect(user.competencyProfile).toBeDefined();
            expect(user.competencyProfile.scoreHistory.length).toBe(1);
            expect(user.competencyProfile.currentCEFRLevel).toBe('A2'); // 500 score -> A2
            expect(user.save).toHaveBeenCalled();
        });

        it('should cover all CEFR levels for updateFromTestResult', async () => {
            const scores = [
                { score: 950, cefr: 'C1' },
                { score: 800, cefr: 'B2' },
                { score: 600, cefr: 'B1' },
                { score: 300, cefr: 'A2' },
                { score: 100, cefr: 'A1' },
            ];

            for (const { score, cefr } of scores) {
                const user = buildMockUser();
                const testResult = buildMockTestResult({ totalScore: score });
                (mockedUser.findById as any) = jest
                    .fn()
                    .mockResolvedValue(user);
                (mockedTestResult.findById as any) = jest
                    .fn()
                    .mockResolvedValue(testResult);

                await competencyProfileService.updateFromTestResult(
                    'userId',
                    'testId'
                );
                expect(user.competencyProfile.currentCEFRLevel).toBe(cefr);
            }
        });

        it('should update skill matrix and domain proficiency if analysis exists', async () => {
            const user = buildMockUser();
            const testResult = buildMockTestResult({
                analysis: {
                    examAnalysis: {
                        partAnalyses: [
                            {
                                skillBreakdown: [
                                    {
                                        skillKey: 'GRAMMAR',
                                        accuracy: 80,
                                        total: 10,
                                        correct: 8,
                                    },
                                ],
                            },
                        ],
                        domainPerformance: [
                            {
                                domain: 'Business',
                                accuracy: 90,
                                totalQuestions: 10,
                                correctAnswers: 9,
                            },
                        ],
                    },
                },
            });

            (mockedUser.findById as any) = jest.fn().mockResolvedValue(user);
            (mockedTestResult.findById as any) = jest
                .fn()
                .mockResolvedValue(testResult);

            await competencyProfileService.updateFromTestResult(
                'userId',
                'testId'
            );

            expect(user.competencyProfile.skillMatrix.length).toBe(1);
            expect(user.competencyProfile.skillMatrix[0].skill).toBe('GRAMMAR');
            expect(user.competencyProfile.domainProficiency.length).toBe(1);
            expect(user.competencyProfile.domainProficiency[0].domain).toBe(
                'Business'
            );

            // Call again to test update logic (existing entry)
            await competencyProfileService.updateFromTestResult(
                'userId',
                'testId'
            );
            expect(user.competencyProfile.skillMatrix.length).toBe(1); // Should update existing
            expect(user.competencyProfile.skillMatrix[0].totalQuestions).toBe(
                20
            );
            expect(user.competencyProfile.domainProficiency.length).toBe(1);
            expect(
                user.competencyProfile.domainProficiency[0].totalQuestions
            ).toBe(20);
        });

        it('should properly determine proficiency levels', async () => {
            const user = buildMockUser();
            const testResult = buildMockTestResult({
                analysis: {
                    examAnalysis: {
                        partAnalyses: [
                            {
                                skillBreakdown: [
                                    {
                                        skillKey: 'S1',
                                        accuracy: 90,
                                        total: 10,
                                        correct: 9,
                                    }, // mastered
                                    {
                                        skillKey: 'S2',
                                        accuracy: 75,
                                        total: 10,
                                        correct: 7.5,
                                    }, // proficient
                                    {
                                        skillKey: 'S3',
                                        accuracy: 60,
                                        total: 10,
                                        correct: 6,
                                    }, // developing
                                    {
                                        skillKey: 'S4',
                                        accuracy: 40,
                                        total: 10,
                                        correct: 4,
                                    }, // weak
                                ],
                            },
                        ],
                    },
                },
            });

            (mockedUser.findById as any) = jest.fn().mockResolvedValue(user);
            (mockedTestResult.findById as any) = jest
                .fn()
                .mockResolvedValue(testResult);

            await competencyProfileService.updateFromTestResult(
                'userId',
                'testId'
            );

            const proficiencies = user.competencyProfile.skillMatrix.map(
                (s: any) => s.proficiency
            );
            expect(proficiencies).toEqual([
                'mastered',
                'proficient',
                'developing',
                'weak',
            ]);
        });

        it('should handle missing skillBreakdown in analysis', async () => {
            const user = buildMockUser();
            const testResult = buildMockTestResult({
                analysis: {
                    examAnalysis: {
                        partAnalyses: [
                            {}, // missing skillBreakdown
                        ],
                    },
                },
            });

            (mockedUser.findById as any) = jest.fn().mockResolvedValue(user);
            (mockedTestResult.findById as any) = jest
                .fn()
                .mockResolvedValue(testResult);

            await competencyProfileService.updateFromTestResult(
                'userId',
                'testId'
            );
            expect(user.save).toHaveBeenCalled();
        });
    });

    describe('generateDailyInsights', () => {
        it('should throw Error if user not found', async () => {
            (mockedUser.findById as any) = jest.fn().mockResolvedValue(null);
            await expect(
                competencyProfileService.generateDailyInsights('userId')
            ).rejects.toThrow('User not found: userId');
        });

        it('should generate insights, score predictions, map and update user', async () => {
            const user = buildMockUser({
                competencyProfile: {
                    skillMatrix: [
                        { skill: 'VOCABULARY', currentAccuracy: 40 }, // Weakness
                        { skill: 'grammar_basic', currentAccuracy: 50 }, // Grammar gap
                        { skill: 'INFERENCE', currentAccuracy: 80 },
                    ],
                    domainProficiency: [
                        { domain: 'Daily Life', accuracy: 40 }, // Content Area 1
                        { domain: 'Business', accuracy: 50 }, // Content Area 2
                    ],
                },
            });
            (mockedUser.findById as any) = jest.fn().mockResolvedValue(user);

            const mockFind = {
                sort: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                select: jest
                    .fn()
                    .mockResolvedValue([
                        buildMockTestResult({ totalScore: 950 }),
                        buildMockTestResult({ totalScore: 600 }),
                        buildMockTestResult({ totalScore: 400 }),
                        buildMockTestResult({ totalScore: 200 }),
                    ]),
            };
            (mockedTestResult.find as any) = jest
                .fn()
                .mockReturnValue(mockFind);

            (mockedUser.findByIdAndUpdate as any) = jest
                .fn()
                .mockResolvedValue(true);

            await competencyProfileService.generateDailyInsights('userId');

            expect(mockedUser.findByIdAndUpdate).toHaveBeenCalled();
            const updateArgs = (mockedUser.findByIdAndUpdate as jest.Mock).mock
                .calls[0];
            expect(updateArgs[0]).toBe('userId');

            const updateData = updateArgs[1];
            expect(updateData['competencyProfile.aiInsights']).toBeDefined();
            expect(
                updateData['competencyProfile.scorePrediction']
            ).toBeDefined();
            expect(updateData['competencyProfile.skillsMap']).toBeDefined();
        });

        it('should handle zero recent tests for prediction', async () => {
            const user = buildMockUser({
                competencyProfile: {
                    skillMatrix: [],
                    domainProficiency: [],
                },
            });
            (mockedUser.findById as any) = jest.fn().mockResolvedValue(user);

            const mockFind = {
                sort: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                select: jest.fn().mockResolvedValue([]), // No recent tests
            };
            (mockedTestResult.find as any) = jest
                .fn()
                .mockReturnValue(mockFind);
            (mockedUser.findByIdAndUpdate as any) = jest
                .fn()
                .mockResolvedValue(true);

            await competencyProfileService.generateDailyInsights('userId');

            const updateArgs = (mockedUser.findByIdAndUpdate as jest.Mock).mock
                .calls[0];
            const prediction =
                updateArgs[1]['competencyProfile.scorePrediction'];
            expect(prediction.overallScore).toBe(400); // default
            expect(prediction.cefrLevel).toBe('B1'); // 400 CEFR (this.scoreToCEFR)
            expect(prediction.summary).toBe(
                'Good start! With focused practice, you can significantly improve your score.'
            );
        });

        it('should generate empty insights if competencyProfile is undefined', async () => {
            const insights = await (
                competencyProfileService as any
            ).generateAIInsights(undefined);
            expect(insights).toEqual([]);
        });

        it('should handle scoreToCEFR edge cases', async () => {
            const user = buildMockUser({
                competencyProfile: {
                    skillMatrix: [],
                    domainProficiency: [],
                },
            });
            (mockedUser.findById as any) = jest.fn().mockResolvedValue(user);

            // Test score 950 (C2)
            const mockFindC2 = {
                sort: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                select: jest
                    .fn()
                    .mockResolvedValue([
                        buildMockTestResult({ totalScore: 950 }),
                    ]),
            };
            (mockedTestResult.find as any) = jest
                .fn()
                .mockReturnValue(mockFindC2);
            (mockedUser.findByIdAndUpdate as any) = jest
                .fn()
                .mockResolvedValue(true);

            await competencyProfileService.generateDailyInsights('userId');
            let args = (mockedUser.findByIdAndUpdate as jest.Mock).mock
                .calls[0];
            expect(args[1]['competencyProfile.scorePrediction'].cefrLevel).toBe(
                'C2'
            );
            expect(
                args[1]['competencyProfile.scorePrediction'].summary
            ).toContain('Excellent!');

            // Test score 800 (C1)
            (mockedUser.findByIdAndUpdate as jest.Mock).mockClear();
            const mockFindC1 = {
                sort: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                select: jest
                    .fn()
                    .mockResolvedValue([
                        buildMockTestResult({ totalScore: 800 }),
                    ]),
            };
            (mockedTestResult.find as any) = jest
                .fn()
                .mockReturnValue(mockFindC1);
            await competencyProfileService.generateDailyInsights('userId');
            args = (mockedUser.findByIdAndUpdate as jest.Mock).mock.calls[0];
            expect(args[1]['competencyProfile.scorePrediction'].cefrLevel).toBe(
                'C1'
            );
            expect(
                args[1]['competencyProfile.scorePrediction'].summary
            ).toContain('Excellent!');

            // Test score 600 (B2)
            (mockedUser.findByIdAndUpdate as jest.Mock).mockClear();
            const mockFindB2 = {
                sort: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                select: jest
                    .fn()
                    .mockResolvedValue([
                        buildMockTestResult({ totalScore: 600 }),
                    ]),
            };
            (mockedTestResult.find as any) = jest
                .fn()
                .mockReturnValue(mockFindB2);
            await competencyProfileService.generateDailyInsights('userId');
            args = (mockedUser.findByIdAndUpdate as jest.Mock).mock.calls[0];
            expect(args[1]['competencyProfile.scorePrediction'].cefrLevel).toBe(
                'B2'
            );
            expect(
                args[1]['competencyProfile.scorePrediction'].summary
            ).toContain('You have a solid foundation.');

            // Test score 400 (B1 - handled in zero tests, but let's test it explicitly too)
            (mockedUser.findByIdAndUpdate as jest.Mock).mockClear();
            const mockFindB1 = {
                sort: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                select: jest
                    .fn()
                    .mockResolvedValue([
                        buildMockTestResult({ totalScore: 400 }),
                    ]),
            };
            (mockedTestResult.find as any) = jest
                .fn()
                .mockReturnValue(mockFindB1);
            await competencyProfileService.generateDailyInsights('userId');
            args = (mockedUser.findByIdAndUpdate as jest.Mock).mock.calls[0];
            expect(args[1]['competencyProfile.scorePrediction'].cefrLevel).toBe(
                'B1'
            ); // Wait, 400 is B1
            expect(
                args[1]['competencyProfile.scorePrediction'].summary
            ).toContain('Good start!');

            // Test score 150 (A2)
            (mockedUser.findByIdAndUpdate as jest.Mock).mockClear();
            const mockFindA2 = {
                sort: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                select: jest
                    .fn()
                    .mockResolvedValue([
                        buildMockTestResult({ totalScore: 150 }),
                    ]),
            };
            (mockedTestResult.find as any) = jest
                .fn()
                .mockReturnValue(mockFindA2);
            await competencyProfileService.generateDailyInsights('userId');
            args = (mockedUser.findByIdAndUpdate as jest.Mock).mock.calls[0];
            expect(args[1]['competencyProfile.scorePrediction'].cefrLevel).toBe(
                'A2'
            );

            // Test score 100 (A1)
            (mockedUser.findByIdAndUpdate as jest.Mock).mockClear();
            const mockFindA1 = {
                sort: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                select: jest
                    .fn()
                    .mockResolvedValue([
                        buildMockTestResult({ totalScore: 100 }),
                    ]),
            };
            (mockedTestResult.find as any) = jest
                .fn()
                .mockReturnValue(mockFindA1);
            await competencyProfileService.generateDailyInsights('userId');
            args = (mockedUser.findByIdAndUpdate as jest.Mock).mock.calls[0];
            expect(args[1]['competencyProfile.scorePrediction'].cefrLevel).toBe(
                'A1'
            );
        });

        it('should handle optional chaining branches in insights and map', async () => {
            const user = buildMockUser({
                competencyProfile: {
                    // missing skillMatrix and domainProficiency to cover || []
                },
            });
            (mockedUser.findById as any) = jest.fn().mockResolvedValue(user);
            const mockFind = {
                sort: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                select: jest.fn().mockResolvedValue([
                    buildMockTestResult({
                        totalScore: undefined,
                        listeningScore: undefined,
                        readingScore: undefined,
                    }), // undefined scores
                ]),
            };
            (mockedTestResult.find as any) = jest
                .fn()
                .mockReturnValue(mockFind);
            (mockedUser.findByIdAndUpdate as any) = jest
                .fn()
                .mockResolvedValue(true);

            await competencyProfileService.generateDailyInsights('userId');

            const updateArgs = (mockedUser.findByIdAndUpdate as jest.Mock).mock
                .calls[0];
            const prediction =
                updateArgs[1]['competencyProfile.scorePrediction'];
            expect(prediction.overallScore).toBe(0);
        });

        it('should handle falsy currentAccuracy in mapSkillsToGroups', async () => {
            const user = buildMockUser({
                competencyProfile: {
                    skillMatrix: [
                        { skill: 'VOCABULARY', currentAccuracy: 0 },
                        { skill: 'GRAMMAR', currentAccuracy: undefined },
                    ],
                    domainProficiency: [],
                },
            });
            (mockedUser.findById as any) = jest.fn().mockResolvedValue(user);
            const mockFind = {
                sort: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                select: jest.fn().mockResolvedValue([]),
            };
            (mockedTestResult.find as any) = jest
                .fn()
                .mockReturnValue(mockFind);
            (mockedUser.findByIdAndUpdate as any) = jest
                .fn()
                .mockResolvedValue(true);

            await competencyProfileService.generateDailyInsights('userId');

            const updateArgs = (mockedUser.findByIdAndUpdate as jest.Mock).mock
                .calls[0];
            const skillsMap = updateArgs[1]['competencyProfile.skillsMap'];
            expect(skillsMap).toBeDefined();
        });
    });

    describe('getProfile', () => {
        it('should return null if user not found or has no profile', async () => {
            const mockSelect = {
                select: jest.fn().mockResolvedValue(null),
            };
            (mockedUser.findById as any) = jest
                .fn()
                .mockReturnValue(mockSelect);

            const profile = await competencyProfileService.getProfile('userId');
            expect(profile).toBeNull();
        });

        it('should return profile if exists', async () => {
            const mockSelect = {
                select: jest.fn().mockResolvedValue({
                    competencyProfile: { data: 'test' },
                }),
            };
            (mockedUser.findById as any) = jest
                .fn()
                .mockReturnValue(mockSelect);

            const profile = await competencyProfileService.getProfile('userId');
            expect(profile).toEqual({ data: 'test' });
        });
    });

    describe('getSkillProgress', () => {
        it('should return empty array if no user or profile', async () => {
            (mockedUser.findById as any) = jest.fn().mockResolvedValue(null);
            const progress = await competencyProfileService.getSkillProgress(
                'userId',
                'SKILL'
            );
            expect(progress).toEqual([]);
        });

        it('should return empty array if skill not found in matrix', async () => {
            const user = buildMockUser({
                competencyProfile: {
                    skillMatrix: [{ skill: 'OTHER_SKILL' }],
                },
            });
            (mockedUser.findById as any) = jest.fn().mockResolvedValue(user);
            const progress = await competencyProfileService.getSkillProgress(
                'userId',
                'SKILL'
            );
            expect(progress).toEqual([]);
        });

        it('should return accuracy history if skill exists', async () => {
            const user = buildMockUser({
                competencyProfile: {
                    skillMatrix: [
                        {
                            skill: 'SKILL',
                            accuracyHistory: [
                                { date: new Date('2023-01-01'), value: 50 },
                            ],
                        },
                    ],
                },
            });
            (mockedUser.findById as any) = jest.fn().mockResolvedValue(user);
            const progress = await competencyProfileService.getSkillProgress(
                'userId',
                'SKILL'
            );
            expect(progress.length).toBe(1);
            expect(progress[0].accuracy).toBe(50);
        });
    });

    describe('getWeakSkills', () => {
        it('should return empty array if no user or profile', async () => {
            (mockedUser.findById as any) = jest.fn().mockResolvedValue(null);
            const skills =
                await competencyProfileService.getWeakSkills('userId');
            expect(skills).toEqual([]);
        });

        it('should filter weak and developing skills and sort them', async () => {
            const user = buildMockUser({
                competencyProfile: {
                    skillMatrix: [
                        {
                            skill: 'S1',
                            proficiency: 'mastered',
                            currentAccuracy: 90,
                        },
                        {
                            skill: 'S2',
                            proficiency: 'weak',
                            currentAccuracy: 30,
                        },
                        {
                            skill: 'S3',
                            proficiency: 'developing',
                            currentAccuracy: 50,
                        },
                    ],
                },
            });
            (mockedUser.findById as any) = jest.fn().mockResolvedValue(user);
            const skills =
                await competencyProfileService.getWeakSkills('userId');
            expect(skills.length).toBe(2);
            expect(skills[0].skill).toBe('S2'); // 30 is less than 50
            expect(skills[1].skill).toBe('S3');
        });
    });
});
