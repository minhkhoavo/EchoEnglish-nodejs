import { GoogleGenAIClient } from '../provider/googleGenAIClient.js';
import { promptManagerService } from './PromptManagerService.js';
import { JsonOutputParser } from '@langchain/core/output_parsers';

interface WeaknessInsightInput {
    skillName: string;
    skillKey: string;
    userAccuracy: number;
    benchmarkAccuracy: number;
    accuracyGap: number;
    affectedParts: string[];
    totalQuestions: number;
    incorrectCount: number;
    contextualData?: {
        byDomain?: Record<string, { accuracy: number }>;
        byDifficulty?: Record<string, { accuracy: number }>;
    };
    timePattern?: {
        pattern: string;
        description: string;
    };
}

interface WeaknessInsightOutput {
    title: string;
    description: string;
}

interface StudyPlanItemInput {
    weaknessCategory: string;
    skillKey: string;
    weaknessTitle: string;
    severity: string;
    userAccuracy: number;
    affectedParts: string[];
    resources: Array<{
        type: string;
        title: string;
        estimatedTime: number;
    }>;
    drills: Array<{
        title: string;
        totalQuestions: number;
        difficulty: string;
    }>;
}

interface StudyPlanItemOutput {
    title: string;
    description: string;
    estimatedWeeks: number;
}

interface VocabularySetInput {
    weaknessCategory: string;
    skillKey: string;
    weaknessTitle: string;
    affectedParts: string[];
    domainContext?: string[];
    weakDomains?: string[];
}

interface VocabularyWord {
    word: string;
    partOfSpeech: string;
    definition: string;
    example: string;
    usageNote: string;
}

interface VocabularySetOutput {
    title: string;
    description: string;
    words: VocabularyWord[];
}

interface PersonalizedGuideInput {
    weaknessCategory: string;
    skillKey: string;
    weaknessTitle: string;
    severity: string;
    affectedParts: string[];
    userAccuracy: number;
    questionsAttempted: number;
    errorPatterns?: string;
    commonMistakes?: string;
}

interface GuideSection {
    heading: string;
    content: string;
}

interface PersonalizedGuideOutput {
    title: string;
    sections: GuideSection[];
    quickTips: string[];
}

interface StrategicPlanOutput {
    priority: number;
    title: string;
    targetWeaknesses: string[];
    focusParts: string[];
    estimatedWeeks: number;
    rationale: string;
    skillFocus: string;
    totalQuestionsAffected: number;
}

interface ComprehensiveDiagnosisInput {
    totalScore: number;
    totalQuestions: number;
    overallAccuracy: number;
    userLevel: string;
    partsList: string;
    skillPerformanceData: Array<{
        skillKey: string;
        skillName: string;
        userAccuracy: number;
        benchmarkAccuracy: number;
        accuracyGap: number;
        correct: number;
        total: number;
        affectedParts: string[];
    }>;
    domainPerformanceData: Array<{
        domain: string;
        totalQuestions: number;
        correctAnswers: number;
        accuracy: number;
        isWeak: boolean;
    }>;
    partAnalyses: Array<{
        partNumber: string;
        totalQuestions: number;
        correctAnswers: number;
        accuracy: number;
        skillBreakdown: Array<{
            skillName: string;
            skillKey: string;
            total: number;
            correct: number;
            accuracy: number;
        }>;
    }>;
}

interface ComprehensiveDiagnosisOutput {
    summary: string;
    topWeaknesses: Array<{
        id: string;
        severity: string;
        skillKey: string;
        skillName: string;
        category: string;
        title: string;
        description: string;
        affectedParts: string[];
        userAccuracy: number;
        benchmarkAccuracy: number;
        impactScore: number;
        incorrectCount: number;
        totalCount: number;
    }>;
    domainPerformance: Array<{
        domain: string;
        totalQuestions: number;
        correctAnswers: number;
        accuracy: number;
        isWeak: boolean;
    }>;
    weakDomains: string[];
    keyInsights: string[];
    generatedAt: Date;
}

class ToeicAnalysisAIService {
    private aiClient: GoogleGenAIClient;

    constructor() {
        this.aiClient = new GoogleGenAIClient({
            temperature: 0.3,
            model: 'gemini-flash-lite-latest',
        });
    }

    // /**
    //  * Generate detailed weakness insight using AI
    //  */
    // async generateWeaknessInsight(
    //     input: WeaknessInsightInput
    // ): Promise<WeaknessInsightOutput> {
    //     try {
    //         const parser = new JsonOutputParser();
    //         const formatInstructions = parser.getFormatInstructions();

