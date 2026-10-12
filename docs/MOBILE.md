# The Orbique phone app

Orbique also comes as an app for Android phones and iPhones. This guide is written first for the owner: what the app
is, how to install the test version, how to connect it to the live site, and what is needed for TestFlight and Google
Play. The last part is for developers.

Screens and button names on GitHub, Apple's and Google's sites change from time to time. Where this guide names a
button, look for the closest match.

---

## What the phone app is

- It is the **same Orbique app** you use in the browser: the same sign-in, the same workspace and every section
  (bookings, calendar, inbox, tasks, invoices, reports and the rest). It shows the same data as the website because it
  talks to the same live site and database.
- A few things work the way a phone app should:
  - Downloads (PDFs, CSV files, photos) open the phone's share sheet, so you can save them to Files or Drive or send
    them on WhatsApp.
  - **Read aloud** uses the phone's own voice.
  - Links to other websites open inside the app; phone numbers, email addresses and WhatsApp links open the right app.
  - The Android back button closes the open window or menu first, then goes back through the pages.
  - Taking a photo (receipts, task photos) opens the phone's camera. Choosing a photo opens the photo picker.
  - Voice notes in the inbox use the microphone; the phone asks for permission the first time.
- **Guests do not install anything.** The guest app stays a web link (`/guest/<token>`) that you send to the guest.
  Guest links and staff invite links made in the phone app point to the live site, so they work for everyone.
- Today: Android test builds are made automatically. The iPhone app needs an Apple Developer account first. Neither
  is in the App Store or Google Play yet.

---

## Install the Android test build

The newest test build is always at this address (bookmark it on the phone):

**https://github.com/arnobmridha90/orbique-pms/releases/download/android-test/Orbique-test.apk**

**Only install Orbique from this address**, never from a file someone sends you (by WhatsApp, email or any other
way).

1. Open the address on the Android phone (in Chrome or another browser). The file `Orbique-test.apk` downloads.
   If the browser warns that this type of file can harm your device, choose **Download anyway**.
2. Open the downloaded file (from the notification or the Downloads app).
3. The first time, Android says your browser is not allowed to install unknown apps. Tap **Settings**, turn on
   **Allow from this source**, go back and tap **Install**.
4. Google Play Protect may say it does not recognise the app. Choose **More details** then **Install anyway**. This is
   expected for a test build that does not come from Google Play.
5. Open **Orbique** from the home screen and sign in as usual.

**Updating:** open the same address again and install. A new test build installs over the old one and keeps you
signed in, as long as both were signed with the same key (a digital signature that tells Android the update comes
from the same place). If the phone says the app was not installed, for example because it "conflicts with an existing
package", the key has changed: uninstall Orbique, install the new build and sign in again. The release page says so
in bold when a build needs this. To stop it happening, see "Same key for every test build" below.

**Which build is this?** The release page
https://github.com/arnobmridha90/orbique-pms/releases/tag/android-test shows the commit, the build number, the date,
the site the build connects to and whether it installs over the old test app.

Good to know: the repository is public, so anyone with the address can download the test app. It contains no
secrets (only the site address and the public database key that the website also shows to every visitor), and nobody
can see data without signing in. It may show features you have not announced yet.

---

## Connect the app to the live site

Until a site address is set, the app is a **local test copy**: it opens with demo data that stays on that phone only,
and it does not sign in to real workspaces. The release notes then say "Connects to: nothing, this is a local test
copy".

To connect it, give the build the address of the live Orbique website (for example `https://app.orbique.my`, starting
with `https://`). Use **one** of these:

- **Repository variable (no code):** on GitHub open the repository, then **Settings**, **Secrets and variables**,
  **Actions**, the **Variables** tab, **New repository variable**. Name: `ORBIQUE_SITE_URL`. Value: the address.
  This takes priority over the file below.
- **In the code:** put the address in `config/mobile.json`: `{ "siteUrl": "https://app.orbique.my" }`.

The site must already be live and set up (see `docs/DEPLOY.md`): the build reads the database settings from the site
and stops with "Could not read .../config.js" if the site cannot be reached.

