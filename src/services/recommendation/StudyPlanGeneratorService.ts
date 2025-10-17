import { Schema } from 'mongoose';
import { StudyPlan } from '../../models/studyPlanModel.js';
import { Resource } from '../../models/resource.js';
import { QuestionMetadata } from '../../models/questionMetadataModel.js';
import { TestResult } from '../../models/testResultModel.js';
import { toeicAnalysisAIService } from '../../ai/service/toeicAnalysisAIService.js';
import { SeverityLevel } from '../../enum/severityLevel.js';
import { Difficulty } from '../../enum/difficulty.js';

// Type definitions for internal use
type LearningResource = {
    type:
        | 'video'
        | 'article'
        | 'vocabulary_set'
        | 'personalized_guide'
        | 'flashcard';
    title: string;
    description: string;
    estimatedTime: number;
    resourceId?: Schema.Types.ObjectId;
    url?: string;
    generatedContent?: Record<string, unknown>;
    completed: boolean;
    completedAt?: Date;
};

type PracticeDrill = {
    title: string;
    description: string;
    totalQuestions: number;
    estimatedTime: number;
    skillTags: {
        skillCategory: string;
        specificSkills: string[];
    };
    partNumbers: number[];
    difficulty: 'beginner' | 'intermediate' | 'advanced';
    completed: boolean;
    attempts: number;
    completedAt?: Date;
    score?: number;
};

export class StudyPlanGeneratorService {
    async generateStudyPlan(
        testResultId: Schema.Types.ObjectId | string,
        userId: Schema.Types.ObjectId | string
    ): Promise<typeof StudyPlan.prototype | null> {
        // 1. Get test result with comprehensive diagnosis
        const testResult = await TestResult.findById(testResultId);
        if (!testResult || !testResult.analysis?.examAnalysis) {
            throw new Error(
                `TestResult or analysis not found: ${testResultId}`
            );
        }

        const examAnalysis = testResult.analysis.examAnalysis;

        // Check if diagnosis data exists
        if (!examAnalysis.summary || !examAnalysis.topWeaknesses) {
            throw new Error(
                'No comprehensive diagnosis found. Run weakness detection first.'
            );
        }

        // STEP 1: Generate strategic plan (considers volume vs impact)
        // console.log('Generating strategic plan...');
        const strategicItems =
            await toeicAnalysisAIService.generateStrategicPlan(
                examAnalysis as unknown as Record<string, unknown>
            );
        // console.log('Strategic items:', strategicItems);
        if (!strategicItems || strategicItems.length === 0) {
            throw new Error('Failed to generate strategic plan');
        }

        // console.log(`Generated ${strategicItems.length} strategic items`);
        // console.log('Strategic plan:', JSON.stringify(strategicItems, null, 2));

        const weakDomains = examAnalysis.weakDomains || [];

        // 3. Generate detailed study plan items from strategic plan
        const planItems = [];

        for (let i = 0; i < strategicItems.length; i++) {
            const strategicItem = strategicItems[i];
            console.log(`\n=== Processing Strategic Item ${i + 1} ===`);
            console.log('Strategic item:', strategicItem);

            // Find corresponding weakness from diagnosis by ID
            const targetWeakness = examAnalysis.topWeaknesses.find(
                (w: { id: string; skillKey: string; skillName?: string }) =>
                    strategicItem.targetWeaknesses.includes(w.id) ||
                    strategicItem.targetWeaknesses.includes(w.skillKey) ||
                    (w.skillName &&
                        strategicItem.targetWeaknesses.includes(w.skillName))
            );

            if (!targetWeakness) {
                console.warn(
                    `No weakness found for strategic item: ${strategicItem.title}`
                );
                console.warn(
                    `Looking for IDs: ${strategicItem.targetWeaknesses.join(', ')}`
                );
                console.warn(
                    `Available weakness IDs:`,
                    examAnalysis.topWeaknesses.map((w: { id: string }) => w.id)
                );
                continue;
            }

            // console.log(`Found matching weakness: ${targetWeakness.skillName || targetWeakness.skillKey}`);

            const weakness = {
                severity: targetWeakness.severity as SeverityLevel,
                skillKey: targetWeakness.skillKey,
                skillName: targetWeakness.skillName || strategicItem.skillFocus,
                category: targetWeakness.category,
                impactScore: targetWeakness.impactScore,
                affectedParts: strategicItem.focusParts,
                incorrectCount: targetWeakness.incorrectCount,
                totalCount: targetWeakness.totalCount,
            };

            // Generate detailed plan item
            const planItem = await this.generatePlanItemForWeakness(
                weakness,
                strategicItem.priority,
                weakDomains
            );

            // Override AI-generated values with strategic plan
            planItem.title = strategicItem.title;
            planItem.estimatedWeeks = strategicItem.estimatedWeeks;

            planItems.push(planItem);
        }

        console.log('\n=== Generated Study Plan Items ===');
        console.log(`Total items: ${planItems.length}`);

        // 4. Create study plan
        const studyPlan = await StudyPlan.create({
            userId,
            testResultId: testResult._id,
            planItems,
            overallProgress: 0,
            status: 'active',
        });

        console.log('Created study plan with ID:', studyPlan._id);

        return studyPlan;
    }

