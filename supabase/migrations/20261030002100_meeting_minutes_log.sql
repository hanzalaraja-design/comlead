-- Who wrote and edited a meeting's minutes, for everyone who can see the meeting.
-- (The activity log itself stays private; this shares only name and time.)

create or replace function public.meeting_minutes_log(p_meeting_id uuid)
returns table (actor_id uuid, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select a.actor_id, a.created_at
    from public.activity_log a
   where a.meeting_id = p_meeting_id
     and a.action = 'meeting.minutes_edited'
     and coalesce((a.old_value ->> 'minutes_changed')::boolean, false)
     and exists (
       select 1 from public.meetings m
        where m.id = p_meeting_id
          and (public.can_read_dept(m.department_id)
               or public.is_meeting_attendee(m.id)
               or (m.series_id is not null and public.is_series_invitee(m.series_id))))
   order by a.created_at
   limit 200;
$$;

revoke all on function public.meeting_minutes_log(uuid) from public, anon;
grant execute on function public.meeting_minutes_log(uuid) to authenticated;

notify pgrst, 'reload schema';
