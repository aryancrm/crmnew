-- Management's, Finance's and Dispatch's shared desk screen comes back (Aryan, 27 Nov: "previously
-- Management, Finance and Dispatch had a common password only; bring it back"): opened with the
-- company's desk password, which its Admin types in the Admin panel (kept only as a hash, in the
-- setting 'desk_password'). A desk session of before 23 Nov (0142) must not come back to life with it.
delete from session where desk is not null;
