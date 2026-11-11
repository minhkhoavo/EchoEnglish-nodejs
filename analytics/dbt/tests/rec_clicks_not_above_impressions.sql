-- Over the whole history a variant cannot have more clicks than impressions.
select variant, mode
from {{ ref('stg_events') }}
where type in ('rec_impression', 'rec_click') and variant != ''
group by variant, mode
having countIf(type = 'rec_click') > countIf(type = 'rec_impression')
