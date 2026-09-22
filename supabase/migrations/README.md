# Migrations

Run these **in filename order** (they're dated, so that's just top-to-bottom
alphabetically), each once, directly in the Supabase SQL editor. Every file
is safe to re-run if you're not sure whether it already ran. Re-running an
**earlier** file *after* a later one, though, can undo a later grant (e.g.
running `2026-09-profile-display-name.sql` again after
`2026-09-theme-feedback-admin.sql` would narrow the column-update grant back
to `display_name` only, dropping `theme`) -- if that happens, just re-run the
later file again afterwards to restore it.

If you're setting up a brand-new project, ignore this folder entirely and
run `supabase/schema.sql` once -- it already includes everything here.