    /**
     * Generate a complete plan item for a single weakness with all resources
     */
    private async generatePlanItemForWeakness(
        weakness: {
            severity: SeverityLevel;
            skillKey: string;
            skillName: string;
            category: string;
            impactScore: number;
            affectedParts: string[];
            incorrectCount?: number;
            totalCount?: number;
        },
        priority: number,
        weakDomains: string[]
    ) {
        const userAccuracy =
            weakness.totalCount && weakness.totalCount > 0
                ? ((weakness.totalCount - (weakness.incorrectCount || 0)) /
                      weakness.totalCount) *
                  100
                : 0;

        console.log(
            `User accuracy for ${weakness.skillName}: ${userAccuracy}%`
        );
        // console.log(`Weak domains for context: ${weakDomains.join(', ')}`);

        // 1. Generate title and description with AI
        const aiPlanItem = await toeicAnalysisAIService.generateStudyPlanItem({
            weaknessCategory: weakness.category,
            skillKey: weakness.skillKey,
            weaknessTitle: weakness.skillName,
            severity: weakness.severity,
            userAccuracy,
            affectedParts: weakness.affectedParts,
            resources: [], // Will be filled below
            drills: [], // Will be filled below
        });

        // console.log('AI-generated plan item:', aiPlanItem);

        // 2. Generate learning resources (with domain context)
        const resources = await this.generateLearningResources(
            weakness,
            userAccuracy,
            weakDomains
        );
        console.log(`Generated ${resources.length} learning resources`);

        // 3. Generate practice drills
        const practiceDrills = await this.generatePracticeDrills(weakness);
        console.log(`Generated ${practiceDrills.length} practice drills`);

        // 4. Extract skills to improve with validation
        console.log('Extracting skills from weakness:', {
            skillKey: weakness.skillKey,
            skillName: weakness.skillName,
            category: weakness.category,
        });
        const skillsToImprove = this.extractSkillsToImprove(weakness);
        console.log('Skills to improve:', skillsToImprove);

        // 5. Validate and ensure all required fields are present
        const validatedSkillsToImprove =
            Array.isArray(skillsToImprove) && skillsToImprove.length > 0
                ? skillsToImprove.filter(
                      (skill) =>
                          skill && typeof skill === 'string' && skill.trim()
                  )
                : ['General improvement needed'];

        // Ensure at least one valid skill
        if (validatedSkillsToImprove.length === 0) {
            validatedSkillsToImprove.push('General improvement needed');
        }

        // 6. Build plan item with all required fields
        const planItem = {
            priority,
            title: aiPlanItem.title || 'Skill Improvement Plan',
            description:
                aiPlanItem.description || 'Focus on improving this skill area',
            targetWeakness: {
                skillKey: weakness.skillKey || 'unknown',
                skillName:
                    weakness.skillName ||
                    this.formatSkillName(weakness.category),
                severity: weakness.severity || 'MEDIUM',
            },
            skillsToImprove: validatedSkillsToImprove,
            resources,
            practiceDrills,
            progress: 0,
            estimatedWeeks: aiPlanItem.estimatedWeeks || 2,
        };

        // console.log('Built plan item:', JSON.stringify(planItem, null, 2));
        return planItem;
    }

