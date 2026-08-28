-- Meero — real refund on build cancellation.
--
-- POST /builds/{id}/cancel (a real, working "Stop" button) fully refunds the
-- flat WEB_BUILD_COST charged at build start, since a stopped build produced
-- nothing real — see AGENTS.md. Mirrors charge_credits()'s roll-over-if-
-- expired structure (00012_weekly_token_reset.sql) but ADDS p_amount back
-- instead of subtracting: fills the weekly credits_remaining up to the
-- plan's cap first, then any overflow lands in the uncapped, non-expiring
-- bonus_credits — the exact reverse order of charge_credits' weekly-then-
-- bonus spend.

create or replace function public.refund_credits(p_user_id uuid, p_amount integer)
returns table(remaining integer, plan text, reset_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_credits integer;
  v_bonus integer;
  v_reset timestamptz;
  v_limit integer;
  v_refund_weekly integer;
  v_refund_bonus integer;
begin
  select p.plan, p.credits_remaining, p.bonus_credits, p.credits_reset_at
    into v_plan, v_credits, v_bonus, v_reset
    from public.profiles p
    where p.id = p_user_id
    for update;

  if not found then
    return query select 0, 'free'::text, now();
    return;
  end if;

  if now() >= v_reset then
    v_credits := public.plan_daily_tokens(v_plan);
    v_reset := public.next_weekly_reset();
  end if;

  v_limit := public.plan_daily_tokens(v_plan);
  v_refund_weekly := least(greatest(p_amount, 0), greatest(v_limit - v_credits, 0));
  v_credits := v_credits + v_refund_weekly;
  v_refund_bonus := greatest(p_amount, 0) - v_refund_weekly;
  v_bonus := v_bonus + v_refund_bonus;

  update public.profiles
    set credits_remaining = v_credits, credits_reset_at = v_reset, bonus_credits = v_bonus
    where id = p_user_id;

  return query select v_credits + v_bonus, v_plan, v_reset;
end;
$$;

revoke all on function public.refund_credits(uuid, integer) from public;
grant execute on function public.refund_credits(uuid, integer) to service_role;
