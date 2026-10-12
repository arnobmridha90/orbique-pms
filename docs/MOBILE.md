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

1. Open the address on the Android phone (in Chrome or another browser). The file `Orbique-test.apk` downloads.
   If the browser warns that this type of file can harm your device, choose **Download anyway**.
2. Open the downloaded file (from the notification or the Downloads app).
3. The first time, Android says your browser is not allowed to install unknown apps. Tap **Settings**, turn on
   **Allow from this source**, go back and tap **Install**.
4. Google Play Protect may say it does not recognise the app. Choose **More details** then **Install anyway**. This is
   expected for a test build that does not come from Google Play.
5. Open **Orbique** from the home screen and sign in as usual.

**Updating:** open the same address again and install. A new test build installs over the old one and keeps you
signed in. If the phone says the app was not installed because it conflicts with an existing package, uninstall
Orbique once and install again (this only happens if the test signing key changed; see the developer notes).

**Which build is this?** The release page
https://github.com/arnobmridha90/orbique-pms/releases/tag/android-test shows the commit, the build number, the date
and the site the build connects to.

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

**Each push to `main` that changes the app rebuilds it** and replaces the test build at the address above after the
automatic checks pass (allow 10 to 20 minutes). Changing only the repository variable does not start a build. To
rebuild then, open the **Actions** tab, choose **Phone app**, open the newest run on `main` and click **Re-run all
jobs**. (The **Run workflow** button also builds the app, but only builds from `main` replace the download link.)

If the site address changes later (for example a new domain), update it here and rebuild. Phones keep using the old
address until they install the new build.

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

   To get the base64 text of the file: on a Mac, `base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy` copies it; on Windows
   (PowerShell), `[Convert]::ToBase64String([IO.File]::ReadAllBytes("AuthKey_XXXXXXXXXX.p8")) | Set-Clipboard`.

6. **Push to `main`.** The iPhone job then builds the app and sends it to TestFlight. Apple takes from a few minutes
   to an hour to process it. The app already tells Apple it uses only standard encryption, so there is no export
   question to answer.
7. **Add testers** in App Store Connect under the app's **TestFlight** tab. Internal testers (people on your App Store
   Connect team, up to 100) can test straight away. External testers (anyone, by email or a public link) need a short
   Apple review of the first build. Testers install the free **TestFlight** app from the App Store and accept the
   invitation.

Every iPhone build has version 0.5.0 and a build number that goes up by one with each run.

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
2. **Create an upload key** once, on a computer with Java (Android Studio includes it):

   ```bash
   keytool -genkeypair -v -keystore orbique-upload.keystore -storetype PKCS12 \
     -alias orbique-upload -keyalg RSA -keysize 2048 -validity 10000
   ```

   It asks for a password and your name and company. Use the **same password** if it asks for a key password too.
   Keep the file and the password in a password manager. **Never put the file in the repository: the repository is
   public.** If the key is ever lost, Google can replace it, but that takes a request to Google support.
3. **Add four repository secrets** (same place as above):

   | Secret | Value |
   |---|---|
   | `ANDROID_KEYSTORE_BASE64` | the file in base64: Mac `base64 -i orbique-upload.keystore \| pbcopy`, Linux `base64 -w0 orbique-upload.keystore`, Windows PowerShell as for the Apple key above |
   | `ANDROID_KEYSTORE_PASSWORD` | the password |
   | `ANDROID_KEY_ALIAS` | `orbique-upload` |
   | `ANDROID_KEY_PASSWORD` | the same password |

4. From the next build on, each run also makes a **Google Play bundle**: open **Actions**, **Phone app**, the run, and
   download **orbique-android-play-bundle** under **Artifacts** (a zip with `Orbique-0.5.0-<build>.aab` inside).
5. **The first upload is done by hand.** In Play Console: **Create app** (name Orbique, app, free), then **Test and
   release**, **Testing**, **Internal testing**, **Create new release**. When asked about app signing, let Google
   manage the app signing key (recommended). Upload the `.aab`, save, review and **Start rollout**. Add testers'
   email addresses on the **Testers** tab and send them the opt-in link.
6. Before the app can go beyond testing, Play Console asks for the store listing, a privacy policy address, the
   content rating, the target audience and the **Data safety** form (Orbique stores names and contact details, photos
   such as guest IDs and receipts, and uses the microphone for voice notes).

Later bundles have a higher version code each time, so upload the newest one. Automatic uploads to Play can be added
later (it needs a Google Cloud service account).

The Play version and the test build share the same app ID but not the same signing key, so a phone cannot have both:
uninstall the test build before installing from Play.

---

## Before the first store upload: confirm the app ID

The app ID is **`com.orbique.app`** on both Android and iPhone. Once a build is uploaded to Google Play or App Store
Connect, that ID can **never change**: a different ID is a different app, with no installs, ratings or reviews carried
over. It is normally a domain Orbique owns, written backwards (orbique.app becomes `com.orbique.app`). Please confirm
it before the first upload. Changing it later means editing `capacitor.config.json`, `android/app/build.gradle`
(`namespace`, `applicationId`), the Java folder `android/app/src/main/java/com/orbique/app`, and
`PRODUCT_BUNDLE_IDENTIFIER` in `ios/App/App.xcodeproj/project.pbxproj`.

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
- App settings (app ID, splash screen, status bar, keyboard) are in `capacitor.config.json`.

### How the app works