    /**
     * Generate all types of learning resources for a weakness
     */
    public async generateLearningResources(
        weakness: {
            category: string;
            skillKey: string;
            skillName: string;
            affectedParts: string[];
        },
        userAccuracy: number,
        weakDomains: string[]
    ): Promise<LearningResource[]> {
        const resources: LearningResource[] = [];

        // 1. Find DB resources (videos, articles) - Always useful for any weakness
        const dbResources = await this.findDatabaseResources(
            weakness,
            weakDomains
        );
        resources.push(...dbResources);

        // 2. Generate AI vocabulary set - Only for vocabulary/word-related weaknesses
        if (this.shouldGenerateVocabularySet(weakness)) {
            const vocabSet = await this.generateVocabularySet(
                weakness,
                weakDomains
            );
            if (vocabSet) {
                resources.push(vocabSet);
            }
        } else {
            console.log(
                'Skipping vocabulary set (not relevant for this weakness type)'
            );
        }

        // 3. Generate personalized guide - Only for skill-based weaknesses (not grammar/vocabulary)
        if (this.shouldGeneratePersonalizedGuide(weakness)) {
            // console.log(
            //     'Generating personalized guide (relevant for this weakness)...'
            // );
            const personalizedGuide = await this.generatePersonalizedGuide(
                weakness,
                userAccuracy
            );
            if (personalizedGuide) {
                resources.push(personalizedGuide);
            }
        } else {
            console.log(
                'Skipping personalized guide (not relevant for this weakness type)'
            );
        }

        return resources;
    }

    /**
     * Determine if vocabulary set is needed for this weakness
     */
    public shouldGenerateVocabularySet(weakness: {
        category: string;
        skillKey: string;
        skillName: string;
    }): boolean {
        const category = weakness.category?.toUpperCase() || '';
        const skillKey = weakness.skillKey?.toLowerCase() || '';
        const skillName = weakness.skillName?.toLowerCase() || '';

        // Generate vocabulary for:
        // 1. Explicit vocabulary weaknesses
        if (category.includes('VOCABULARY') || category.includes('VOCAB')) {
            return true;
        }

        // 2. Word choice, collocations, word forms
        if (
            skillKey.includes('word_choice') ||
            skillKey.includes('collocation') ||
            skillKey.includes('word_form') ||
            skillName.includes('word choice') ||
            skillName.includes('collocation')
        ) {
            return true;
        }

        // 3. Context/domain-specific weaknesses (e.g., finance, business terminology)
        if (
            skillName.includes('finance') ||
            skillName.includes('business') ||
            skillName.includes('technical') ||
            skillKey.includes('domain_specific')
        ) {
            return true;
        }

        // 4. Inference and detail comprehension can benefit from vocabulary
        if (category.includes('INFERENCE') || category.includes('DETAIL')) {
            return true;
        }

        // Skip for pure grammar/structure weaknesses
        if (
            category.includes('GRAMMAR') &&
            (skillKey.includes('verb_tense') ||
                skillKey.includes('sentence_structure') ||
                skillKey.includes('preposition'))
        ) {
            return false;
        }

        return false;
    }

