{# One row per event (FINAL collapses at-least-once re-deliveries). Props extraction that other
   models and the API share lives here so each prop's meaning is defined once. #}
select
    event_id,
    user_pseudo,
    region,
    type,
    occurred_at,
    day,
    hour,
    props,
    JSONExtractString(props, 'variant') as variant,
    JSONExtractString(props, 'mode')    as mode,
    JSONExtractString(props, 'recId')   as rec_id
from {{ source('echo', 'events') }} final
