-- Add morning check-in and evening timing fields to daily_logs
alter table daily_logs add column if not exists morning_energy int; -- 1-5
alter table daily_logs add column if not exists morning_mood int; -- 1-5
alter table daily_logs add column if not exists morning_soreness int; -- 1-5
alter table daily_logs add column if not exists morning_note text;

alter table daily_logs add column if not exists phone_away_time time; -- time phone was put away
alter table daily_logs add column if not exists bed_time time; -- time got into bed
alter table daily_logs add column if not exists wind_down text; -- 'good' | 'ok' | 'poor'
alter table daily_logs add column if not exists evening_note text;

alter table daily_logs add column if not exists ai_insight text; -- stored AI analysis
alter table daily_logs add column if not exists ai_insight_date date; -- when insight was generated