    /**
     * Determine if personalized guide is needed for this weakness
     */
    public shouldGeneratePersonalizedGuide(weakness: {
        category: string;
        skillKey: string;
    }): boolean {
        const category = weakness.category?.toUpperCase() || '';
        const skillKey = weakness.skillKey?.toLowerCase() || '';

        // Always generate guide for skill-based weaknesses:
        // - GIST (main idea, purpose)
        // - DETAIL (specific information)
        // - INFERENCE (implications, speaker intent)
        // - SPECIFIC_ACTION (next steps, requests)
        if (
            category.includes('GIST') ||
            category.includes('DETAIL') ||
            category.includes('INFERENCE') ||
            category.includes('SPECIFIC_ACTION')
        ) {
            return true;
        }

        // Generate for cohesion weaknesses (sentence insertion, text organization)
        if (category.includes('COHESION')) {
            return true;
        }

        // Skip for pure vocabulary/grammar weaknesses - they need practice, not strategy
        if (category.includes('VOCABULARY') || category.includes('GRAMMAR')) {
            // Exception: if it's about understanding/applying rules, guide helps
            if (
                skillKey.includes('usage') ||
                skillKey.includes('application')
            ) {
                return true;
            }
            return false;
        }

        return true; // Default: generate guide
    }

    /**
     * Find videos and articles from database
     */
    public async findDatabaseResources(
        weakness: {
            skillKey: string;
            category: string;
            affectedParts: string[];
        },
        weakDomains: string[]
    ): Promise<LearningResource[]> {
        const resources: LearningResource[] = [];

        // Build search criteria
        const searchCriteria: Record<string, unknown> = {
            suitableForLearners: true,
        };

        // Prioritize resources from weak domains if available
        if (weakDomains.length > 0) {
            searchCriteria['labels.domain'] = {
                $in: weakDomains.map((d) => d.toUpperCase()),
            };
        }

        // Map skill categories to resource topics
        const topicKeywords = this.getTopicKeywords(
            weakness.skillKey,
            weakness.category
        );
        console.log('Topic keywords:', topicKeywords);

        if (topicKeywords.length > 0) {
            searchCriteria['labels.topic'] = { $in: topicKeywords };
        }

        // Search for resources
        let foundResources = await Resource.find(searchCriteria).limit(3);
        console.log(`Found ${foundResources.length} specific resources`);
        console.log(
            'foundResources:',
            foundResources.map((r) => {
                console.log('title' + r.title, 'url' + r.url);
                return r.title;
            })
        );
        // Fallback to general TOEIC resources if none found AND if it makes sense
        if (foundResources.length === 0) {
            // Only use fallback for skill-based weaknesses, not pure grammar/vocab
            const category = weakness.category?.toUpperCase() || '';
            if (
                category.includes('INFERENCE') ||
                category.includes('GIST') ||
                category.includes('DETAIL') ||
                category.includes('SPECIFIC_ACTION') ||
                category.includes('COHESION')
            ) {
                console.log('Using general TOEIC resources as fallback');
                const fallbackDomain =
                    weakDomains.length > 0
                        ? weakDomains[0].toUpperCase()
                        : 'BUSINESS';

                foundResources = await Resource.find({
                    suitableForLearners: true,
                    'labels.domain': fallbackDomain,
                }).limit(2);
            } else {
                console.log(
                    'No specific resources found and no fallback applicable'
                );
            }
        }

        // Transform to resource format (limit to 2-3 resources max)
        for (const resource of foundResources.slice(0, 2)) {
            resources.push({
                type: resource.type === 'video' ? 'video' : 'article',
                title: resource.title || 'Untitled Resource',
                description:
                    resource.description ||
                    `Learn more about ${weakness.category}`,
                estimatedTime: 30,
                resourceId: resource._id,
                url: resource.url,
                completed: false,
            });
        }

        return resources;
    }

