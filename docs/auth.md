# Authentication

Life Organizer uses Supabase Auth with **magic link (email OTP)** sign-in. New user
registration is disabled — access is granted only to users who have been explicitly
pre-inserted into the database.

---

## Sign-in Flow

1. The user enters their email on the login screen and clicks **Send magic link**.
2. The app calls `supabase.auth.signInWithOtp({ email })`.
3. Supabase checks whether the email exists in `auth.users`:
   - **Known email** — Supabase generates a one-time token and sends a magic link
     email via Resend (configured as the Supabase SMTP provider to bypass the
     3 emails/hour free-tier cap).
   - **Unknown email** — Supabase silently does nothing. No email is sent, no error
     is returned to the client.
4. The app shows "Check your email" regardless of outcome — the silent-drop behavior
   is intentional. There is no "wrong email" feedback by design.
5. The user clicks the link, which navigates back to the app with a `token_hash`
   query parameter.
6. The app calls `supabase.auth.verifyOtp({ token_hash, type: 'email' })`.
7. Supabase validates the token and returns a JWT session.
8. The session is stored and the user is signed in.

All subsequent requests include the JWT. Supabase RLS policies call `auth.uid()` to
match the JWT's `sub` claim against the `user_id` column on every data table — a user
who is not pre-inserted sees an empty app even if they somehow obtain a valid session.

---

## Adding a New User

New users must be pre-inserted via a database migration before they can sign in.

**Steps:**

1. Generate a new UUID:
   ```bash
   python3 -c "import uuid; print(uuid.uuid4())"
   ```

2. Copy the template:
   ```bash
   cp supabase/templates/add_user.sql \
      supabase/migrations/$(date +%Y%m%d%H%M%S)_add_user_<name>.sql
   ```

3. Edit the new migration file — replace the three placeholders:
   - `<USER_UUID>` — the UUID you generated in step 1
   - `<EMAIL>` — the user's email address (must match what they use to request a magic link)
   - `<FULL_NAME>` — display name stored in user metadata

4. Push the migration:
   ```bash
   SUPABASE_ACCESS_TOKEN=sbp_... supabase db push \
     --workdir /Users/mo/Code/life-organizer --yes
   ```

5. Verify:
   ```sql
   SELECT id, email FROM auth.users;
   ```

The UUID chosen here is **permanent** — it becomes the user's identity across all RLS
policies. All data rows they create will carry this UUID in their `user_id` column.
Do not change it after creation.

---

## Why Pre-insert?

Supabase Auth would normally create a new UUID on first sign-in. For a single-user
app with existing data, this would produce a mismatch: all existing rows carry a
specific UUID, but a freshly created session would carry a different one, breaking
every RLS policy.

Pre-inserting with a known UUID (and `email_confirmed_at: now()`) means:
- The UUID is chosen before any data exists, so it can be used as the stable identity.
- The magic link works immediately after insertion — no email confirmation step.
- Sign-ups disabled ensures no new UUIDs are created outside of this process.

---

## Security Model

| Mechanism | Role |
|---|---|
| Sign-ups disabled | Prevents unknown emails from creating new `auth.users` rows |
| Magic link OTP | No password to leak; token is single-use and short-lived |
| RLS on all tables | Unknown or wrong-UUID users see zero data even with a valid session |
| Resend SMTP | Routes auth email through a reliable provider; avoids Supabase rate cap |
