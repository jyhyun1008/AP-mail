# Misskey follow / remote-DM-acceptance caveat

This is the one piece of the deployment that can't be guaranteed correct from the
bridge's code alone — it depends entirely on your Misskey instance's own federation
policy, and has to be verified empirically after deploying.

## The concern

The bridge's bot actor (`@<BRIDGE_USERNAME>@<BRIDGE_DOMAIN>`) sends you a direct
`Create{Note}` the first time an email comes in, **without you ever having followed it
first**. Some ActivityPub servers (Misskey included, depending on version/settings)
treat notes from a remote actor nobody locally follows with more suspicion — anywhere
from "delivered fine" to "silently dropped" to "held for review" — as an anti-spam
measure.

## What to check, post-deploy

1. **Search for and follow the bot manually** from your Misskey account:
   search `@<BRIDGE_USERNAME>@<BRIDGE_DOMAIN>` in Misskey's UI, confirm it resolves as a
   remote user (this alone validates WebFinger + the actor document are correctly
   served), and follow it. The bridge auto-accepts `Follow` activities
   (`src/bridge/inbound-activity.ts`), so this should complete immediately.
2. Check your Misskey instance's settings for anything like "reject notes from remote
   users you don't follow" — this can be an instance-wide moderation setting (admin
   panel) as well as a per-account preference, depending on Misskey version.
3. Run the smoke test (`npm run smoke:send-note`, or send a real email to
   `<BRIDGE_USERNAME>@<BRIDGE_DOMAIN>`) and confirm the DM actually shows up in your
   Misskey notifications/DMs — this is the real test; steps 1–2 are just where to look
   if it doesn't.

## If DMs aren't arriving after following

- Check the bridge's logs for the delivery attempt (`deliverNoteToInbox` logs on
  failure) — a non-2xx from your Misskey instance's inbox means Misskey itself rejected
  it, and the response body usually says why.
- Confirm `ALLOWED_ACTOR_URI` in `.env` is exactly your account's AP actor URI (not your
  profile page URL) — Misskey's own "copy remote URL" style option on your profile, or
  resolving `acct:you@misskey.example.com` through WebFinger by hand, gives the right
  value.
- If your instance has a moderation queue for remote content, the note may be sitting
  there rather than being dropped outright.