    /**
     * Generate AI-powered vocabulary set
     */
    public async generateVocabularySet(
        weakness: {
            category: string;
            skillKey: string;
            skillName: string;
            affectedParts: string[];
        },
        weakDomains: string[]
    ): Promise<LearningResource | null> {
        try {
            const vocabSet = await toeicAnalysisAIService.generateVocabularySet(
                {
                    weaknessCategory: weakness.category,
                    skillKey: weakness.skillKey,
                    weaknessTitle: weakness.skillName,
                    affectedParts: weakness.affectedParts,
                    domainContext: weakDomains,
                    weakDomains: weakDomains,
                }
            );

            if (!vocabSet || !vocabSet.words || vocabSet.words.length === 0) {
                console.log('No vocabulary words generated');
                return null;
            }

            return {
                type: 'vocabulary_set',
                title: vocabSet.title,
                description: vocabSet.description,
                estimatedTime: 20,
                generatedContent: {
                    words: vocabSet.words,
                    focusDomains: weakDomains, // Include domain context
                },
                completed: false,
            };
        } catch (error) {
            console.error('Error generating vocabulary set:', error);
            return null;
        }
    }

    /**
     * Generate personalized study guide with AI
     */
    public async generatePersonalizedGuide(
        weakness: {
            category: string;
            skillKey: string;
            skillName: string;
            affectedParts: string[];
            severity?: string;
            incorrectCount?: number;
            totalCount?: number;
        },
        userAccuracy: number
    ): Promise<LearningResource | null> {
        try {
            // console.log('Generating personalized guide with AI...');
            const guide =
                await toeicAnalysisAIService.generatePersonalizedGuide({
                    weaknessCategory: weakness.category,
                    skillKey: weakness.skillKey,
                    weaknessTitle: weakness.skillName,
                    severity: weakness.severity || 'MEDIUM',
                    affectedParts: weakness.affectedParts,
                    userAccuracy,
                    questionsAttempted: weakness.totalCount || 0,
                    errorPatterns: 'Analysis in progress',
                    commonMistakes: 'Will be identified after more practice',
                });

            if (!guide || !guide.sections || guide.sections.length === 0) {
                console.log('No guide sections generated');
                return null;
            }

            return {
                type: 'personalized_guide',
                title: guide.title,
                description: `Personalized strategies to improve your ${weakness.skillName} skills`,
                estimatedTime: 15,
                generatedContent: {
                    sections: guide.sections,
                    quickTips: guide.quickTips,
                },
                completed: false,
            };
        } catch (error) {
            console.error('Error generating personalized guide:', error);
            return null;
        }
    }

    /**
     * Generate practice drills by querying test DB with skill tags
     */
    private async generatePracticeDrills(weakness: {
        category: string;
        skillKey: string;
        skillName: string;
        affectedParts: string[];
        severity: SeverityLevel;
    }): Promise<PracticeDrill[]> {
        const drills: PracticeDrill[] = [];

        // Map weakness to skill tags
        const skillCategory = this.mapCategoryToSkillCategory(
            weakness.category
        );
        const specificSkills = this.mapSkillKeyToSpecificSkills(
            weakness.skillKey
        );
        const difficulty = this.mapSeverityToDifficulty(weakness.severity);

        console.log('Drill query params:', {
            skillCategory,
            specificSkills,
            difficulty,
        });

        // Determine question count based on severity
        const questionCount = this.getRecommendedQuestionCount(
            weakness.severity
        );

        // Query questions by skill tags
        const query: Record<string, unknown> = {};

        if (skillCategory && skillCategory !== 'OTHERS') {
            query['skillTags.skillCategory'] = skillCategory;
        }

        if (specificSkills.length > 0) {
            query['skillTags.skillDetail'] = { $in: specificSkills };
        }

        // Filter by parts (handle empty affectedParts)
        const partNumbers = (weakness.affectedParts || [])
            .map((p) => {
                if (typeof p === 'string') {
                    return parseInt(p.replace(/Part\s*/i, ''));
                }
                return typeof p === 'number' ? p : NaN;
            })
            .filter((n) => !isNaN(n));

        if (partNumbers.length > 0) {
            query['part'] = { $in: partNumbers };
        }

        console.log('Question query:', query);

        // Count available questions
        const availableCount = await QuestionMetadata.countDocuments(query);
        console.log(`Found ${availableCount} questions matching criteria`);

        // Create drill title and description safely
        const skillName =
            weakness.skillName || this.formatSkillName(weakness.category);
        const partsText =
            partNumbers.length > 0
                ? ` - ${partNumbers.map((p) => `Part ${p}`).join(', ')}`
                : '';

        if (availableCount > 0) {
            const drill = {
                title: `${skillName} Practice${partsText}`,
                description: `${questionCount} targeted questions focusing on ${skillName.toLowerCase()}`,
                totalQuestions: Math.min(questionCount, availableCount),
                estimatedTime: Math.ceil(
                    Math.min(questionCount, availableCount) / 2
                ),
                skillTags: {
                    skillCategory: skillCategory || 'OTHERS',
                    specificSkills,
                },
                partNumbers,
                difficulty: difficulty.toLowerCase() as
                    | 'beginner'
                    | 'intermediate'
                    | 'advanced',
                completed: false,
                attempts: 0,
            };

            drills.push(drill);
        }

        // If no drills generated, create a generic one
        if (drills.length === 0) {
            console.log('No questions found, creating generic drill');
            drills.push({
                title: `${skillName} Practice${partsText}`,
                description: `Practice questions for improving ${skillName.toLowerCase()} skills`,
                totalQuestions: 20,
                estimatedTime: 10,
                skillTags: {
                    skillCategory: skillCategory || 'OTHERS',
                    specificSkills,
                },
                partNumbers,
                difficulty: difficulty.toLowerCase() as
                    | 'beginner'
                    | 'intermediate'
                    | 'advanced',
                completed: false,
                attempts: 0,
            });
        }

        return drills;
    }

