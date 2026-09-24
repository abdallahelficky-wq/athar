# Athar POS — Android wrapper (Sunmi V2)

A thin Kotlin wrapper app: a full-screen WebView loading the Athar POS web app, plus a native
bridge so the Sunmi V2's **built-in** thermal printer (not an external Bluetooth one) can be
driven from the web app's existing ESC/POS builder. This is the companion app for the
`window.AtharPrinter` contract added to the main repo's POS print path (see the "native printer
bridge" PR on this repository) — that PR ships independently of this app and keeps working with
Bluetooth/`window.print()` on any device that doesn't have this wrapper installed.

## What this app does

- Loads the POS URL you configure on first run — **no URL is hardcoded anywhere**.
- Grants camera access to the WebView (via `WebChromeClient.onPermissionRequest`, backed by the
  real Android runtime `CAMERA` permission) so the existing barcode scanner keeps working.
- Handles file downloads, including the invoice PDF download button — the POS actually downloads
  files via `blob:` URLs (see "Download handling" below for why that needs special handling).
- Implements `window.AtharPrinter.printEscPos(base64Data): string`, binding
  `woyou.aidlservice.jiuiv5.IWoyouService` (Sunmi's built-in-printer AIDL service) and calling
  `sendRAWData`.
- The Android back button navigates the WebView's own history back; it only falls through to
  actually exiting the app when the WebView has no more history (i.e. on the first page loaded).

## What "success" means from `printEscPos`

Sunmi's printer service is asynchronous: `sendRAWData(data, callback)` returns immediately, and
the actual outcome arrives later via `ICallback.onRunResult(boolean)` or
`ICallback.onRaiseException(code, msg)`. The web contract, however, needs a synchronous return
value from `printEscPos()`.

This app resolves that mismatch as follows: **`{"success": true}` means the byte array was
handed to the bound Sunmi printer service's `sendRAWData` AIDL call without an exception** — i.e.
the app was bound to `woyou.aidlservice.jiuiv5` and the IPC call was accepted. It does **not**
mean the receipt physically printed, and it does not wait for the printer's own callback.

Any problem that surfaces *after* that point — `onRunResult(false)` (the printer rejected/failed
the job) or `onRaiseException` (the service raised an error) — is logged via `Log.w`/`Log.e`
(tag `AtharPos`, visible in `adb logcat`) and shown to the person using the app as an Android
`Toast`. It is **not** fed back into the JS return value, since by then `printEscPos()` has
already returned to the page.

If the printer service can't be reached at all — not installed, or `bindService` fails/times out
after 3 seconds — `printEscPos` returns `{"success": false, "error": "..."}` immediately instead,
so the web page can show a real error rather than a false "success".

## Download handling

The POS downloads files (e.g. the invoice PDF) by fetching them as a `Blob`, calling
`URL.createObjectURL(blob)`, and clicking a synthetic `<a download>` link
(`downloadBlob` in the main repo's `frontend/src/legacy/shared.jsx`). Android `WebView`'s
`DownloadListener` fires for this, but only with the bare `blob:` URL string — not the actual
file bytes, which live inside the WebView's own renderer and are not otherwise reachable from the
app. This app works around that with the standard approach: when a `blob:` download is detected,
it injects a small JavaScript snippet back into the same page that re-fetches that exact blob URL
(still valid in that page's context), reads it as a base64 data URL via `FileReader`, and hands
that string to a small internal JS bridge (`AtharDownloaderNative`, not part of the public
`window.AtharPrinter` contract) which decodes and writes the file to the device's Downloads
folder — via `MediaStore.Downloads` on Android 10+ (no permission needed), or a direct file write
guarded by a runtime `WRITE_EXTERNAL_STORAGE` permission request on Android 9 and below. Ordinary
`http(s)` downloads (any other file the POS might ever link directly) go through the standard
`DownloadManager` instead.

## Build

### Locally

Requires Android Studio (or the Android SDK + JDK 17) with network access to Google's Maven
repository (`dl.google.com`). **This project could not be built or verified inside the sandbox
that developed it** — that sandbox's network policy blocks `dl.google.com` outright (confirmed
with a direct `403` on the CONNECT), and no Android SDK was available there either. It was built
by hand against Sunmi's documented AIDL interface and standard Android/WebView APIs, then
verified for real via the GitHub Actions workflow below, which runs on a normal runner with full
internet access.

```bash
cd android
./gradlew assembleDebug
```

The debug APK lands at `android/app/build/outputs/apk/debug/app-debug.apk`.

### From GitHub Actions (no local Android setup needed)

Any push touching `android/**` triggers the **Android debug APK** workflow
(`.github/workflows/android-build.yml`), which runs `./gradlew assembleDebug` and uploads the
result as a workflow artifact. It is path-filtered so it never runs on backend or frontend-only
changes, and it cannot affect the existing `backend`/`migrate-deploy-replay` checks — it's a
completely separate workflow file with its own trigger.

1. On GitHub, open **Actions** → **Android debug APK** → the run for your commit.
2. Under **Artifacts**, download the `athar-pos-debug-apk` zip (it contains the `.apk`).

## Install on the Sunmi V2 (sideload)

1. On the device, allow installing apps from outside the Play Store (Settings → Security, or a
   one-time per-source prompt the first time you open the file — the exact wording depends on the
   Android version). This is expected: Sunmi terminals are typically not Play Store devices.
2. Get the downloaded `.apk` onto the device — a USB cable + file manager, `adb push` +
   `adb install app-debug.apk`, or opening a download link on the device itself all work.
3. Open the `.apk` file on the device and confirm the install prompt.

## Setting the server URL

- **First run**: the app opens straight to the settings screen and asks for the Athar POS URL
  (e.g. `https://your-domain.example.com/pos.html`) — nothing loads until one is entered and
  saved.
- **Later**: tap the gear icon in the app's top bar at any time to reopen the same screen and
  change the URL; the WebView reloads with the new address after saving.

## Known limitations / not built here

- Placeholder launcher icon (a simple vector shape) — swap `app/src/main/res/drawable/ic_launcher.xml`
  for a real one when convenient.
- No release signing configuration — only `assembleDebug` is wired up, matching the workflow.
- **Not tested on real Sunmi hardware.** The printer binding, `sendRAWData` call, and download
  handling are implemented against Sunmi's documented AIDL interface (`woyou.aidlservice.jiuiv5`,
  confirmed from real third-party source code — see the main repo's chat history for citations)
  and standard WebView/Android APIs, but the build sandbox that produced this code has neither an
  Android SDK nor a physical device to verify against. Confirm actual printing and downloads on a
  real Sunmi V2 before relying on this in production.