    //         // Get system prompt
    //         const systemPrompt = await promptManagerService.getSystemPrompt(
    //             'toeic-analysis-coach'
    //         );

    //         // Build user prompt with data
    //         const userPrompt = this.buildWeaknessInsightPrompt(input);

    //         // Combine prompts
    //         const fullPrompt = `${systemPrompt}\n\n${userPrompt}\n\n${formatInstructions}`;

    //         // Generate with AI
    //         const response = await this.aiClient.generate(fullPrompt);

    //         // Parse JSON response
    //         const parsed = await parser.parse(response);

    //         return {
    //             title:
    //                 (parsed.title as string) ||
    //                 this.generateFallbackTitle(
    //                     input.skillName,
    //                     input.userAccuracy
    //                 ),
    //             description:
    //                 (parsed.description as string) ||
    //                 this.generateFallbackDescription(input),
    //         };
    //     } catch (error) {
    //         console.error('Error generating weakness insight:', error);
    //         // Fallback to template-based insight
    //         return {
    //             title: this.generateFallbackTitle(
    //                 input.skillName,
    //                 input.userAccuracy
    //             ),
    //             description: this.generateFallbackDescription(input),
    //         };
    //     }
    // }

    /**
     * Generate study plan item using AI
     */
    async generateStudyPlanItem(
        input: StudyPlanItemInput
    ): Promise<StudyPlanItemOutput> {
        try {
            const parser = new JsonOutputParser();
            const formatInstructions = parser.getFormatInstructions();

            const systemPrompt = await promptManagerService.getSystemPrompt(
                'toeic-analysis-coach'
            );

            const userPrompt = this.buildStudyPlanPrompt(input);
            const fullPrompt = `${systemPrompt}\n\n${userPrompt}\n\n${formatInstructions}`;

            const response = await this.aiClient.generate(fullPrompt);
            const parsed = await parser.parse(response);

            return {
                title:
                    (parsed.title as string) ||
                    this.generateFallbackPlanTitle(input.skillKey),
                description:
                    (parsed.description as string) ||
                    this.generateFallbackPlanDescription(input),
                estimatedWeeks:
                    (parsed.estimatedWeeks as number) ||
                    this.estimateWeeksFromSeverity(input.severity),
            };
        } catch (error) {
            console.error('Error generating study plan item:', error);
            return {
                title: this.generateFallbackPlanTitle(input.skillKey),
                description: this.generateFallbackPlanDescription(input),
                estimatedWeeks: this.estimateWeeksFromSeverity(input.severity),
            };
        }
    }

    /**
     * Generate vocabulary set for a weakness using AI
     */
    async generateVocabularySet(
        input: VocabularySetInput
    ): Promise<VocabularySetOutput> {
        try {
            const parser = new JsonOutputParser();
            const formatInstructions = parser.getFormatInstructions();

            const systemPrompt = await promptManagerService.getSystemPrompt(
                'toeic-analysis-coach'
            );

            const userPrompt = await promptManagerService.loadTemplate(
                'analysis/vocabulary-set',
                {
                    weaknessCategory: input.weaknessCategory,
                    skillKey: input.skillKey,
                    weaknessTitle: input.weaknessTitle,
                    affectedParts: input.affectedParts.join(', '),
                    domainContext: input.domainContext?.join(', ') || 'N/A',
                    weakContext: input.weakDomains?.join(', ') || 'N/A',
                }
            );

            const fullPrompt = `${systemPrompt}\n\n${userPrompt}\n\n${formatInstructions}`;
            const response = await this.aiClient.generate(fullPrompt);
            const parsed = await parser.parse(response);

            return {
                title:
                    (parsed.title as string) ||
                    `${input.weaknessTitle} Vocabulary`,
                description:
                    (parsed.description as string) ||
                    'Essential vocabulary for this skill area',
                words: (parsed.words as VocabularyWord[]) || [],
            };
        } catch (error) {
            console.error('Error generating vocabulary set:', error);
            return {
                title: `${input.weaknessTitle} Vocabulary`,
                description: 'Essential vocabulary for this skill area',
                words: [],
            };
        }
    }