**Each change to the app that reaches `main` rebuilds it** and replaces the test build at the address above once the
automatic checks pass (allow 10 to 20 minutes). Changing only the repository variable does not start a build. To build
again without a code change:

1. On GitHub open the repository and the **Actions** tab.
2. In the list on the left, choose **Phone app**.
3. Click **Run workflow**, keep the branch on **main** and click the green **Run workflow** button.

Only builds from `main` replace the download link (and go to TestFlight, once that is set up). Builds for pull
requests (proposed changes) and builds from other branches never do.

If the site address changes later (for example a new domain), update it here and build again. Phones keep using the
old address until they install the new build.

---

## Same key for every test build

Android only installs a new version over the old one when both are signed with the same key. Set this up once, so
testers can update by simply installing the new build:

1. Make up a long phrase that only you know, at least 16 characters (for example five or six unrelated words). Save
   it in your password manager.
2. On GitHub open the repository, then **Settings**, **Secrets and variables**, **Actions**, the **Secrets** tab,
   **New repository secret**.
3. Name: `ANDROID_TEST_KEY_SEED`. Value: the phrase. Click **Add secret**.
4. Start a new build: **Actions**, **Phone app**, **Run workflow**, branch **main**, then the green **Run workflow**
   button.
5. Ask testers to uninstall the Orbique test app once and install the new build. From then on, each new build
   installs over the old one.

**Keep the phrase private and never paste it anywhere else:** not in a message, an email, a GitHub issue or the code.
Anyone who has it could make a fake Orbique test app that phones accept as an update. GitHub keeps the secret hidden,
also from people who propose changes from their own copy of the repository.

- If you change the phrase, the key changes too, and testers uninstall once more.
- If the phrase is shorter than 16 characters, the Android build stops with an error.
- Without the secret (or the developer alternative in "The test signing key" below), every build gets a new one-off
  key, so testers must uninstall the old test app before each update. The release page and the build summary say so whenever that happens.
- Uninstalling signs the tester out. When the app is connected to the live site nothing is lost: they sign in again.
  In a local test copy, the demo data on that phone is deleted.

---

## iPhone testing with TestFlight

**This path is untested until the Apple Developer account exists.** The build steps are ready in the workflow; the
first real upload may need small fixes.

TestFlight is Apple's way to share an app with testers before it is in the App Store. You need:

- An **Apple Developer Program** membership: US$99 a year (or the local equivalent). Enrol as an **organisation** so
  the app is published under Orbique's name. Apple then needs Orbique's **D-U-N-S number** (a free company ID from Dun
  & Bradstreet), and checking it can take several days.

Once the membership is active:

1. **Register the app ID.** On developer.apple.com open **Certificates, Identifiers & Profiles**, then
   **Identifiers**, the **+** button, **App IDs**, **App**. Description: `Orbique`. Bundle ID: **Explicit**,
   `com.orbique.app`. No extra capabilities are needed. Click **Register**.
2. **Create the app in App Store Connect.** On appstoreconnect.apple.com open **Apps**, the **+** button, **New App**.
   Platform iOS, name `Orbique` (the name must be free on the App Store; if it is taken, choose another store name,
   the name under the icon stays "Orbique"), primary language English, bundle ID `com.orbique.app`, SKU `orbique-ios`
   (any text), user access **Full Access**.
3. **Create an API key** so GitHub can upload builds. In App Store Connect open **Users and Access**, the
   **Integrations** tab, **App Store Connect API**, **Team Keys** (the first time, click **Request Access** and
   accept). Click **Generate API Key**, name it `GitHub Actions`, access **Admin** (Xcode needs this to create the
   signing certificate and profile by itself). Download the `.p8` file: Apple lets you download it **only once**.
   Note the **Key ID** next to the key and the **Issuer ID** above the list.
