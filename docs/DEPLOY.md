# Putting Orbique online

This guide takes you from the code on GitHub to a working Orbique website that you and your operators can use on a
computer and a phone. You do not need to write any code. Allow about 30 minutes.

You will use three services:

- **GitHub** holds the Orbique code (the `orbique-pms` repository).
- **Vercel** builds the code and runs the website.
- **Supabase** is the database and handles sign-in. You add it from inside Vercel, so you only manage one bill.

Screens and button names change from time to time. Where this guide is not sure of an exact name, it says what to look for.

---

## Before you start: plans and costs

- Vercel's free **Hobby** plan is for personal, non-commercial use. Orbique is a paid business, so move to Vercel **Pro**
  before real customers use it. You can start on Hobby while you test.
- Supabase's free plan pauses a project after about a week without activity and has small limits. Choose a paid
  Supabase plan before going live.
- Have ready: the email address you will use as the Orbique platform owner (it must be the one Orbique was set up for,
  see step 6), and a good password for it.

---

## 1. Create a Vercel account with GitHub

1. Go to **vercel.com** and click **Sign Up**.
2. Choose **Continue with GitHub** and sign in with the GitHub account that can see the `orbique-pms` repository.
3. Allow Vercel to access your GitHub account when asked. You can limit it to the `orbique-pms` repository only.

## 2. Import the Orbique repository

1. In Vercel, click **Add New…** then **Project**.
2. Under **Import Git Repository**, find **orbique-pms** and click **Import**. (If it is not listed, click the option to
   adjust GitHub app permissions and give Vercel access to the repository.)
3. On the configuration screen, leave everything as it is. The repository already tells Vercel what to do
   (`vercel.json`): framework preset "Other", build command `npm run build`, output folder `dist`.
4. Click **Deploy** and wait for it to finish (a minute or two).

This first version has no database yet, so it opens as a test copy with demo data. That is expected; the next step
connects the database.

## 3. Add Supabase from the Vercel Marketplace (region Singapore)

1. Open your new project in Vercel and go to the **Storage** tab.
2. Click **Create Database** (or **Connect Database**), choose **Supabase**, and click **Continue** / **Install**.
   You may be asked to accept Supabase's terms and choose a plan.
3. Give the database a name such as `orbique`, and pick the region **Singapore** (it may be shown as
   `ap-southeast-1` / Southeast Asia). Your users are in Malaysia and Orbique's server code also runs in Singapore, so this keeps it fast.
4. When asked which environments to connect, keep **Production**, **Preview** and **Development** ticked, and leave
   the environment variable prefix empty (no custom prefix).
5. Click **Create** / **Connect**. Supabase creates the database and Vercel adds the connection details to your project
   as environment variables automatically.

## 4. Check the environment variables

In Vercel, open the project's **Settings** then **Environment Variables**. You should see (names may appear in either
the older or the newer style; Orbique accepts both):

| What it is | Names you should see |
|---|---|
| Project address | `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL` |
| Public key (safe in the browser) | `SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, or the newer `SUPABASE_PUBLISHABLE_KEY` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| Secret key (server only) | `SUPABASE_SERVICE_ROLE_KEY`, or the newer `SUPABASE_SECRET_KEY` |
| Database connection | `POSTGRES_URL_NON_POOLING` and `POSTGRES_URL` (plus a few other `POSTGRES_*` entries Orbique does not need) |

Optional, only if you want it:

- `PLATFORM_OWNER_EMAILS`: the email address(es) allowed to set up Orbique (see step 6), separated by commas. Add it
  if your email is not already in the list built into the code.

Never copy the secret key anywhere else (chats, documents, the code). If it ever leaks, create a new one in Supabase
and update it in Vercel.

## 5. Redeploy

New environment variables only reach a new deployment.

1. Go to the **Deployments** tab, open the menu (**⋯**) on the latest deployment and choose **Redeploy**.
2. Wait for it to finish. During the build Orbique sets up its database tables. In the build log you should see lines
   starting with `migrate:` such as `applied 0001_core.sql`.

If the build fails at a `migrate:` line, the website keeps running the previous version. Send the build log to your
developer.

To check that everything is connected, open `https://<your-site>.vercel.app/api/health`. You should see
`"db":true` and, before step 6, `"needsBootstrap":true`.

