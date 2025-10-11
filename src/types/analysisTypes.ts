export type PartNumber = '1' | '2' | '3' | '4' | '5' | '6' | '7';

// Part 1: Photographs
export interface Part1Skills {
    part: '1';
    skills: (
        | 'identifyActionInProgress'
        | 'identifyStateCondition'
        | 'identifySpatialRelationship'
    )[];
    distractorTypes: ('phoneticSimilarity' | 'wrongSubjectVerb')[];
}

// Part 2: Question-Response
export type QuestionForm =
    | 'whQuestion'
    | 'yesNo'
    | 'tagQuestion'
    | 'statement'
    | 'alternative'
    | 'negativeQuestion';
export type QuestionFunction =
    | 'informationSeeking'
    | 'request'
    | 'suggestion'
    | 'offer'
    | 'opinion';
export type ResponseStrategy = 'direct' | 'indirect';

export interface Part2Skills {
    part: '2';
    questionForm: QuestionForm;
    questionFunction: QuestionFunction;
    responseStrategy: ResponseStrategy;
}

// Parts 3 & 4: Conversations & Talks
export type Part34SkillCategory =
    | 'GIST'
    | 'DETAIL'
    | 'INFERENCE'
    | 'SPECIFIC_ACTION'
    | 'OTHERS';
export type Part34SkillDetail =
    | 'mainTopic'
    | 'purpose'
    | 'problem' // GIST
    | 'specificDetail'
    | 'reasonCause'
    | 'amountQuantity' // DETAIL
    | 'inferSpeakerRole'
    | 'inferLocation'
    | 'inferImplication'
    | 'inferFeelingAttitude' // INFERENCE
    | 'futureAction'
    | 'recommendedAction'
    | 'requestedAction' // SPECIFIC_ACTION
    | 'speakerIntent'
    | 'connectToGraphic'; // OTHERS

export interface Part34Skills {
    part: '3' | '4';
    skillCategory: Part34SkillCategory;
    skillDetail: Part34SkillDetail;
}

// Part 5: Incomplete Sentences
export type GrammarPoint =
    | 'wordForm'
    | 'verbTenseMood'
    | 'subjectVerbAgreement'
    | 'pronoun'
    | 'preposition'
    | 'conjunction'
    | 'relativeClause'
    | 'comparativeSuperlative'
    | 'participle';

export type VocabPoint = 'wordChoice' | 'collocation' | 'phrasalVerb';

export interface Part5Skills {
    part: '5';
    grammarPoint?: GrammarPoint;
    vocabPoint?: VocabPoint;
}

// Part 6: Text Completion
export type Part6TagType =
    | 'grammar'
    | 'vocabulary'
    | 'sentenceInsertion'
    | 'discourseConnector';

export interface Part6Skills {
    part: '6';
    tagType: Part6TagType;
    grammarPoint?: GrammarPoint;
    vocabPoint?: VocabPoint;
}

// Part 7: Reading Comprehension
export type Part7SkillCategory = 'GIST' | 'DETAIL' | 'INFERENCE' | 'OTHERS';
export type Part7SkillDetail =
    | 'mainTopicPurpose' // GIST
    | 'scanning'
    | 'paraphrasing' // DETAIL
    | 'inferImplication'
    | 'inferAuthorPurpose' // INFERENCE
    | 'vocabularyInContext'
    | 'sentenceInsertion'
    | 'crossReference'; // OTHERS

export type PassageType = 'single' | 'double' | 'triple';

export interface Part7Skills {
    part: '7';
    skillCategory: Part7SkillCategory;
    skillDetail: Part7SkillDetail;
    passageType: PassageType;
    requiresCrossReference: boolean;
}

// Content Tags
export interface ContentTags {
    difficulty: 'beginner' | 'intermediate' | 'advanced';
    style: string;
    domain: string[];
    genre: string[];
    setting: string[];
}

// Question metadata
export interface QuestionMetadata {
    questionId: string;
    part: PartNumber;
    contentTags: ContentTags;
    skillTags:
        | Part1Skills
        | Part2Skills
        | Part34Skills
        | Part5Skills
        | Part6Skills
        | Part7Skills;
}

// User answer record
export interface UserAnswer {
    questionId: string;
    questionNumber: number;
    userAnswer: string;
    correctAnswer: string;
    isCorrect: boolean;
    metadata: QuestionMetadata;
    timeTaken?: number; // seconds
    answerChanges?: number;
    skipped?: boolean;
}

// Time-based answer patterns
export type AnswerPattern =
    | 'quick_correct' // Fast + Correct (mastered)
    | 'slow_correct' // Slow + Correct (not familiar)
    | 'quick_incorrect' // Fast + Wrong (misunderstanding)
    | 'slow_incorrect'; // Slow + Wrong (confused)

export interface TimeBasedAnalysis {
    pattern: AnswerPattern;
    count: number;
    percentage: number;
    avgTime: number;
    description: string;
}

// Aggregated performance by skill
export interface SkillPerformance {
    skillName: string;
    skillKey: string;
    total: number;
    correct: number;
    incorrect: number;
    accuracy: number; // percentage
    avgTime?: number; // average time spent on this skill
}

// Part-specific analysis
export interface PartAnalysis {
    partNumber: PartNumber;
    totalQuestions: number;
    correctAnswers: number;
    accuracy: number;
    avgTimePerQuestion?: number;
    skillBreakdown: SkillPerformance[];
    contextualAnalysis?: {
        byDomain: Record<string, SkillPerformance>;
        byDifficulty: Record<string, SkillPerformance>;
    };
}

// Overall skill dimensions for radar chart - flexible to allow any skill categories
export interface OverallSkillDimensions {
    [skillName: string]: number; // percentage values for any skill category
}

// Weakness severity levels
export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low';

// Diagnosis insight
export interface DiagnosisInsight {
    id: string;
    severity: SeverityLevel;
    category: string;
    title: string;
    description: string;
    affectedParts: PartNumber[];
    userAccuracy: number;
    benchmarkAccuracy?: number;
    impactScore: number; // 0-100, how much this affects overall score
    relatedPattern?: AnswerPattern; // Related time-based pattern
}

// Learning resource
export interface LearningResource {
    id: string;
    type: 'video' | 'article' | 'flashcard' | 'drill';
    title: string;
    description: string;
    estimatedTime: number; // minutes
    url?: string;
    resourceId?: string; // Reference to actual resource
}

// Weakness drill
export interface WeaknessDrill {
    id: string;
    title: string;
    description: string;
    targetSkill: string;
    totalQuestions: number;
    estimatedTime: number; // minutes
    difficulty: 'beginner' | 'intermediate' | 'advanced';
    completed?: boolean;
    completedAt?: Date;
    score?: number;
}

// Study plan item
export interface StudyPlanItem {
    id: string;
    priority: number; // 1, 2, 3
    title: string;
    description: string;
    targetWeakness: string;
    skillsToImprove: string[];
    resources: LearningResource[];
    drills: WeaknessDrill[];
    progress: number; // 0-100
    estimatedWeeks: number;
    startedAt?: Date;
    completedAt?: Date;
}