4. **Find the Team ID**: on developer.apple.com open **Account**, **Membership details**. It is 10 letters and digits.
5. **Add four repository secrets** on GitHub: **Settings**, **Secrets and variables**, **Actions**, the **Secrets**
   tab, **New repository secret**:

   | Secret | Value |
   |---|---|
   | `APP_STORE_CONNECT_KEY_ID` | the Key ID |
   | `APP_STORE_CONNECT_ISSUER_ID` | the Issuer ID |
   | `APP_STORE_CONNECT_KEY_P8_BASE64` | the `.p8` file in base64 (see below; pasting the file's text as it is also works) |
   | `APPLE_TEAM_ID` | the Team ID |

   Base64 turns the file into plain text that fits in a secret. Open **Terminal** (Mac) or **PowerShell** (Windows),
   go to the folder that holds the file (usually Downloads) and run the line for your computer. `XXXXXXXXXX` is the
   Key ID, which is part of the file name. The text is then copied, ready to paste as the secret's value.

   - Mac: `cd ~/Downloads`, then `base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy`
   - Windows (PowerShell): `cd ~\Downloads`, then
     `[Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path .\AuthKey_XXXXXXXXXX.p8))) | Set-Clipboard`

6. **Start a build on `main`.** Either push a change to `main`, or start one by hand: **Actions**, **Phone app**,
   **Run workflow**, branch **main**, then the green **Run workflow** button. The iPhone job then builds the app and
   sends it to TestFlight. Apple takes from a few minutes to an hour to process it. The app already tells Apple it
   uses only standard encryption, so there is no export question to answer.
7. **Add testers** in App Store Connect under the app's **TestFlight** tab. Internal testers (people on your App Store
   Connect team, up to 100) can test straight away. External testers (anyone, by email or a public link) need a short
   Apple review of the first build. Testers install the free **TestFlight** app from the App Store and accept the
   invitation.

Every iPhone build has version 0.5.0 and its own build number, which is never used twice: run 57 of the workflow gives
build 5701, running that same run again gives 5702, and run 58 gives 5801.

If the first upload fails, the usual causes are: the app record or bundle ID in App Store Connect does not match
`com.orbique.app`; the API key does not have the Admin role; an agreement is waiting to be accepted in App Store
Connect (look for a banner on the home page); or Apple refused a new signing certificate because the account already
has too many (revoke unused ones under Certificates, Identifiers & Profiles).

---

## Google Play

1. **Create a Google Play developer account** at play.google.com/console: US$25, paid once. Choose an
   **organisation** account so the app is published under Orbique's name. Google needs Orbique's **D-U-N-S number**
   for this too, and getting one can take days. (A personal account is quicker, but it publishes under a person's
   name, and at the time of writing new personal accounts must run a closed test with at least 12 testers for 14 days
   before they can publish to everyone.)
2. **Create an upload key** once. This is the key that proves to Google that an upload comes from you. It uses the
   `keytool` program that comes with Android Studio, so install Android Studio first. Open **PowerShell** (Windows) or
   **Terminal** (Mac) and paste the line for your computer. Each is one line:

   Windows (PowerShell):

   ```powershell
   & "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -genkeypair -v -keystore orbique-upload.keystore -storetype PKCS12 -alias orbique-upload -keyalg RSA -keysize 2048 -validity 10000
   ```

   Mac (Terminal):

   ```bash
   "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool" -genkeypair -v -keystore orbique-upload.keystore -storetype PKCS12 -alias orbique-upload -keyalg RSA -keysize 2048 -validity 10000
   ```

   The file `orbique-upload.keystore` is written to the current folder, the one the window is open in (normally your
   user folder). If the path is not found, Android Studio is installed in a different folder: use that one instead.
   It asks for a password, then your name, company and country; type `yes` at the end to confirm. Use the **same
   password** if it asks for a key password too. Keep the file and the password in a password manager. **Never put
   the file in the repository: the repository is public.** If the key is ever lost, Google can replace it, but that
   takes a request to Google support.
3. **Add four repository secrets** (same place as above):

   | Secret | Value |
   |---|---|
   | `ANDROID_KEYSTORE_BASE64` | the file in base64 (see below) |
   | `ANDROID_KEYSTORE_PASSWORD` | the password |
   | `ANDROID_KEY_ALIAS` | `orbique-upload` |
   | `ANDROID_KEY_PASSWORD` | the same password |

   To get the base64 text, run the line for your computer in the same window (the folder that holds the file). On
   Windows and Mac the text is then copied, ready to paste; on Linux it is printed.

   - Windows (PowerShell):
     `[Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path .\orbique-upload.keystore))) | Set-Clipboard`
   - Mac: `base64 -i orbique-upload.keystore | pbcopy`
   - Linux: `base64 -w0 orbique-upload.keystore`

