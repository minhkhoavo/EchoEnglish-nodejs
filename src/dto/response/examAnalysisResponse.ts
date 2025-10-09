/**
 * Response DTOs for Exam Analysis API
 * These DTOs match EXACTLY with frontend interface requirements
 */

// Overall skill dimensions for radar chart - flexible to allow any skill categories
export class OverallSkillDimensionsDto {
    [skillName: string]: number;
}

// Skill performance breakdown
export class SkillPerformanceDto {
    skillName!: string;
    skillKey!: string;
    total!: number;
    correct!: number;
    incorrect!: number;
    accuracy!: number;
    avgTime?: number;
}

// Contextual analysis
export class ContextualAnalysisDto {
    byDomain!: Record<string, SkillPerformanceDto>;
    byDifficulty!: Record<string, SkillPerformanceDto>;
}

// Part-specific analysis
export class PartAnalysisDto {
    partNumber!: string;
    totalQuestions!: number;
    correctAnswers!: number;
    accuracy!: number;
    avgTimePerQuestion?: number;
    skillBreakdown!: SkillPerformanceDto[];
    contextualAnalysis?: ContextualAnalysisDto;
}

// Time-based analysis
export class TimeBasedAnalysisDto {
    pattern!:
        | 'quick_correct'
        | 'slow_correct'
        | 'quick_incorrect'
        | 'slow_incorrect';
    count!: number;
    percentage!: number;
    avgTime!: number;
    description!: string;
}

// Diagnosis insight
export class DiagnosisInsightDto {
    id!: string;
    severity!: 'critical' | 'high' | 'medium' | 'low';
    category!: string;
    title!: string;
    description!: string;
    affectedParts!: string[];
    userAccuracy!: number;
    benchmarkAccuracy?: number;
    impactScore!: number;
    relatedPattern?:
        | 'quick_correct'
        | 'slow_correct'
        | 'quick_incorrect'
        | 'slow_incorrect';
}

// Learning resource
export class LearningResourceDto {
    id!: string;
    type!: 'video' | 'article' | 'flashcard' | 'drill';
    title!: string;
    description!: string;
    estimatedTime!: number;
    url?: string;
    resourceId?: string;
}

// Weakness drill
export class WeaknessDrillDto {
    id!: string;
    title!: string;
    description!: string;
    targetSkill!: string;
    totalQuestions!: number;
    estimatedTime!: number;
    difficulty!: 'beginner' | 'intermediate' | 'advanced';
    completed?: boolean;
    completedAt?: Date;
    score?: number;
}

// Study plan item
export class StudyPlanItemDto {
    id!: string;
    priority!: number;
    title!: string;
    description!: string;
    targetWeakness!: string;
    skillsToImprove!: string[];
    resources!: LearningResourceDto[];
    drills!: WeaknessDrillDto[];
    progress!: number;
    estimatedWeeks!: number;
    startedAt?: Date;
    completedAt?: Date;
}

// Complete exam analysis result
export class ExamAnalysisResultDto {
    examAttemptId!: string;
    userId!: string;
    examDate!: Date;

    // Overall scores
    listeningScore!: number;
    readingScore!: number;
    totalScore!: number;

    // Aggregated analysis
    overallSkills!: OverallSkillDimensionsDto;
    partAnalyses!: PartAnalysisDto[];

    // Time-based patterns
    timeAnalysis!: TimeBasedAnalysisDto[];

    // Diagnosis
    weaknesses!: DiagnosisInsightDto[];
    strengths!: string[];

    // Study plan
    studyPlan!: StudyPlanItemDto[];
}

// Study plan response (when fetching study plan separately)
export class StudyPlanResponseDto {
    id!: string;
    userId!: string;
    analysisResultId!: string;
    studyPlan!: StudyPlanItemDto[];
    overallProgress!: number;
    status!: 'active' | 'completed' | 'abandoned';
    createdAt!: Date;
    updatedAt!: Date;
}

// Drill completion request
export class DrillSubmissionDto {
    drillId!: string;
    userId!: string;
    answers!: {
        questionNumber: number;
        selectedAnswer: string;
        correctAnswer: string;
        isCorrect: boolean;
        timeTaken?: number;
    }[];
}

// Drill result response
export class DrillResultDto {
    drillId!: string;
    score!: number;
    totalQuestions!: number;
    accuracy!: number;
    timeSpent!: number;
    improvements!: {
        skillKey: string;
        previousAccuracy: number;
        currentAccuracy: number;
        improvement: number;
    }[];
    feedback!: string;
    nextRecommendedDrill?: WeaknessDrillDto;
}
