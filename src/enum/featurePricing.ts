export enum FeaturePricingType {
    TEST_ANALYSIS_LR = 'test_analysis_lr',
    TEST_ANALYSIS_SPEAKING = 'test_analysis_speaking',
    TEST_ANALYSIS_WRITING = 'test_analysis_writing',
    SPEECH_ASSESSMENT = 'speech_assessment',
}

export const FEATURE_PRICING_MAP: Record<FeaturePricingType, number> = {
    [FeaturePricingType.TEST_ANALYSIS_LR]: 10,
    [FeaturePricingType.TEST_ANALYSIS_SPEAKING]: 15,
    [FeaturePricingType.TEST_ANALYSIS_WRITING]: 15,
    [FeaturePricingType.SPEECH_ASSESSMENT]: 5,
};

export const FEATURE_DESCRIPTION_MAP: Record<FeaturePricingType, string> = {
    [FeaturePricingType.TEST_ANALYSIS_LR]:
        'Analyze Listening & Reading test result',
    [FeaturePricingType.TEST_ANALYSIS_SPEAKING]: 'Analyze Speaking test result',
    [FeaturePricingType.TEST_ANALYSIS_WRITING]: 'Analyze Writing test result',
    [FeaturePricingType.SPEECH_ASSESSMENT]:
        'Speech assessment and pronunciation analysis',
};