    /**
     * Generate personalized study guide for a weakness using AI
     */
    async generatePersonalizedGuide(
        input: PersonalizedGuideInput
    ): Promise<PersonalizedGuideOutput> {
        try {
            const parser = new JsonOutputParser();
            const formatInstructions = parser.getFormatInstructions();

            const systemPrompt = await promptManagerService.getSystemPrompt(
                'toeic-analysis-coach'
            );

            const userPrompt = await promptManagerService.loadTemplate(
                'analysis/personalized-guide',
                {
                    weaknessCategory: input.weaknessCategory,
                    skillKey: input.skillKey,
                    weaknessTitle: input.weaknessTitle,
                    severity: input.severity,
                    affectedParts: input.affectedParts.join(', '),
                    userAccuracy: input.userAccuracy.toString(),
                    questionsAttempted: input.questionsAttempted.toString(),
                    errorPatterns: input.errorPatterns || 'Not enough data yet',
                    commonMistakes:
                        input.commonMistakes || 'Not enough data yet',
                }
            );

            const fullPrompt = `${systemPrompt}\n\n${userPrompt}\n\n${formatInstructions}`;
            const response = await this.aiClient.generate(fullPrompt);
            const parsed = await parser.parse(response);

            return {
                title:
                    (parsed.title as string) ||
                    `Personal Guide: Mastering ${input.weaknessTitle}`,
                sections: (parsed.sections as GuideSection[]) || [],
                quickTips: (parsed.quickTips as string[]) || [],
            };
        } catch (error) {
            console.error('Error generating personalized guide:', error);
            return {
                title: `Personal Guide: Mastering ${input.weaknessTitle}`,
                sections: [
                    {
                        heading: 'Understanding the Problem',
                        content: `This skill involves ${input.weaknessTitle.toLowerCase()}, which is tested in ${input.affectedParts.join(', ')}.`,
                    },
                ],
                quickTips: [
                    'Practice regularly',
                    'Review your mistakes',
                    'Focus on accuracy before speed',
                ],
            };
        }
    }

    /**
     * Generate comprehensive diagnosis using single LLM call with all aggregated data
     */
    async generateComprehensiveDiagnosis(
        input: ComprehensiveDiagnosisInput
    ): Promise<ComprehensiveDiagnosisOutput> {
        try {
            const parser = new JsonOutputParser();
            const formatInstructions = parser.getFormatInstructions();

            const systemPrompt = await promptManagerService.getSystemPrompt(
                'toeic-analysis-coach'
            );

            const userPrompt = await promptManagerService.loadTemplate(
                'analysis/comprehensive-diagnosis',
                {
                    totalScore: input.totalScore.toString(),
                    totalQuestions: input.totalQuestions.toString(),
                    overallAccuracy: input.overallAccuracy.toFixed(1),
                    userLevel: input.userLevel,
                    partsList: input.partsList,
                    skillPerformanceData: JSON.stringify(
                        input.skillPerformanceData,
                        null,
                        2
                    ),
                    domainPerformanceData: JSON.stringify(
                        input.domainPerformanceData,
                        null,
                        2
                    ),
                    partAnalyses: JSON.stringify(input.partAnalyses, null, 2),
                }
            );

            const fullPrompt = `${systemPrompt}\n\n${userPrompt}\n\n${formatInstructions}`;
            const response = await this.aiClient.generate(fullPrompt);
            const parsed = await parser.parse(response);

            // Extract weakDomains from topWeaknesses
            const weakDomains: string[] = [];
            if (Array.isArray(parsed.topWeaknesses)) {
                parsed.topWeaknesses.forEach(
                    (weakness: Record<string, unknown>) => {
                        const desc = String(weakness.description || '');
                        // Extract domain mentions from description
                        const domainMatches = desc.match(
                            /\b(business|travel|daily life|workplace|education|technology)\b/gi
                        );
                        if (domainMatches) {
                            domainMatches.forEach((domain) => {
                                const normalized = domain.toLowerCase();
                                if (!weakDomains.includes(normalized)) {
                                    weakDomains.push(normalized);
                                }
                            });
                        }
                    }
                );
            }

            // Map topWeaknesses to proper structure
            const topWeaknesses = Array.isArray(parsed.topWeaknesses)
                ? parsed.topWeaknesses.map(
                      (w: Record<string, unknown>, index: number) => {
                          return {
                              id: `weakness_${index + 1}_${Date.now()}`,
                              severity: String(w.severity || 'MEDIUM'),
                              skillKey: String(w.skillKey || ''),
                              skillName: String(w.skillName || ''),
                              category: String(w.category || w.skillKey || ''),
                              title: String(w.title || ''),
                              description: String(w.description || ''),
                              affectedParts: Array.isArray(w.affectedParts)
                                  ? w.affectedParts.map(String)
                                  : [],
                              userAccuracy: Number(w.userAccuracy || 0),
                              benchmarkAccuracy: Number(
                                  w.benchmarkAccuracy || 0
                              ),
                              impactScore: Number(w.impactScore || 0),
                              incorrectCount: Number(w.incorrectCount || 0),
                              totalCount: Number(w.totalCount || 0),
                          };
                      }
                  )
                : [];

            return {
                summary:
                    (parsed.summary as string) ||
                    'Performance analysis complete',
                topWeaknesses,
                domainPerformance: input.domainPerformanceData as Array<{
                    domain: string;
                    totalQuestions: number;
                    correctAnswers: number;
                    accuracy: number;
                    isWeak: boolean;
                }>,
                weakDomains,
                keyInsights: Array.isArray(parsed.keyInsights)
                    ? parsed.keyInsights.map(String)
                    : [],
                generatedAt: new Date(),
            };
        } catch (error) {
            console.error('Error generating comprehensive diagnosis:', error);
            return {
                summary: 'Unable to generate diagnosis',
                topWeaknesses: [],
                domainPerformance: input.domainPerformanceData as Array<{
                    domain: string;
                    totalQuestions: number;
                    correctAnswers: number;
                    accuracy: number;
                    isWeak: boolean;
                }>,
                weakDomains: [],
                keyInsights: [],
                generatedAt: new Date(),
            };
        }
    }

