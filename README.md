vibe-coded monday.com clone

## Google Calendar

Time blocks are written to a dedicated **Tiistai** calendar in the user's Google account, and events
from calendars the user picks are shown on the front page. Everything runs in Next route handlers
(`src/app/api/calendar/**`, logic in `src/lib/calendar/*`); the browser never sees a Google token.
Connect / pick calendars / disconnect at `/settings/calendar`.

### Google Cloud setup

1. Create (or reuse) a Google Cloud project and enable the **Google Calendar API**.
2. OAuth consent screen: add the scopes below. **Publish the app ("In production")** — while the
   publishing status is *Testing*, refresh tokens expire after 7 days and the connection drops to
   "revoked". (These scopes are "sensitive", so a production app with other users needs Google's
   verification; for a single owner the unverified-app warning can be clicked through.)
3. Create an OAuth client of type *Web application* with the authorised redirect URI
   `https://<your-domain>/api/calendar/oauth/callback` (and `http://localhost:3000/api/calendar/oauth/callback` for dev).

Scopes requested (narrowest set that works):

| Scope | Used for |
| --- | --- |
| `openid`, `email` | account email shown in settings |
| `calendar.calendarlist.readonly` | listing the user's calendars to choose from |
| `calendar.events.readonly` | reading events (and watch channels) on chosen calendars |
| `calendar.app.created` | creating the Tiistai calendar and creating/editing/deleting its events; deleting it on disconnect |

### Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | yes | OAuth web client |
| `GOOGLE_OAUTH_REDIRECT_URL` | no | defaults to `<request origin>/api/calendar/oauth/callback`; set it in production so it matches the console exactly |
| `MAIL_ENCRYPTION_KEY` | yes | reused to encrypt the refresh token (32 bytes, base64) |
| `SUPABASE_SECRET_KEY` | yes | service-role client |
| `CALENDAR_WEBHOOK_URL` | no | public HTTPS base URL, e.g. `https://tiistai.example.com`; unset = no push notifications (events refresh when the front page asks) |
| `CRON_SECRET` | with webhook | bearer token for the renewal endpoint |

On Amplify these are set in the console and copied into `.env.production` by `amplify.yml`
(Amplify env vars are build-only otherwise).

### Live sync (push notifications)

When `CALENDAR_WEBHOOK_URL` is set, connecting creates a Google watch channel per synced calendar
pointing at `POST /api/calendar/webhook`. Google requires a **public HTTPS URL with a valid
certificate** (localhost will not work; use a tunnel for testing). Notifications are authenticated by
a per-channel token; the handler runs an incremental sync with stored sync tokens and refreshes the
current and next week.

Channels live at most 7 days, so they must be renewed. Amplify has no built-in cron: schedule a daily
call from an external scheduler (GitHub Actions `schedule`, EventBridge Scheduler, cron-job.org, ...):

```sh
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/calendar/cron/renew
```

It renews channels that expire within 24 hours for every connected account.