4. From the next build on, each run also makes a **Google Play bundle**: open **Actions**, **Phone app**, the run, and
   download **orbique-android-play-bundle** under **Artifacts** (a zip with `Orbique-0.5.0-<build>.aab` inside).
5. **The first upload is done by hand.** In Play Console: **Create app** (name Orbique, app, free), then **Test and
   release**, **Testing**, **Internal testing**, **Create new release**. When asked about app signing, let Google
   manage the app signing key (recommended). Upload the `.aab`, save, review and **Start rollout**. Add testers'
   email addresses on the **Testers** tab and send them the opt-in link.
6. Before the app can go beyond testing, Play Console asks for the store listing, a privacy policy address, the
   content rating, the target audience and the **Data safety** form (Orbique stores names and contact details, photos
   such as guest IDs and receipts, and uses the microphone for voice notes).

Later bundles have a higher version code (the build number above) each time, so upload the newest one. Automatic
uploads to Play can be added later (it needs a Google Cloud service account).

The Play version and the test build share the same app ID but not the same signing key, so a phone cannot have both:
uninstall the test build before installing from Play.

---

## Before the first store upload: confirm the app ID

The app ID is **`com.orbique.app`** on both Android and iPhone. Once a build is uploaded to Google Play or App Store
Connect, that ID can **never change**: a different ID is a different app, with no installs, ratings or reviews carried
over. It is normally a domain Orbique owns, written backwards (orbique.app becomes `com.orbique.app`). Please confirm
it before the first upload.

Changing it is a developer job. Replace `com.orbique.app` with the new ID in each of these places, then run
`npm run mobile:sync`:

1. `capacitor.config.json`: `appId`.
2. `android/app/build.gradle`: `namespace` and `applicationId`.
3. `android/app/src/main/java/com/orbique/app/MainActivity.java`: the `package` line. Also move the file to the folder
   that matches the new ID (for `com.example.app`, `android/app/src/main/java/com/example/app/`).
4. `android/app/src/main/res/values/strings.xml`: `package_name` and `custom_url_scheme`.
5. `ios/App/App.xcodeproj/project.pbxproj`: `PRODUCT_BUNDLE_IDENTIFIER` (twice: the Debug and the Release settings).
6. Use the new ID in the TestFlight steps above (the app ID on developer.apple.com and the bundle ID in App Store
   Connect).

The workflow reads the ID from `capacitor.config.json`, so `.github/workflows/mobile.yml` needs no change. The copies
of `capacitor.config.json` under `android/app/src/main/assets/` and `ios/App/App/` are written by `npm run mobile:sync`.

---

## Store review notes

- **No buying inside the iPhone app.** Operators subscribe to Orbique outside the app. Apple allows that for apps sold
  directly to businesses for their staff (App Review Guideline 3.1.3(c), "Enterprise Services"), but the app must not
  sell plans, show prices for plans, or link or point to a page where people can buy one. The sign-in screen's
  **Request access** form is fine as long as it only asks to be contacted. Keep the Android app the same way: it is
  simpler and avoids Google Play's billing rules.
- **Account deletion.** Apple asks apps that create accounts to let people delete their account from inside the app.
  Here staff accounts are created by the workspace owner, not by the app, but plan a "Delete my account" request
  (for example in the profile menu, sending a request to Orbique) before the App Store submission. Google Play also
  asks for an account deletion link in the Data safety form.
- **A demo sign-in for the reviewers.** Apple and Google reviewers must be able to sign in. Prepare a test workspace
  with sample data and give its email and password in the review notes.
- **More than a website.** Apple sometimes rejects apps that are only a website in a frame (guideline 4.2). Orbique's
  screens are inside the app and it uses phone features (camera, share sheet, voice, microphone); say so in the review
  notes.
- **Privacy.** Both stores need a privacy policy address. Apple also asks for the "App Privacy" answers in App Store
  Connect.