    /**
     * Generate strategic plan from comprehensive diagnosis
     * Creates 3 high-level strategic items considering volume vs impact
     */
    async generateStrategicPlan(
        diagnosis: ComprehensiveDiagnosisOutput | Record<string, unknown>
    ): Promise<StrategicPlanOutput[]> {
        try {
            const parser = new JsonOutputParser();
            const formatInstructions = parser.getFormatInstructions();

            const systemPrompt = await promptManagerService.getSystemPrompt(
                'toeic-analysis-coach'
            );

            // Build comprehensive diagnosis JSON for template
            const comprehensiveDiagnosisJson = JSON.stringify(
                diagnosis,
                null,
                2
            );

            const userPrompt = await promptManagerService.loadTemplate(
                'studyplan/strategic-plan',
                {
                    comprehensiveDiagnosisJson,
                }
            );

            const fullPrompt = `${systemPrompt}\n\n${userPrompt}\n\n${formatInstructions}`;
            const response = await this.aiClient.generate(fullPrompt);
            const parsed = await parser.parse(response);

            // Handle both array format and object with strategicItems field
            let items: Record<string, unknown>[] = [];
            if (Array.isArray(parsed)) {
                // LLM returned array directly: [{...}, {...}, {...}]
                items = parsed;
            } else if (Array.isArray(parsed.strategicItems)) {
                // LLM returned object: { strategicItems: [{...}, {...}, {...}] }
                items = parsed.strategicItems;
            }

            console.log(
                `Parsed ${items.length} strategic items from LLM response`
            );

            return items.map(
                (item: Record<string, unknown>, index: number) => ({
                    priority: (item.priority as number) || index + 1,
                    title:
                        (item.title as string) ||
                        `Strategic Focus ${index + 1}`,
                    targetWeaknesses: Array.isArray(item.targetWeaknesses)
                        ? (item.targetWeaknesses as string[])
                        : [],
                    focusParts: Array.isArray(item.focusParts)
                        ? (item.focusParts as string[])
                        : [],
                    estimatedWeeks: (item.estimatedWeeks as number) || 2,
                    rationale: (item.rationale as string) || '',
                    skillFocus: (item.skillFocus as string) || '',
                    totalQuestionsAffected:
                        (item.totalQuestionsAffected as number) || 0,
                })
            );
        } catch (error) {
            console.error('Error generating strategic plan:', error);
            return [];
        }
    }

