-- The company's real working hours, as HR's portal and timekeeping keep them: Monday to Saturday,
-- 7:00 to 16:00 with an hour's lunch (eight hours a day), Sunday the rest day, no grace period
-- (late and undertime count in 15-minute blocks).
update work_schedule set days = '{1,2,3,4,5,6}', starts = '07:00', ends = '16:00', grace_minutes = 0,
  break_minutes = 60
where is_default and name = 'Office hours' and days = '{1,2,3,4,5}' and starts = '08:00' and ends = '17:00';
--> statement-breakpoint
alter table work_schedule alter column days set default '{1,2,3,4,5,6}';
--> statement-breakpoint
alter table work_schedule alter column starts set default '07:00';
--> statement-breakpoint
alter table work_schedule alter column ends set default '16:00';
--> statement-breakpoint
alter table work_schedule alter column grace_minutes set default 0;
--> statement-breakpoint
create or replace function work_minutes(a timestamptz, b timestamptz) returns integer
language plpgsql stable as $$
declare
  s work_schedule%rowtype;
  d date;
  last date;
  opens timestamptz;
  closes timestamptz;
  total double precision := 0;
begin
  if a is null or b is null or b <= a then return 0; end if;
  select * into s from work_schedule where is_default and active limit 1;
  if not found then
    s.days := '{1,2,3,4,5,6}'; s.starts := '07:00'; s.ends := '16:00';
  end if;
  d := (a at time zone 'Asia/Manila')::date;
  last := (b at time zone 'Asia/Manila')::date;
  while d <= last loop
    if extract(dow from d)::int = any (s.days)
      and not exists (select 1 from holiday h where h.day = d and h.active) then
      opens := (d + s.starts) at time zone 'Asia/Manila';
      closes := (d + s.ends) at time zone 'Asia/Manila';
      if least(b, closes) > greatest(a, opens) then
        total := total + extract(epoch from least(b, closes) - greatest(a, opens));
      end if;
    end if;
    d := d + 1;
  end loop;
  return floor(total / 60)::int;
end $$;
