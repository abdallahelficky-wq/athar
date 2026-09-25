# محطة أثر (Athar Station) — Android wrapper for fuel-station workers

A thin Kotlin wrapper app for fuel-station workers on ordinary Android phones: a full-screen
WebView loading the Athar **employee mobile portal** (`mobile.html`, phone + PIN login), whose
station-shift tab asks the worker to photograph each pump meter and each expense receipt.

It is a separate app from the POS wrapper in `../android/` (Sunmi V2), built from the same shape
but with no printer. Both install side by side: this one is `com.athar.station`, the POS app is
`com.athar.pos`.

## What this app does

- Opens `https://www.atharerp.com/mobile.html` out of the box (editable from the settings screen,
  same as the POS app). `mobile.html` is the portal's real page entry — there is no router route
  for it — so it works on any static host, and it is the portal manifest's own `start_url`.
- **Makes the photo inputs work.** The worker screen captures photos with
  `<input type="file" accept="image/*" capture="environment">`, which does nothing inside a WebView
  unless the app implements `WebChromeClient.onShowFileChooser`. This app:
  - asks for the runtime `CAMERA` permission first (an app that declares `CAMERA` in its manifest
    cannot launch `ACTION_IMAGE_CAPTURE` without it being granted);
  - creates a file under the app's own `cache/camera/` and hands the camera app a
    `FileProvider` URI for it (`${applicationId}.fileprovider`, `res/xml/file_paths.xml`);
  - returns the photo to the page only if the camera actually wrote bytes to it;
  - for a file input without `capture`, opens the system file picker instead.
- **Always answers the page.** Every `onShowFileChooser` call ends with exactly one
  `onReceiveValue` — a photo, or `null` when the worker cancels, denies the permission, has no
  camera app, taps twice quickly, or the activity is destroyed. A WebView never opens another
  file chooser while an earlier callback is unanswered, so a single missed `null` would make every
  later capture fail silently.
- The Android back button navigates the WebView's own history back; it only exits the app when
  there is no more history (same as the POS app).

No Sunmi printer bridge, no AIDL, no download bridge (the portal downloads nothing), no storage
permission.

## Tests

`app/src/androidTest/.../CameraCaptureTest.kt` runs on an Android emulator in CI
(`.github/workflows/android-station-build.yml`, job `camera-test`). It loads a page with the same
file input into the app's real WebView, taps it with a real touch (UiAutomator), and intercepts the
camera intent with Espresso-Intents, writing a real JPEG into the `FileProvider` URI the app
created — exactly what a camera app does. It verifies:

1. a photo reaches the page as a non-empty `image/jpeg`, through the app's own `FileProvider`;
2. after the worker **cancels**, the next capture still opens the camera and delivers the photo;
3. a camera that reports success but writes nothing is treated as a cancel, and capture still works.

Not covered by the emulator test: a real camera app, the permission-denied path, and a phone
killing the app while the camera is open (the page reloads; that one photo must be retaken).

## Building

```
cd android-station
./gradlew assembleDebug                 # APK in app/build/outputs/apk/debug/
./gradlew connectedDebugAndroidTest     # needs a running emulator or device
```

Releases: run the workflow manually on `production` (`workflow_dispatch`) with a `release_tag`
such as `android-station-v1.1`; after the debug build and the emulator camera test both pass, the
`release` job waits for approval of the `android-release` environment, then builds, signs (see
"Release signing") and publishes `athar-station-<version>.apk` as a pre-release. The download page serves a committed copy at
`frontend/public/app/athar-station.apk` — see the update notes at the bottom of
`frontend/src/pages/DownloadPage.jsx`.

## Release signing

Published APKs (both this app and the POS (`../android/`) app) are signed with **one permanent release key**,
so every new version installs as an update over the previous one. Android refuses an update signed
with a different key, and uninstalling instead wipes the app's WebView data (login, saved state).

- The key never lives in this repository, and it is **not** a repository secret. It lives in the
  GitHub Environment **`android-release`**, which only allows the `production` branch and requires
  a reviewer's approval before any job using it starts:
  - environment secrets `ANDROID_KEYSTORE_BASE64` (the `.jks` file, base64 on one line),
    `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`;
  - environment **variable** `ANDROID_KEY_ALIAS` — a variable on purpose: GitHub masks every
    occurrence of a secret's value in logs, and an alias of `athar` would turn `com.athar.*` into
    `com.***.*` in the very lines that prove the package identity.
- Ordinary pushes and pull requests build a **debug** APK and never receive the key. Only the
  workflow's `release` job — manual (`workflow_dispatch` with a `release_tag`), run on `production`,
  approved by the reviewer — builds `assembleRelease`.
- `.github/scripts/android-signed-build.sh release …` fails if any of the four values is empty (it
  never falls back to debug), decodes the keystore into the runner's temp directory (owner-only,
  removed on exit, failure, `INT`/`TERM`, plus an `if: always()` cleanup step), runs Gradle with
  `--no-daemon`, then checks the APK with `aapt2` (applicationId, versionName) and `apksigner`
  (fails on a debug certificate) and prints the certificate's SHA-256. The certificate DN is public
  (it is in every APK and in the log).
- **Losing the keystore or its password means no future update can install over existing copies.**
  Keep backups outside GitHub; secrets cannot be read back from GitHub.
- Local builds: `./gradlew assembleDebug` needs no key. For a signed release build, set
  `ANDROID_KEYSTORE_FILE` (path to the `.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and
  `ANDROID_KEY_PASSWORD`, then run `./gradlew assembleRelease`.

## Icon

Generated by `assets/brand/generate_android_station_icons.py` from the same Athar mark as the POS
icon, but inverted (mark on brand navy instead of cream) with a copper fuel-pump badge, so the two
apps are easy to tell apart on a home screen.