## 6. Open the site and "Set up Orbique"

1. Open your site (the address is shown on the project's main page, for example `https://orbique-pms.vercel.app`).
2. Because no platform owner exists yet, the first screen offers **Set up Orbique**.
3. Enter the platform owner's **email**, your **name** and a **password** (at least 8 characters). The email must be one
   Orbique was set up for: either the address whose fingerprint is in `config/platform-owners.json`, or one listed in
   `PLATFORM_OWNER_EMAILS` (step 4). Any other email is refused.
4. Do this straight after the first deploy. Once a platform owner exists, this screen never appears again.

You can now sign in with that email and password. You are the Orbique platform admin.

## 7. Create the first operator workspace

1. In the platform admin area, choose to add an operator.
2. Enter the company name, the owner's name and the owner's email, and pick a plan.
3. Orbique creates the workspace and the owner's sign-in and shows a **temporary password** (it looks like
   `Mango-River-4821`). Send it to the owner (for example on WhatsApp) together with the site address.
4. The owner signs in, chooses a new password, and then picks whether to start empty or explore with demo data.

If the owner already has an Orbique sign-in (for example, you are the owner of your own unit-management company), they
are simply added as owner and keep their current password.

If an owner forgets their password, the platform admin area can give them a new temporary password.

## 8. Invite staff

The workspace owner does this, not the platform admin:

1. Open **Staff Access**, add the person (or pick an existing staff member) and choose **Invite**.
2. Enter their name, email, phone and role (ops manager, housekeeping, front desk, maintenance or accountant).
3. Orbique shows a temporary password. Share it with the person; they choose their own password at first sign-in.

If someone forgets their password, the owner can reset it from Staff Access. To stop someone's access straight away,
**suspend** them (a password reset alone does not sign them out of a phone that is already signed in).

## 9. Install Orbique on a phone

Open the site on the phone and sign in, then:

- **iPhone (Safari)**: tap the **Share** button, then **Add to Home Screen**, then **Add**.
- **Android (Chrome)**: tap the **⋮** menu, then **Install app** or **Add to Home screen**.

Orbique then opens full screen from its own icon, like an app. It needs an internet connection to load and save data;
without one it still opens and shows a message instead of a blank page.

## 10. The guest link

Every booking has its own guest link, like `https://<your-site>/guest/AbC123...`. In **Bookings** (or the **Guest App**
page) use **Copy guest link** and send it to the guest, for example on WhatsApp. The guest opens it in any browser
without signing in and sees their stay details, check-in instructions and door code. Treat the link like a key:
anyone who has it can see that booking's guest page.

---

## Supabase Auth settings to check

Open the Supabase dashboard from Vercel: **Storage** tab → your database → **Open in Supabase** (or sign in at
supabase.com). Then go to **Authentication**:

1. **Turn off public sign-ups.** Look for a setting named like **Allow new users to sign up** (under **Sign In /
   Providers**, in the "User Signups" section) and switch it **off**. Orbique creates every account itself through its
   server, which keeps working with sign-ups off; turning it off stops strangers from creating accounts directly.
2. **Leave "Confirm email" as it is.** Orbique creates accounts already confirmed and does not send emails.
3. **Site URL.** Under **URL Configuration**, set **Site URL** to your site's address (for example
   `https://orbique-pms.vercel.app`, or your own domain later).
4. **Password rules.** If you change the password requirements (in the Email provider settings), keep the minimum length
   at 12 or less: Orbique's temporary passwords are 12 characters or longer and contain capitals, small letters,
   digits and dashes.

## Your own domain (optional)

In Vercel, open the project's **Settings** then **Domains**, add your domain (for example `app.yourcompany.my`) and follow
the instructions to update your domain's DNS. Redeploy afterwards so guest links use the new address, and update the
Supabase **Site URL**.

## Channel manager (Channex) settings

Orbique sends prices and availability to Booking.com, Agoda, Airbnb, Expedia and Trip.com, and receives their bookings,
through **Channex** (channex.io). Without these settings Orbique never contacts Channex and nothing is sent anywhere, so
you can skip this section until you are ready to connect channels.

