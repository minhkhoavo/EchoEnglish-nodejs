-- one row per learner-day (dbt's built-in `unique` handles one column only)
select user_pseudo, day from {{ ref('learner_daily_facts') }} group by user_pseudo, day having count() > 1