    /**
     * Extract skills to improve from weakness
     */
    private extractSkillsToImprove(weakness: {
        skillKey: string;
        skillName: string;
        category: string;
    }): string[] {
        const skills: string[] = [];

        // Add skill name if it exists and is valid
        if (weakness.skillName && weakness.skillName.trim()) {
            skills.push(weakness.skillName);
        }

        // Add related skills based on category
        const category = weakness.category?.toUpperCase() || '';

        if (category.includes('INFERENCE') || category.includes('INFER')) {
            skills.push(
                'Infer Implication',
                'Infer Speaker Role',
                'Infer Author Purpose'
            );
        } else if (category.includes('DETAIL')) {
            skills.push(
                'Specific Detail Identification',
                'Information Scanning'
            );
        } else if (category.includes('GIST')) {
            skills.push('Main Topic Identification', 'Purpose Recognition');
        } else if (category.includes('GRAMMAR')) {
            skills.push('Sentence Structure', 'Verb Forms', 'Word Forms');
        } else if (
            category.includes('VOCABULARY') ||
            category.includes('VOCAB')
        ) {
            skills.push('Word Choice', 'Collocations', 'Context Clues');
        } else if (category.includes('COHESION')) {
            skills.push(
                'Text Organization',
                'Linking Devices',
                'Paragraph Flow'
            );
        } else if (category.includes('SPECIFIC_ACTION')) {
            skills.push(
                'Understanding Requests',
                'Identifying Next Steps',
                'Problem Resolution'
            );
        } else if (category === 'OTHERS') {
            // For OTHERS category, add general comprehension skills
            skills.push(
                'Overall Comprehension',
                'Context Understanding',
                'Strategic Listening'
            );
        } else {
            // Fallback for any other category
            skills.push('General Skill Improvement');
        }

        // Remove duplicates and filter out any empty/undefined values
        const uniqueSkills = [...new Set(skills)].filter(
            (skill) => skill && skill.trim()
        );

        // Ensure we always have at least one skill
        if (uniqueSkills.length === 0) {
            return ['General improvement needed'];
        }

        return uniqueSkills;
    }