Add these in Vercel under **Settings** then **Environment Variables**, for **Production** and **Preview**. They are
read only by Orbique's server code; none of them is ever sent to the browser or shown in the app.

| Name | What it is | Where it comes from |
|---|---|---|
| `CHANNEX_API_KEY` | Orbique's Channex API key. Treat it like the Supabase secret key | Channex: your user profile → API keys. Staging and production have separate accounts and separate keys |
| `CHANNEX_BASE_URL` | Which Channex Orbique talks to. Leave it out to use staging, `https://staging.channex.io/api/v1` | Set `https://app.channex.io/api/v1` only after Channex has certified Orbique and given you a production key |
| `CHANNEX_APP_URL` | The address of Channex's channel screen. Leave it out: it is worked out from `CHANNEX_BASE_URL` | Only needed if Channex gives you your own address for that screen |
| `CHANNEX_WEBHOOK_SECRET` | The signing secret Channex uses for the messages it sends when a booking arrives. Orbique refuses messages without a correct signature | Channex: signing keys (the secret is shown once when the key is created) |
| `CHANNEX_WEBHOOK_TOKEN` | A long random password Channex sends with each message instead, only if signing keys are not available to you | Make one up (for example 40 random letters and digits) |
| `CHANNEX_WORKER_SECRET` | A long random password that lets the database's once-a-minute timer start Orbique's sending job | Make one up (for example 40 random letters and digits) |
| `CHANNEX_ORG_ALLOWLIST` | While testing: the workspace ids (comma separated) allowed to connect real channels. Every other workspace keeps the practice copy | The `id` column of the `orgs` table (Supabase dashboard → **Table Editor** → `orgs`) (on staging, an empty list lets no workspace connect; on production, every workspace) |
| `CHANNEX_SIGNING_KEY_ID` | The id of the Channex signing key whose secret is `CHANNEX_WEBHOOK_SECRET`, so the booking webhook is created signed | Channex: signing keys (the id next to the key) |

Redeploy after adding or changing them (step 5). Then open `https://<your-site>/api/health`: `"channex":true` means the
API key is set. It does not show the key, and it does not prove that the key works.

Then, signed in as an Orbique platform admin, use **Channel manager setup** (the `admin-setup` action of `/api/channex`)
once: it creates the booking webhook in Channex pointing at `APP_URL/api/channex-webhook` (`APP_URL`, else the Vercel
production address).

If the API key ever leaks, delete it in Channex, create a new one and update `CHANNEX_API_KEY` in Vercel.

For developers working without a Channex key: `node scripts/channex-mock.mjs` runs a stand-in Channex on your computer.
Start Orbique with `CHANNEX_BASE_URL=http://127.0.0.1:8899/api/v1` and any `CHANNEX_API_KEY`. The top of
`scripts/channex-mock.mjs` lists what it can do (including simulated rate limits and errors). `node scripts/dev.mjs --worker` also
runs the sending job every 20 seconds (needs `CHANNEX_WORKER_SECRET`), standing in for the database timer.

## Guest inbox: WhatsApp and translation

The Guest inbox collects every guest conversation in one place: WhatsApp messages to your business number, and messages
from Booking.com, Airbnb and Expedia through Channex. Guest messages can be shown in your language, and a reply can be
checked in the guest's language before it goes. Without these settings nothing changes: the inbox works as before and
nothing is sent to guests.

**WhatsApp** uses Meta's WhatsApp Business Platform (the Cloud API), not the WhatsApp Business phone app. You need:

1. A Meta Business account (business.facebook.com), verified for your company.
2. An app at developers.facebook.com of type **Business**, with the **WhatsApp** product added, linked to a WhatsApp
   Business account.
3. Your business number added to that WhatsApp Business account (WhatsApp, **API Setup**, **Add phone number**). A number
   that is still registered in the WhatsApp or WhatsApp Business phone app must be moved off it first, unless Meta offers
   your account the "coexistence" option that keeps both.
4. A permanent access token: Business settings, **Users**, **System users**, add an admin system user, give it the app and
   the WhatsApp account with full control, then **Generate new token** with the `whatsapp_business_messaging` and
   `whatsapp_business_management` permissions.
