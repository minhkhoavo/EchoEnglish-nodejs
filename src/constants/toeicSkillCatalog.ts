import { AVAILABLE_DOMAINS } from '../enum/domain.js';

export const AVAILABLE_SKILLS = {
    // Part 1: Photographs
    part1: [
        'identify_action_in_progress',
        'identify_state_condition',
        'identify_spatial_relationship',
    ],
    // Part 2: Question-Response
    part2: [
        'wh_question',
        'yes_no',
        'tag_question',
        'statement',
        'alternative',
        'negative_question',
        'information_seeking',
        'request',
        'suggestion',
        'offer',
        'opinion',
        'direct',
        'indirect',
    ],
    // Parts 3 & 4: Conversations & Talks
    part34: [
        'main_topic',
        'purpose',
        'problem',
        'specific_detail',
        'reason_cause',
        'amount_quantity',
        'infer_speaker_role',
        'infer_location',
        'infer_implication',
        'infer_feeling_attitude',
        'future_action',
        'recommended_action',
        'requested_action',
        'speaker_intent',
        'connect_to_graphic',
    ],
    // Part 5: Incomplete Sentences
    part5: [
        'word_form',
        'verb_tense_mood',
        'subject_verb_agreement',
        'pronoun',
        'preposition',
        'conjunction',
        'relative_clause',
        'comparative_superlative',
        'participle',
        'word_choice',
        'collocation',
        'phrasal_verb',
    ],
    // Part 6: Text Completion
    part6: [
        'grammar',
        'vocabulary',
        'sentence_insertion',
        'discourse_connector',
    ],
    // Part 7: Reading Comprehension
    part7: [
        'main_topic_purpose',
        'scanning',
        'paraphrasing',
        'infer_implication',
        'infer_author_purpose',
        'vocabulary_in_context',
        'sentence_insertion',
        'cross_reference',
    ],
} as const;

export { AVAILABLE_DOMAINS };