    /**
     * Map weakness category to skill category enum
     */
    private mapCategoryToSkillCategory(category: string): string {
        const upperCategory = category.toUpperCase();

        if (upperCategory.includes('GIST')) return 'GIST';
        if (upperCategory.includes('DETAIL')) return 'DETAIL';
        if (
            upperCategory.includes('INFERENCE') ||
            upperCategory.includes('INFER')
        )
            return 'INFERENCE';
        if (upperCategory.includes('SPECIFIC_ACTION')) return 'SPECIFIC_ACTION';
        if (upperCategory.includes('GRAMMAR')) return 'GRAMMAR';
        if (
            upperCategory.includes('VOCABULARY') ||
            upperCategory.includes('VOCAB')
        )
            return 'VOCABULARY';
        if (upperCategory.includes('COHESION')) return 'COHESION';

        return 'OTHERS';
    }

    /**
     * Map skill key to specific skill details for querying
     */
    private mapSkillKeyToSpecificSkills(skillKey: string): string[] {
        if (!skillKey) return [];

        const skills: string[] = [];
        const lowerKey = skillKey.toLowerCase();

        // Direct mapping for common skill keys
        if (lowerKey.includes('infer_speaker_role'))
            skills.push('infer_speaker_role');
        if (lowerKey.includes('infer_location')) skills.push('infer_location');
        if (lowerKey.includes('infer_implication'))
            skills.push('infer_implication');
        if (lowerKey.includes('infer_feeling'))
            skills.push('infer_feeling_attitude');
        if (lowerKey.includes('main_topic')) skills.push('main_topic');
        if (lowerKey.includes('purpose')) skills.push('purpose');
        if (lowerKey.includes('problem')) skills.push('problem');
        if (lowerKey.includes('specific_detail'))
            skills.push('specific_detail');
        if (lowerKey.includes('reason_cause')) skills.push('reason_cause');
        if (lowerKey.includes('amount_quantity'))
            skills.push('amount_quantity');
        if (lowerKey.includes('visual_information'))
            skills.push('visual_information');
        if (lowerKey.includes('next_action')) skills.push('next_action');
        if (lowerKey.includes('request_offer')) skills.push('request_offer');

        return skills;
    }

    /**
     * Map skill key/category to resource topics
     */
    public getTopicKeywords(skillKey: string, category: string): string[] {
        const keywords: string[] = [];

        // Handle undefined skillKey
        if (!skillKey || !category) {
            return keywords;
        }

        const lowerSkillKey = skillKey.toLowerCase();
        const upperCategory = category.toUpperCase();

        // === Listening Comprehension Skills ===
        if (
            lowerSkillKey.includes('main_topic') ||
            lowerSkillKey.includes('purpose') ||
            upperCategory.includes('GIST')
        ) {
            keywords.push(
                'listening comprehension',
                'main idea',
                'gist',
                'overall purpose'
            );
        }

        if (
            lowerSkillKey.includes('specific_detail') ||
            upperCategory === 'DETAIL'
        ) {
            keywords.push(
                'detail comprehension',
                'specific information',
                'listening for details'
            );
        }

        if (lowerSkillKey.includes('infer') || upperCategory === 'INFERENCE') {
            keywords.push(
                'inference',
                'implication',
                'reasoning',
                'reading between the lines'
            );
        }

        // === Grammar Skills (specific patterns only) ===
        if (upperCategory === 'GRAMMAR') {
            if (
                lowerSkillKey.includes('verb_tense') ||
                lowerSkillKey.includes('tense')
            ) {
                keywords.push('verb tenses', 'tense usage', 'time expressions');
            } else if (lowerSkillKey.includes('word_form')) {
                keywords.push('word forms', 'parts of speech', 'derivation');
            } else if (lowerSkillKey.includes('preposition')) {
                keywords.push('prepositions', 'prepositional phrases');
            } else if (lowerSkillKey.includes('article')) {
                keywords.push('articles', 'a/an/the usage');
            } else {
                // Generic grammar - less specific
                keywords.push('grammar', 'sentence structure');
            }
        }

        // === Vocabulary Skills (specific patterns only) ===
        if (upperCategory === 'VOCABULARY') {
            if (lowerSkillKey.includes('word_choice')) {
                keywords.push('word choice', 'vocabulary in context');
            } else if (lowerSkillKey.includes('collocation')) {
                keywords.push(
                    'collocations',
                    'word combinations',
                    'natural expressions'
                );
            } else if (
                lowerSkillKey.includes('synonym') ||
                lowerSkillKey.includes('paraphras')
            ) {
                keywords.push('synonyms', 'paraphrasing', 'similar meanings');
            } else {
                keywords.push('vocabulary', 'word usage');
            }
        }

        // === Reading Skills ===
        if (
            lowerSkillKey.includes('paraphras') ||
            lowerSkillKey.includes('scanning')
        ) {
            keywords.push(
                'reading comprehension',
                'paraphrasing',
                'scanning techniques'
            );
        }

        if (
            lowerSkillKey.includes('text_organization') ||
            upperCategory === 'COHESION'
        ) {
            keywords.push(
                'text organization',
                'cohesion',
                'coherence',
                'discourse markers'
            );
        }

        // === Specific Action Skills ===
        if (upperCategory === 'SPECIFIC_ACTION') {
            keywords.push('next steps', 'problem solving', 'request handling');
        }

        // console.log(`Mapped ${category}/${skillKey} to keywords:`, keywords);
        return keywords;
    }