    /**
     * Build prompt for study plan item
     */
    private buildStudyPlanPrompt(input: StudyPlanItemInput): string {
        let prompt = `Generate a personalized study plan item for this weakness.

**Weakness Details:**
- Category: ${input.weaknessCategory}
- Skill: ${input.skillKey}
- Title: ${input.weaknessTitle}
- Severity: ${input.severity}
- User Accuracy: ${input.userAccuracy}%
- Affected Parts: ${input.affectedParts.join(', ')}

**Available Resources:**
`;

        input.resources.forEach((resource) => {
            prompt += `- Type: ${resource.type}, Title: "${resource.title}" (${resource.estimatedTime} min)\n`;
        });

        prompt += '\n**Available Drills:**\n';
        input.drills.forEach((drill) => {
            prompt += `- "${drill.title}" - ${drill.totalQuestions} questions, ${drill.difficulty} level\n`;
        });

        prompt += `
Generate a study plan item with:
1. **Title:** Clear, motivating title (e.g., "Master Inference Skills in Business Contexts")
2. **Description:** 2-3 sentences explaining:
   - What to focus on
   - Why it's important
   - What success looks like
3. **Estimated Weeks:** Realistic timeframe (1-4 weeks based on severity)

Consider:
- Critical weaknesses need 3-4 weeks
- High severity needs 2-3 weeks
- Medium severity needs 1-2 weeks

Format your response as JSON:
{
  "title": "...",
  "description": "...",
  "estimatedWeeks": 2
}

Be encouraging and specific.`;

        return prompt;
    }

    /**
     * Parse JSON response from AI (handle markdown code blocks)
     */
    private parseJSONResponse(response: string): Record<string, unknown> {
        try {
            // Remove markdown code blocks if present
            let cleaned = response.trim();
            if (cleaned.startsWith('```json')) {
                cleaned = cleaned
                    .replace(/^```json\n/, '')
                    .replace(/\n```$/, '');
            } else if (cleaned.startsWith('```')) {
                cleaned = cleaned.replace(/^```\n/, '').replace(/\n```$/, '');
            }

            // Remove trailing commas before closing braces/brackets
            cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');

            return JSON.parse(cleaned);
        } catch (error) {
            console.error('Failed to parse AI response as JSON:', error);
            console.error('Response was:', response);
            return {};
        }
    }

    /**
     * Fallback title generator
     */
    private generateFallbackTitle(skillName: string, accuracy: number): string {
        if (accuracy < 40) {
            return `Critical Weakness in ${skillName}`;
        } else if (accuracy < 50) {
            return `Significant Challenge with ${skillName}`;
        } else if (accuracy < 60) {
            return `Room for Improvement in ${skillName}`;
        } else {
            return `Refine Your ${skillName} Skills`;
        }
    }

    /**
     * Fallback description generator
     */
    private generateFallbackDescription(input: WeaknessInsightInput): string {
        const gap = input.accuracyGap;
        const comparison =
            gap > 30
                ? 'significantly below'
                : gap > 20
                  ? 'below'
                  : 'slightly below';

        return `Your accuracy in ${input.skillName} is ${input.userAccuracy}%, which is ${comparison} the average of ${input.benchmarkAccuracy}% for learners at your level. This skill was tested in ${input.totalQuestions} questions across Parts ${input.affectedParts.join(', ')}, and you got ${input.incorrectCount} incorrect. Improving this skill could significantly boost your overall TOEIC score.`;
    }

    /**
     * Fallback plan title generator
     */
    private generateFallbackPlanTitle(skillKey: string): string {
        const skillNames: Record<string, string> = {
            infer_implication: 'Master Implication Inference',
            infer_speaker_role: 'Identify Speaker Roles',
            collocation: 'Learn Common Collocations',
            word_form: 'Master Word Forms',
            // Add more as needed
        };

        return skillNames[skillKey] || `Improve ${skillKey.replace(/_/g, ' ')}`;
    }

    /**
     * Fallback plan description generator
     */
    private generateFallbackPlanDescription(input: StudyPlanItemInput): string {
        return `Focus on improving your ${input.skillKey.replace(/_/g, ' ')} skills through targeted practice. Complete the recommended drills and review the learning materials to strengthen this area. Track your progress and aim for consistent improvement over the next few weeks.`;
    }

    /**
     * Estimate weeks from severity
     */
    private estimateWeeksFromSeverity(severity: string): number {
        switch (severity.toLowerCase()) {
            case 'critical':
                return 4;
            case 'high':
                return 3;
            case 'medium':
                return 2;
            case 'low':
                return 1;
            default:
                return 2;
        }
    }
}

export const toeicAnalysisAIService = new ToeicAnalysisAIService();
export { ToeicAnalysisAIService };
export type {
    WeaknessInsightInput,
    WeaknessInsightOutput,
    StudyPlanItemInput,
    StudyPlanItemOutput,
    VocabularySetInput,
    VocabularySetOutput,
    PersonalizedGuideInput,
    PersonalizedGuideOutput,
    VocabularyWord,
    GuideSection,
    StrategicPlanOutput,
    ComprehensiveDiagnosisInput,
    ComprehensiveDiagnosisOutput,
};
