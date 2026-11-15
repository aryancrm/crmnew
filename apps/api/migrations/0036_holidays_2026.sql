-- The Philippines' 2026 national holidays (Proclamation No. 1006, s. 2025), as HR's portal keeps
-- them: desks' clocks stop on them and attendance doesn't count them as working days. HR adds the
-- next year's and any local holiday.
insert into holiday (day, name, kind) values
  ('2026-01-01', 'New Year''s Day', 'regular'),
  ('2026-02-17', 'Chinese New Year', 'special'),
  ('2026-03-20', 'Eid''l Fitr', 'regular'),
  ('2026-04-02', 'Maundy Thursday', 'regular'),
  ('2026-04-03', 'Good Friday', 'regular'),
  ('2026-04-04', 'Black Saturday', 'special'),
  ('2026-04-09', 'Araw ng Kagitingan', 'regular'),
  ('2026-05-01', 'Labor Day', 'regular'),
  ('2026-05-27', 'Eid''l Adha', 'regular'),
  ('2026-06-12', 'Independence Day', 'regular'),
  ('2026-08-21', 'Ninoy Aquino Day', 'special'),
  ('2026-08-31', 'National Heroes Day', 'regular'),
  ('2026-11-01', 'All Saints'' Day', 'special'),
  ('2026-11-02', 'All Souls'' Day', 'special'),
  ('2026-11-30', 'Bonifacio Day', 'regular'),
  ('2026-12-08', 'Feast of the Immaculate Conception of Mary', 'special'),
  ('2026-12-24', 'Christmas Eve', 'special'),
  ('2026-12-25', 'Christmas Day', 'regular'),
  ('2026-12-30', 'Rizal Day', 'regular'),
  ('2026-12-31', 'Last Day of the Year', 'special')
on conflict (day) where active do nothing;