5. The webhook: in the app, WhatsApp, **Configuration**, callback URL `https://<your-site>/api/whatsapp-webhook`, verify
   token = the `WHATSAPP_VERIFY_TOKEN` below (add the Vercel variables and redeploy first, so the check succeeds), then
   **Manage** and subscribe to **messages**.

| Name | What it is | Where it comes from |
|---|---|---|
| `WHATSAPP_TOKEN` | The system user's permanent access token. Treat it like the Supabase secret key | Step 4 above |
| `WHATSAPP_APP_SECRET` | The app secret, which Meta uses to sign every webhook delivery. Orbique refuses deliveries without a correct signature | The app, **App settings**, **Basic**, **App secret** |
| `WHATSAPP_VERIFY_TOKEN` | A long random password Meta sends once when you set up the webhook | Make one up (for example 40 random letters and digits) |
| `WHATSAPP_GRAPH_VERSION` | Optional. The Graph API version, `v23.0` when left out | Only change it when Meta retires that version |

Redeploy, then in Orbique open the **Guest inbox**, **Settings** (bottom of the chat list) as the account owner, enter the
**Phone number ID** (WhatsApp, API Setup, under your number) and press **Connect WhatsApp**. Orbique checks the number with
Meta before saving it. From then on guests' WhatsApp messages land in the chat of their booking (matched by the phone
number on the booking); messages from numbers that match no booking wait at the top of the chat list to be linked.

WhatsApp only allows a free-form reply within 24 hours of the guest's last message to you. Outside that window the inbox
says so. Photos, files and voice notes from guests open in the inbox; sending
them to guests is not supported yet.

**Booking.com, Airbnb and Expedia messages** would need Channex's paid **Messages** app, which is not used: guests are
reached on WhatsApp. The code for it is in place but switched off (`CHANNEX_MESSAGES` in `api/messages.js`).

**Translation** uses Claude (Anthropic):

| Name | What it is | Where it comes from |
|---|---|---|
| `ANTHROPIC_API_KEY` | An API key for translations. Treat it like the Supabase secret key | console.anthropic.com, **API keys** |
| `ANTHROPIC_MODEL` | Optional. The model, `claude-haiku-5-5` when left out | Only change it if you want a different model |

`/api/health` then shows `"whatsapp":true` and `"translate":true` (that the settings are present, not that they work).
If a token or key ever leaks, revoke it where it came from, create a new one and update it in Vercel.

## Booking alerts: email, WhatsApp and the phone app

When a booking site (through Channex) or the guest website sends a new booking, a cancellation or new dates, Orbique
alerts the team. Bookings you or your team enter in Orbique send no alert. Choose who gets them in Orbique, **Automations**,
**Booking alerts**, **Edit**, then press **Send a test**. Each channel you have not set up is simply skipped.

| Name | What it is | Where it comes from |
|---|---|---|
| `RESEND_API_KEY` | Sends alert emails. Treat it like the Supabase secret key | resend.com, **API Keys**, **Create API key** (Sending access) |
| `ALERT_EMAIL_FROM` | Optional. The sender, for example `Orbique <alerts@yourdomain.com>`. Left out, Resend's test sender is used, which only delivers to the address you signed up to Resend with | A domain verified in Resend: **Domains**, **Add domain**, then add the DNS records it shows at your domain provider |
| `FIREBASE_SERVICE_ACCOUNT` | Sends phone app notifications: the whole service account key file (JSON, or the same base64-encoded). Treat it like the Supabase secret key | console.firebase.google.com, your project, **Project settings**, **Service accounts**, **Generate new private key** |
| `WHATSAPP_ALERT_TEMPLATE` | Optional. The approved WhatsApp message template for alerts, `booking_alert` when left out | See below |
| `WHATSAPP_ALERT_LANG` | Optional. That template's language code, `en` when left out | |

**Phone app:** the Android app is built with the Firebase project's `android/app/google-services.json` (package
`com.orbique.app`; the file is not secret, every copy of the app contains it). Install the new build, sign in as the owner
or an ops manager and allow notifications when asked (or press **Turn on alerts on this phone** on Automations).

