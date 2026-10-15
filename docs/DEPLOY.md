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
| `CHANNEX_ORG_ALLOWLIST` | While testing: the workspace ids (comma separated) allowed to connect real channels. Every other workspace keeps the practice copy | The `id` column of the `orgs` table (Supabase dashboard → **Table Editor** → `orgs`) |

Redeploy after adding or changing them (step 5). Then open `https://<your-site>/api/health`: `"channex":true` means the
API key is set. It does not show the key, and it does not prove that the key works.

If the API key ever leaks, delete it in Channex, create a new one and update `CHANNEX_API_KEY` in Vercel.

For developers working without a Channex key: `node scripts/channex-mock.mjs` runs a stand-in Channex on your computer.
Start Orbique with `CHANNEX_BASE_URL=http://127.0.0.1:8899/api/v1` and any `CHANNEX_API_KEY`. The top of
`scripts/channex-mock.mjs` lists what it can do (including simulated rate limits and errors).

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
