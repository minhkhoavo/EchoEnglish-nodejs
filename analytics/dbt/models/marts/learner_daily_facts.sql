{{ config(engine='MergeTree()', order_by='(day, user_pseudo)') }}
{# SQL twin of src/recsys/etl/aggregate.ts (aggregateDay). Keep the two in lock-step: the
   Mongo-vs-ClickHouse parity test in __tests__/live compares their KPI output. #}
with e as (
    select * from {{ ref('stg_events') }}
),
scored as (
    select
        user_pseudo, day,
        countIf(type in ('question_answered', 'test_submitted', 'flashcard_reviewed',
                         'vocab_captured', 'pronunciation_scored', 'writing_scored')) as learning_actions,
        -- study-time rule: tests count their own duration; in-test questions are NOT added again;
        -- session_ended is app-open time and never counts as study time.
        sumIf(JSONExtractFloat(props, 'durationSec'), type = 'test_submitted')
          + sumIf(JSONExtractFloat(props, 'timeMs') / 1000,
                  type = 'question_answered' and JSONExtractString(props, 'origin') != 'test')
          + sumIf(JSONExtractFloat(props, 'latencyMs') / 1000, type = 'flashcard_reviewed')
          + sumIf(JSONExtractFloat(props, 'dwellSec'), type = 'resource_viewed')
          + sumIf(JSONExtractFloat(props, 'durationSec'), type in ('pronunciation_scored', 'writing_scored'))
          as study_seconds_raw,
        countIf(type = 'session_started') as sessions,
        countIf(type = 'question_answered') as questions_answered,
        countIf(type = 'question_answered' and JSONExtractBool(props, 'correct')) as questions_correct,
        countIf(type = 'flashcard_reviewed') as flashcards_reviewed,
        countIf(type = 'test_submitted') as tests_submitted,
        sumIf(JSONExtractFloat(props, 'credits'), type = 'credit_spent') as credits_spent,
        sumIf(JSONExtractFloat(props, 'costUsd'), type = 'ai_usage') as ai_cost_usd_raw,
        countIf(type = 'rec_impression') as rec_impressions,
        countIf(type = 'rec_click') as rec_clicks,
        countIf(type = 'rec_complete') as rec_completes,
        countIf(type = 'rec_dismiss') as rec_dismisses,
        -- last full-test score of the day (partial-part tests have meaningless TOEIC scores)
        countIf(type = 'test_submitted' and JSONHas(props, 'totalScore')
                and not (JSONHas(props, 'full') and not JSONExtractBool(props, 'full'))) as scored_tests,
        argMaxIf(JSONExtractFloat(props, 'totalScore'), occurred_at,
                 type = 'test_submitted' and JSONHas(props, 'totalScore')
                 and not (JSONHas(props, 'full') and not JSONExtractBool(props, 'full'))) as last_score_raw
    from e
    group by user_pseudo, day
)
select
    user_pseudo,
    day,
    learning_actions,
    toUInt64(floor(study_seconds_raw + 0.5)) as study_seconds,   -- Math.round semantics
    sessions,
    questions_answered,
    questions_correct,
    flashcards_reviewed,
    tests_submitted,
    credits_spent,
    round(ai_cost_usd_raw, 6) as ai_cost_usd,
    rec_impressions,
    rec_clicks,
    rec_completes,
    rec_dismisses,
    if(scored_tests > 0, last_score_raw, null) as last_test_score
from scored