- **Push notifications are a later phase.** The app does not send notifications yet.

---

## For developers

### Build and run locally

Needs Node.js 22 or newer (Capacitor 8), plus Android Studio for Android, and a Mac with **Xcode 26 or newer** for
iPhone.

```bash
npm install
npm run mobile:sync      # node scripts/build.mjs --mobile, then npx cap sync (both platforms)
npx cap open android     # Android Studio: open the android/ folder
npx cap open ios         # Xcode: ios/App/App.xcodeproj (Swift Package Manager, no CocoaPods, no .xcworkspace)
```

Run on a device or emulator from Android Studio or Xcode, or with `npx cap run android` / `npx cap run ios`. Run
`npm run mobile:sync` again after any change in `app/` or to the plugins; `npm run mobile:build` only rebuilds
`mobile/www`.

- `mobile/www` is git-ignored. `scripts/build.mjs --mobile` writes `index.html` (the same page as the website plus
  `app/native/bridge.js`), Capacitor's runtime and plugins as plain scripts in `vendor/`, and `config.js`
  (`native: true`, `apiBase` and `appUrl` set to the site address).
- The site address comes from the environment variable `ORBIQUE_SITE_URL` or `config/mobile.json` (`siteUrl`), for
  example `ORBIQUE_SITE_URL=https://app.orbique.my npm run mobile:sync`. The build reads the public Supabase URL and
  key from that site's `/config.js` (or from `SUPABASE_URL` and `SUPABASE_ANON_KEY`), fails loudly if the site is set
  but unreachable, and refuses a service-role key. With no address the app is a local test copy.
- App settings (app ID, splash screen, status bar) are in `capacitor.config.json`.
- Android build types (`android/app/build.gradle`), run from `android/`:
  - `debug`: debuggable, with WebView inspection (`chrome://inspect`). `./gradlew assembleDebug`; this is also what
    Android Studio and `npx cap run android` build by default.
  - `beta`: the APK that CI publishes. It is the release build (`initWith release`), not debuggable and so without
    WebView inspection, signed with the keystore named by `ORBIQUE_TEST_KEYSTORE` (CI sets it to the test key), or
    with the debug key when that is not set.
    `./gradlew assembleBeta` writes `app/build/outputs/apk/beta/app-beta.apk`.
  - `release`: the Google Play bundle, `./gradlew bundleRelease` (see "Release signing" below).

### How the app works

- The screens ship inside the app. Data comes from Supabase and from `/api` on the live site, exactly as in the
  browser. Android serves the files from `https://localhost`, iOS from `capacitor://localhost`.
- `app/native/bridge.js` is loaded after `app/server/*.js` and before `O.boot()`, and does nothing in a normal browser
  (it checks `Capacitor.isNativePlatform()`). It replaces `O.download` (file written to the app cache with the
  Filesystem plugin, then the Share plugin), `O.voice` (the Text-to-Speech plugin), `window.open` and clicks on links to
  other sites (the Browser plugin; `tel:`, `mailto:`, `sms:`, `geo:` and WhatsApp go to the phone), the Android back
  button (App plugin), the status and navigation bar icon colours (SystemBars, following the colour under each bar; on Android phones
  whose System WebView is older than 140 the app sits below the bars over a fixed light background, so dark icons), hides
  the splash screen after the first screen is drawn, catches the clock up when the app comes back to the front, and
  sets `O.APP_URL` from `config.appUrl` so guest and invite links point at the live site.
  `tests/native_sim.py` checks it in Chromium with a simulated native side (see its notes).
- **Cross-origin calls:** `api/_lib/http.js` (`cors()`) answers the app origins `https://localhost` and
  `capacitor://localhost`. Sign-in travels as a bearer token, never a cookie. If the app's origin ever changes (for
  example `server.hostname` or `server.androidScheme` in `capacitor.config.json`), add the new origin there.
- **Page console on Android:** Capacitor forwards the page console to logcat (tag `Capacitor/Console`) only in
  debuggable builds by default. The workflow sets `android.loggingBehavior` to `production` in the synced copy
  (`android/app/src/main/assets/capacitor.config.json`) just before building the `beta` test APK, so the emulator check
  can see page errors, and removes it again before the Google Play bundle. `capacitor.config.json` itself leaves it out,
  so local and Play builds keep the default.
