-- Reports must return clean zeroes on an empty hotel, never nulls or
-- a divide-by-zero. This is the state the owner sees on day one.
do $$
declare r record; v_prop uuid;
begin
  select id into v_prop from properties where slug = 'greek-club-dahab';

  select * into r from report_summary(v_prop, current_date - 30, current_date + 1);
  raise notice 'nights_sold=% available=% occupancy=% revenue=% adr=% revpar=%',
    r.nights_sold, r.nights_available, r.occupancy_pct, r.room_revenue, r.adr, r.revpar;
  raise notice 'bookings=% cancellations=% no_shows=% collected=% outstanding=%',
    r.bookings_made, r.cancellations, r.no_shows, r.collected, r.outstanding;

  if r.nights_sold is null or r.occupancy_pct is null or r.adr is null then
    raise exception 'report returned nulls where zeroes were expected';
  end if;

  raise notice 'daily rows: %', (select count(*) from report_daily(v_prop, current_date, current_date + 7));
  raise notice 'source rows: %', (select count(*) from report_by_source(v_prop, current_date - 30, current_date + 1));
  raise notice 'outstanding rows: %', (select count(*) from report_outstanding(v_prop));
  raise notice 'all reports ran without error';
end $$;
