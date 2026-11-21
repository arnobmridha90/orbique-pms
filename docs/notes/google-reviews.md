# Google reviews on the Reviews page

Google Business Profile reviews show up on the Reviews page next to Airbnb, Booking.com and the other sites, and the
team can reply to them there (web and phone app). New reviews also post a line in the Inbox ("Google notifications").

## How it works

- Code: `api/_lib/google.js` (Google sign-in and API calls), `api/_lib/google-reviews.js` (records, sync, reply),
  actions `google-*` and the sign-in return (`GET /api/messages?code&state`) in `api/messages.js`, the 30-minute sync in
  `api/channex-worker.js`, the Google card on `app/pages/reviews.js`, migration `0029_google_reviews.sql`.
- Reviews are `reviews` records with id `RV-GG-...`, `gg` = Google's review name, `platform: 'google'`, `place` = the
  profile's name and `buildingId` = the building (a workspace with one building gets it on its own).
- The Google sign-in (refresh token) is kept in `google_tokens`, which only the server can read. It is never sent to
  the browser, logged or committed. `google_connections` holds the status members see.
- Google APIs used: Account Management v1 (accounts), Business Information v1 (locations), My Business v4
  (`accounts.locations.reviews.list` and `updateReply`). Scope: `https://www.googleapis.com/auth/business.manage`.
- Switched off until `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set in Vercel: the Google card does not show and
  the worker skips Google.

## What the account owner does, in order

1. **Google Cloud project.** At console.cloud.google.com, use the existing Orbique project (the one the phone app's
   push notifications use) or create one called "Orbique". Note its **project number** (Dashboard).
2. **Ask Google for API access.** Google gives the Business Profile API only to approved projects (a new project has a
   quota of 0). Fill in the GBP API contact form (developers.google.com/my-business/content/prereqs, "Application for
   Basic API Access") while signed in with a Google account that is an **owner or manager of the Kozi Business
   Profile**, with the project number and the website https://www.staykozi.my. Google says it answers within about
   14 days. Google also asks that the profile has been verified and active for more than 60 days (Kozi was verified
   on 28 Oct 2026, so 60 days is 27 Dec 2026); an earlier request may be turned down and can be sent again then.
3. **Turn on the APIs** (APIs & Services, Library): "My Business Account Management API", "My Business Business
   Information API" and "Google My Business API". Approval is visible under APIs & Services, Quotas: 0 requests a minute
   means not yet, 300 means approved.
4. **OAuth consent screen** (Google Auth Platform, Branding and Audience): app name Orbique, support email, the
   website and privacy page (https://orbique-pms.vercel.app/privacy). If Orbique Global uses Google Workspace and the
   profile's owner account is in it, choose **Internal** (no Google review needed). Otherwise choose External and press
   **Publish app**: in "Testing" Google stops the sign-in after 7 days. Data access: add the scope `.../auth/business.manage`.
5. **OAuth client** (Clients, Create client, Web application): Authorised redirect URI
   `https://orbique-pms.vercel.app/api/messages` (the live Orbique address followed by `/api/messages`; if `APP_URL` is
   set in Vercel, use that address instead). Copy the Client ID and Client secret.
6. **Vercel** (orbique-pms, Settings, Environment Variables, Production): `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
   Optional `GOOGLE_REDIRECT_URI` when the redirect address differs from the one above. Redeploy.
7. **Connect.** On a computer (Google does not allow its sign-in inside the phone app), open Orbique, Reviews, press
   **Connect Google** and sign in with the profile's owner account. With one profile it is chosen at once; otherwise
   pick "Kozi @ Vortex KLCC". Until Google approves step 2 the card says "Waiting for Google" and the reviews start by
   themselves once it does.

## Notes

- Replies are public on Google Maps and Search. Editing a reply replaces it.
- A reply deleted on Google disappears from the record on the next sync.
- Disconnecting also ends Orbique's access on Google's side; reviews already fetched stay.
- For other Orbique subscribers later: each workspace owner connects their own Google account the same way. With an
  External app and many outside users, Google may ask for app verification of the `business.manage` scope.