- **Phone permissions:**
  - Android (`android/app/src/main/AndroidManifest.xml`): `INTERNET`; `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS` for
    inbox voice notes (Capacitor asks for both when the page calls `getUserMedia` and refuses if either is missing),
    with the microphone marked as not required so Play still lists the app on devices without one; a `<queries>`
    entry for `android.media.action.IMAGE_CAPTURE`. There is deliberately **no `CAMERA` permission**:
    `<input type="file" capture>` hands over to the phone's camera app, and Capacitor's `BridgeWebChromeClient` only
    asks for `CAMERA` when the manifest declares it (declaring it would add a permission prompt and Android would then
    refuse the camera app until it was granted). Without the query, Android 11 and later hide the camera app from
    `resolveActivity()` and the app falls back to the file picker. Plain `<input type="file">` uses the system picker
    and needs nothing.
  - iPhone (`ios/App/App/Info.plist`): `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`,
    `NSPhotoLibraryAddUsageDescription` (Save Image from the share sheet) and `NSMicrophoneUsageDescription`; iOS
    closes an app that uses one of these without its sentence. `ITSAppUsesNonExemptEncryption` is false.
  - A new feature that uses another phone capability (location, contacts, notifications) needs its entry in both files.
- **Versions:** the version people see (`versionName`, `MARKETING_VERSION`) is `ORBIQUE_VERSION_NAME` at the top of
  `.github/workflows/mobile.yml` (0.5.0). The build number is `run_number x 100 + run_attempt` of the "Phone app"
  workflow (run 57 is 5701, its re-run 5702, run 58 is 5801), so a re-run never repeats a number a store has already
  seen. It is the Android `versionCode` (`ORBIQUE_VERSION_CODE`, used for both the test APK and the Play bundle) and
  the iOS `CURRENT_PROJECT_VERSION`. Renaming the workflow file restarts the run number at 1, and the stores expect
  each new build number to be higher than the last, so keep the file name. Local builds default to version code 1.
  Android reads `ORBIQUE_VERSION_CODE` and `ORBIQUE_VERSION_NAME` from the environment (`android/app/build.gradle`).
- **Release signing:** `android/app/build.gradle` signs the release build only when `ORBIQUE_KEYSTORE_FILE` (a full
  path), `ORBIQUE_KEYSTORE_PASSWORD`, `ORBIQUE_KEY_ALIAS` and `ORBIQUE_KEY_PASSWORD` are all set; otherwise the
  release build is unsigned. Locally: export them, then `cd android && ./gradlew bundleRelease`.
- **Icons and splash screens:** edit `public/icons/icon.svg`, run `python3 scripts/mobile-assets.py` (its notes list
  every file it writes), and commit the changed files under `android/` and `ios/`.

### CI: the "Phone app" workflow

`.github/workflows/mobile.yml` runs on pushes to `main` and on pull requests that touch the app, the native projects,
the API, the build or the workflow, and by hand with **Run workflow** (on any branch). Each secret it uses is
optional: steps that need a missing secret are skipped.

**Publishing:** only runs on `main` publish, whether a push or **Run workflow** started them. The APK goes to the
`android-test` pre-release after the emulator check passes, and the iPhone build goes to TestFlight when the Apple
secrets are set. Pull requests and other branches never publish. To publish again without a new commit (for example
after changing `ORBIQUE_SITE_URL`), use **Run workflow** on `main`. Re-running an old run instead rebuilds that run's
commit, which may be older than `main`; it is not published if the test build already has a newer commit.

One run per branch at a time: a new pull request run cancels the older one. On `main` a new run waits for the running
one, and a run that is still waiting is replaced by a newer one, so the newest commit is published last. A commit that
changes nothing the app is built from (for example only docs or database migrations) starts no run and does not stop
the run before it from publishing.