**WhatsApp** needs the guest inbox's WhatsApp setup above (a connected number), plus a message template, because WhatsApp
only lets a business write first with an approved template. In WhatsApp Manager, **Message templates**, **Create
template**: category **Utility**, name `booking_alert`, language English, body

    Orbique: {{1}}
    {{2}}
    Open Orbique for the details.

(WhatsApp does not accept a template that starts or ends with a value.) Use samples such as `New booking · Airbnb` and `Ana, 2 guests · 2 Nov to 5 Nov (3 nights) · Vortex KLCC 43-6`. Alerts go
out by WhatsApp once Meta approves it.

## Booking-site messages, reviews and booking email

**Booking-site messages and reviews (Channex Messaging & Reviews).** Two-way chat with Booking.com, Airbnb and Expedia guests, their inquiries and requests, and their reviews (read and reply). Channex bills the app to the Channex account (about USD 0.50 per unit a month).
1. After a deploy that changes the webhook events, open Platform admin, Channel manager and press the setup button once, so Channex's webhook also sends messages, reviews and warnings.
2. The workspace owner opens Guest inbox, Settings, Booking sites and presses **Switch on messages and reviews**. That installs the app on every connected building and fetches the reviews and recent conversations already there.
Agoda and Trip.com do not offer messages through Channex; their emails come in through the booking email below.

**Booking email (Resend Inbound).** Every workspace gets its own Orbique address (shown in Guest inbox, Settings, Booking email). The operator forwards their booking mailbox (for example bookings@theircompany.com) to it. Guests' emails become chats that can be answered by email; the booking sites' emails (bookings, changes, payouts, reviews, account notices) become updates on the stay, or under Email & updates.
1. Resend, Domains, the sending domain (the one in ALERT_EMAIL_FROM): switch on **Receiving** and add the MX record Resend shows to the domain's DNS (on Vercel: Domains, the domain, DNS records). It must be the domain's only MX record, or the one with the lowest priority.
2. Resend, Webhooks, **Add webhook**: endpoint `https://<your site>/api/email-inbound`, event `email.received`. Copy its signing secret.
3. Vercel, Settings, Environment Variables (Production): `RESEND_WEBHOOK_SECRET` = that secret (starts with `whsec_`). The `RESEND_API_KEY` already used for alerts must have **Full access** (a sending-only key cannot read received emails). Optional: `INBOUND_EMAIL_DOMAIN` when receiving uses another domain than ALERT_EMAIL_FROM.
4. Redeploy. Send a test email to the workspace's address; it shows under Guest inbox, Email & updates.

**A workspace's own address (for example hello@staykozi.com).** Instead of forwarding, a workspace can receive its own
address straight into the inbox; email replies to guests then go out from that address.
1. Resend, Domains, **Add domain** (the workspace's domain): add every DNS record Resend shows (MX for receiving, the
   DKIM/SPF records for sending) and wait until Resend shows it verified, with **Receiving** switched on. The webhook
   above already covers every domain in the Resend account.
2. Orbique adds the address (Supabase, SQL Editor):
   `insert into public.inbound_addresses (address, org_id, kind) values ('hello@staykozi.com', '<the org id>', 'own');`
   The workspace keeps its Orbique address too, so booking sites already set up with it still work.

## Updating Orbique later

Every change merged into the main branch on GitHub deploys automatically. Database changes are applied during that
deploy. Changes on other branches create **preview** deployments with their own address; those do not change the
database.

## If something goes wrong

- **The site opens with demo data and no sign-in screen**: the database variables are missing from that deployment.
  Check step 4, then redeploy (step 5).
- **"Set up Orbique" refuses your email**: the email is not on the platform owner list. Add it to
  `PLATFORM_OWNER_EMAILS` in Vercel, redeploy, and try again.
- **"Orbique is already set up"**: a platform owner already exists. Sign in instead.
- **The platform owner lost their password**: in the Supabase dashboard open the **SQL Editor**, run
  `delete from public.platform_admins;` and then use **Set up Orbique** on the site again with the same email and a new
  password. This only removes the platform admin flag; no operator data is touched.
- **`/api/health` shows `"db":false`**: the secret key or project URL is missing or wrong in the environment variables.
