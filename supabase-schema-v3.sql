-- Allow refresh_token to be null (WHOOP may not return one without offline scope)
alter table whoop_tokens alter column refresh_token drop not null;