| Job | What it does | Output (Actions, the run, Artifacts) |
|---|---|---|
| Android build | Node 22, `npm ci`; the build number and the app ID (read from `capacitor.config.json` and passed to the emulator check); Java 21; the runner's Android SDK (`ANDROID_HOME`, written to `android/local.properties`); `npm run mobile:build` (prints the site address the app connects to); `npx cap sync android`; the test signing key (below); `./gradlew assembleBeta`; checks the APK's signer matches the test key; `bundleRelease` when the four upload key secrets exist (and checks the bundle is signed) | `orbique-android-test` (`Orbique-test.apk`), `orbique-android-play-bundle` |
| Android emulator check | Boots an Android 15 emulator (API 35, x86_64, KVM), installs the APK, launches `<app ID>/.MainActivity`, screenshots at 15 and 30 seconds. Fails if the app is not running at 30 seconds, if logcat has a crash or "not responding" for the app, or if the page logged any error (Capacitor forwards the page console to logcat with the tag `Capacitor/Console`; errors and uncaught exceptions are level E; see "Page console on Android" above) | `orbique-android-smoke` (screenshots, `logcat.txt`, `crash.txt`) |
| Publish the Android test build | On `main` only (a push or **Run workflow**, never a pull request), after both jobs above pass: moves the tag `android-test` to the commit, writes the release notes (commit, build number, date, site address, build log, and whether the build installs over the old one or testers must uninstall first) and replaces `Orbique-test.apk` on that pre-release (only this job may write to the repository; it cannot replace the file if "immutable releases" is turned on in the repository settings) | https://github.com/arnobmridha90/orbique-pms/releases/tag/android-test |
| iPhone build | Picks the newest Xcode on `macos-latest`, stops early if it is older than Capacitor needs (read from `node_modules/@capacitor/ios`: Xcode 26, iOS 15), builds for the simulator without signing; on `main` (a push or **Run workflow**) with the four Apple secrets, archives and uploads to TestFlight | `orbique-ios-simulator` (unzip and drag `App.app` onto a running iOS Simulator) |

Settings it reads: the repository variable `ORBIQUE_SITE_URL`, and the secrets `ANDROID_TEST_KEY_SEED`,
`ANDROID_DEBUG_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY_P8_BASE64`,
`APPLE_TEAM_ID`.

### The test signing key

Every published test APK must be signed with the same key, or it will not install over the previous one. The key
never sits in the repository, a release or the Actions cache (in a public repository, pull requests from forks can
read the cache). It comes only from a secret, and GitHub does not give secrets to pull requests from forks. The step
"Test signing key" writes it to `~/.android/debug.keystore`, and the build passes that path to the `beta` build type
as `ORBIQUE_TEST_KEYSTORE`. It uses the first of these that is set:

1. `ANDROID_TEST_KEY_SEED` (recommended; the owner steps are in "Same key for every test build" above): a phrase of
   at least 16 characters (leading and trailing spaces are ignored; a shorter phrase fails the run).
   `scripts/android-test-key.py` stretches it with scrypt into a P-256 key and writes a certificate with fixed names,
   serial number and dates and a deterministic (RFC 6979) ECDSA signature, so the certificate, and with it the
   signature Android compares, is the same on every run. The workflow installs the Python packages it needs in a
   virtual environment from `scripts/android-test-key.requirements.txt`, pinned to exact versions and file hashes.
   This one wins when both secrets are set (the run shows a notice).
2. `ANDROID_DEBUG_KEYSTORE_BASE64`: a keystore in base64, with alias `androiddebugkey` and store and key password
   `android`. The run fails if the keystore cannot be opened with those.
3. Neither: a one-off RSA key for this run only. The run shows a warning, and the run summary and the release notes
   tell testers to uninstall the old test app first.

Changing the phrase or the keystore, or switching from one secret to the other, changes the key: testers uninstall
once.

To use a keystore instead of a phrase, create one with the standard alias and password and add it as the secret:

```bash
keytool -genkeypair -keystore debug.keystore -storetype PKCS12 -storepass android -keypass android -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10950 -dname "CN=Android Debug,O=Android,C=US"
base64 -w0 debug.keystore        # macOS: base64 -i debug.keystore
```

Never commit a keystore: the repository is public.

### Not done yet

Push notifications, automatic Google Play uploads, opening guest or invite links in the app instead of the browser,
and working offline.
