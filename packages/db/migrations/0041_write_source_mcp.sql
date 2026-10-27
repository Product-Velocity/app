-- Write source for Claude MCP (spike S8b, docs/20 FR-1).
-- Until now a client could label its own writes "Claude MCP" with the advisory
-- x-pv-via header. Now the label comes from the access token itself: tokens
-- issued by Supabase's OAuth 2.1 server carry a `client_id` claim (signed, so a
-- user cannot add or remove it); the app's own sessions never do.
--   * token with client_id  -> always 'Claude MCP', whatever the header says
--   * header 'Claude MCP' without that claim -> not honoured, recorded as 'API'
--   * app.via (set by server code inside a transaction) still wins, as before
create or replace function public.write_source() returns text
language plpgsql stable set search_path = '' as $$
declare
  v text := nullif(current_setting('app.via', true), '');
  oauth_client text := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id', '');
begin
  if v is null then
    if oauth_client is not null then
      return 'Claude MCP';
    end if;
    v := nullif(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-pv-via', '');
    if v = 'Claude MCP' then
      v := 'API'; -- forged: only an OAuth-issued token may carry this source
    end if;
  end if;
  if v is null then
    return case when auth.uid() is null then 'system' else 'API' end;
  end if;
  if v not in ('UI', 'API', 'Claude MCP', 'GitHub webhook', 'import', 'system') then
    raise exception 'invalid write source: %', v;
  end if;
  return v;
end $$;