    /**
     * Map severity to difficulty level
     */
    private mapSeverityToDifficulty(severity: SeverityLevel): Difficulty {
        switch (severity) {
            case SeverityLevel.CRITICAL:
            case SeverityLevel.HIGH:
                return Difficulty.BEGINNER;
            case SeverityLevel.MEDIUM:
                return Difficulty.INTERMEDIATE;
            default:
                return Difficulty.ADVANCED;
        }
    }

    /**
     * Get recommended question count based on severity
     */
    private getRecommendedQuestionCount(severity: SeverityLevel): number {
        switch (severity) {
            case SeverityLevel.CRITICAL:
                return 30;
            case SeverityLevel.HIGH:
                return 20;
            case SeverityLevel.MEDIUM:
                return 15;
            default:
                return 10;
        }
    }
    /**
     * Format skill key to display name
     */
    private formatSkillName(skillKey: string): string {
        if (!skillKey) {
            return 'Unknown Skill';
        }
        return skillKey
            .split('_')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    /**
     * Get study plan by ID
     */
    async getStudyPlan(
        studyPlanId: Schema.Types.ObjectId | string
    ): Promise<typeof StudyPlan.prototype | null> {
        return await StudyPlan.findById(studyPlanId).populate('testResultId');
    }

    /**
     * Get active study plan for user
     */
    async getActiveStudyPlan(
        userId: Schema.Types.ObjectId | string
    ): Promise<typeof StudyPlan.prototype | null> {
        return await StudyPlan.findOne({
            userId,
            status: 'active',
        })
            .sort({ createdAt: -1 })
            .populate('testResultId');
    }

    /**
     * Update study plan item progress
     */
    async updateItemProgress(
        studyPlanId: Schema.Types.ObjectId | string,
        itemPriority: number,
        progress: number
    ): Promise<typeof StudyPlan.prototype | null> {
        const studyPlan = await StudyPlan.findById(studyPlanId);
        if (!studyPlan) {
            return null;
        }

        // Update specific item
        const planItems = studyPlan.planItems as Array<{
            priority: number;
            progress: number;
            status: string;
        }>;
        const item = planItems.find((i) => i.priority === itemPriority);
        if (item) {
            item.progress = progress;
            item.status =
                progress >= 100
                    ? 'completed'
                    : progress > 0
                      ? 'in_progress'
                      : 'pending';
        }

        // Recalculate overall progress
        const totalProgress = planItems.reduce((sum, i) => sum + i.progress, 0);
        studyPlan.overallProgress = Math.round(
            totalProgress / planItems.length
        );

        // Update status if all completed
        if (planItems.every((i) => i.status === 'completed')) {
            studyPlan.status = 'completed';
        }

        await studyPlan.save();
        return studyPlan;
    }
}

export const studyPlanGeneratorService = new StudyPlanGeneratorService();
