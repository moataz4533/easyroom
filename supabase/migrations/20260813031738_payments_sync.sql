-- bookings.paid_amount was a number nobody updated. Making it a cached
-- sum of the payments rows means the two can never disagree — the
-- classic way hotel books go wrong is a total that was edited by hand
-- while the receipts say something else.
create or replace function sync_booking_paid()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_booking uuid;
begin
  v_booking := coalesce(new.booking_id, old.booking_id);

  update bookings b
     set paid_amount = coalesce(
       (select sum(p.amount) from payments p where p.booking_id = v_booking), 0)
   where b.id = v_booking;

  return coalesce(new, old);
end;
$$;

create trigger trg_payments_sync
  after insert or update or delete on payments
  for each row execute function sync_booking_paid();

-- Bring existing rows in line (none yet, but the migration must be
-- correct if it is ever replayed onto a live database).
update bookings b
   set paid_amount = coalesce(
     (select sum(p.amount) from payments p where p.booking_id = b.id), 0);

-- paid_amount is now derived, so nothing should write it directly.
comment on column bookings.paid_amount is
  'Cached sum of payments rows, maintained by trg_payments_sync. Never write directly.';

-- Corrections are a negative entry, never an edit or a delete, so the
-- audit trail stays intact. The check constraint has to allow negatives.
alter table bookings drop constraint if exists bookings_check1;
alter table bookings add constraint bookings_amounts_sane
  check (total_amount >= 0);

-- Record a payment. A function rather than a direct insert so the
-- booking is validated and the action is logged.
create or replace function record_payment(
  p_booking uuid,
  p_amount  numeric,
  p_method  text default 'cash',
  p_note    text default null
)
returns payments
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_booking bookings;
  v_payment payments;
begin
  select * into v_booking from bookings where id = p_booking;
  if not found then raise exception 'booking not found'; end if;
  if not can_manage(v_booking.property_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_amount = 0 then
    raise exception 'المبلغ لازم يكون أكبر من صفر';
  end if;

  insert into payments (property_id, booking_id, amount, currency,
                        method, notes, received_by, received_at)
  values (v_booking.property_id, p_booking, p_amount, v_booking.currency,
          coalesce(p_method, 'cash'), p_note, auth.uid(), now())
  returning * into v_payment;

  insert into activity_log (property_id, actor_id, entity_type, entity_id, action, payload)
  values (v_booking.property_id, auth.uid(), 'payment', v_payment.id,
          case when p_amount < 0 then 'refunded' else 'received' end,
          jsonb_build_object('booking', p_booking, 'amount', p_amount, 'method', p_method));

  return v_payment;
end;
$$;

-- Cash reconciliation: what should be in the drawer, split by method.
-- The question every front desk asks at the end of a shift.
create or replace function report_payments(
  p_property uuid, p_from date, p_to date
)
returns table (method text, count bigint, total numeric)
language sql stable security invoker set search_path = public as $$
  select p.method, count(*)::bigint, round(sum(p.amount), 2)
  from payments p
  where p.property_id = p_property
    and p.received_at >= p_from
    and p.received_at < (p_to + 1)::timestamptz
  group by p.method
  order by 3 desc;
$$;

revoke all on function record_payment(uuid, numeric, text, text) from public, anon;
revoke all on function report_payments(uuid, date, date)          from public, anon;
revoke all on function sync_booking_paid()                        from public, anon, authenticated;
grant execute on function record_payment(uuid, numeric, text, text) to authenticated;
grant execute on function report_payments(uuid, date, date)         to authenticated;