- The screens ship inside the app. Data comes from Supabase and from `/api` on the live site, exactly as in the
  browser. Android serves the files from `https://localhost`, iOS from `capacitor://localhost`.
- `app/native/bridge.js` is loaded after `app/server/*.js` and before `O.boot()`, and does nothing in a normal browser
  (it checks `Capacitor.isNativePlatform()`). It replaces `O.download` (file written to the app cache with the
  Filesystem plugin, then the Share plugin), `O.voice` (the Text-to-Speech plugin), `window.open` and clicks on links to
  other sites (the Browser plugin; `tel:`, `mailto:`, `sms:`, `geo:` and WhatsApp go to the phone), the Android back
  button (App plugin), the status bar icon colour (SystemBars, following the colour at the top of the screen), hides
  the splash screen after the first screen is drawn, catches the clock up when the app comes back to the front, and
  sets `O.APP_URL` from `config.appUrl` so guest and invite links point at the live site.
  `tests/native_sim.py` checks it in Chromium with a simulated native side (see its notes).
- **Cross-origin calls:** `api/_lib/http.js` (`cors()`) answers the app origins `https://localhost` and
  `capacitor://localhost`. Sign-in travels as a bearer token, never a cookie. If the app's origin ever changes (for
  example `server.hostname` or `server.androidScheme` in `capacitor.config.json`), add the new origin there.
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
  `.github/workflows/mobile.yml` (0.5.0). The version code and build number are the workflow's run number, which goes
  up by one with every run of "Phone app". Renaming the workflow file restarts that count, and Google Play refuses a
  version code it has already seen, so keep the file name. Local builds default to version code 1. Android reads
  `ORBIQUE_VERSION_CODE` and `ORBIQUE_VERSION_NAME` from the environment (`android/app/build.gradle`).
- **Release signing:** `android/app/build.gradle` signs the release build only when `ORBIQUE_KEYSTORE_FILE` (a full
  path), `ORBIQUE_KEYSTORE_PASSWORD`, `ORBIQUE_KEY_ALIAS` and `ORBIQUE_KEY_PASSWORD` are all set; otherwise the
  release build is unsigned. Locally: export them, then `cd android && ./gradlew bundleRelease`.
- **Icons and splash screens:** edit `public/icons/icon.svg`, run `python3 scripts/mobile-assets.py` (its notes list
  every file it writes), and commit the changed files under `android/` and `ios/`.

### CI: the "Phone app" workflow

`.github/workflows/mobile.yml` runs on pushes to `main` and on pull requests that touch the app, the native projects,
the API, the build or the workflow, and by hand from the Actions tab. Each secret it uses is optional: steps that need
a missing secret are skipped.

| Job | What it does | Output (Actions, the run, Artifacts) |
|---|---|---|
| Android build | Node 22, Java 21, the runner's Android SDK (`ANDROID_HOME`, written to `android/local.properties`), `npm run mobile:build`, `npx cap sync android`, `./gradlew assembleDebug`; checks the APK is signed with the stable debug key; `bundleRelease` when the four upload key secrets exist | `orbique-android-test` (`Orbique-test.apk`), `orbique-android-play-bundle` |
| Android emulator check | Boots an Android 15 emulator (x86_64, KVM), installs the APK, launches `com.orbique.app/.MainActivity`, screenshots at 15 and 30 seconds. Fails if the app is not running at 30 seconds, if logcat has a crash or "not responding" for the app, or if the page logged any error (Capacitor forwards the page console to logcat with the tag `Capacitor/Console`; errors and uncaught exceptions are level E) | `orbique-android-smoke` (screenshots, `logcat.txt`, `crash.txt`) |
| Publish the Android test build | Push to `main` only, after both jobs above pass: moves the tag `android-test` to the commit and replaces `Orbique-test.apk` on that pre-release (only this job may write to the repository; it cannot replace the file if "immutable releases" is turned on in the repository settings) | https://github.com/arnobmridha90/orbique-pms/releases/tag/android-test |
| iPhone build | Picks the newest Xcode on `macos-latest`, stops early if it is older than Capacitor needs (read from `node_modules/@capacitor/ios`: Xcode 26, iOS 15), builds for the simulator without signing; on push to `main` with the four Apple secrets, archives and uploads to TestFlight | `orbique-ios-simulator` (unzip and drag `App.app` onto a running iOS Simulator) |

Settings it reads: the repository variable `ORBIQUE_SITE_URL`, and the secrets `ANDROID_DEBUG_KEYSTORE_BASE64`,
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`,
`APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY_P8_BASE64`, `APPLE_TEAM_ID`.

**The debug signing key.** Test builds must be signed with the same key every time, or they will not install over each
other. The workflow uses the secret `ANDROID_DEBUG_KEYSTORE_BASE64` when it is set. Otherwise it keeps a key in the
Actions cache (made on the first run). GitHub drops a cache entry after 7 days without a build, and then a new key is
made (the run shows a notice) and testers must uninstall once. To make the key permanent, create one and add it as
the secret (testers uninstall once when you switch):

```bash
keytool -genkeypair -keystore debug.keystore -storetype PKCS12 -storepass android -keypass android \
  -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10950 -dname "CN=Android Debug,O=Android,C=US"
base64 -w0 debug.keystore        # macOS: base64 -i debug.keystore
```

It must keep the standard alias `androiddebugkey` and password `android`. Never commit a keystore: the repository is
public.

### Not done yet

Push notifications, automatic Google Play uploads, opening guest or invite links in the app instead of the browser,
and working offline.
