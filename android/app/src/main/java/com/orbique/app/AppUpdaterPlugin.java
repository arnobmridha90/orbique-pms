package com.orbique.app;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * In-app updates for the Android test builds (app/native/updates.js, docs/MOBILE.md "Updating the app").
 *
 * Update in the app's notice: download() fetches the APK of the newest test build into the app's cache (progress as
 * "downloadProgress" events), checks it, and install() hands it to Android's package installer, which asks the person
 * to tap Install. Nothing from the page is trusted on its own:
 * - only https addresses under DOWNLOAD_PREFIX (this repository's GitHub releases) are downloaded; redirects must stay
 *   on https and on GitHub's own hosts
 * - before install, the file must be an APK for this app's package, signed with the same certificate(s) as the app
 *   that is installed, with a higher versionCode; otherwise it is deleted and the call fails with a code
 * - install() only installs the file this plugin downloaded and checked (it checks it again first)
 * Error codes: BAD_URL, BUSY, NETWORK, STORAGE, CANCELLED, INVALID_APK, WRONG_PACKAGE, WRONG_SIGNATURE, NOT_NEWER,
 * NO_FILE, NEEDS_PERMISSION, NO_INSTALLER, UNSUPPORTED.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    private static final String TAG = "OrbiqueUpdater";
    static final String DOWNLOAD_PREFIX = "https://github.com/arnobmridha90/orbique-pms/releases/download/";
    private static final String APK_MIME = "application/vnd.android.package-archive";
    /** /<owner>/<repo>/releases/download/<tag>/<file>.apk with plain names only (no %-escapes, no "..") */
    private static final Pattern RELEASE_PATH = Pattern.compile("/arnobmridha90/orbique-pms/releases/download/[A-Za-z0-9_-][A-Za-z0-9._-]*/[A-Za-z0-9_-][A-Za-z0-9._-]*\\.apk");
    private static final Pattern SAFE_QUERY = Pattern.compile("[A-Za-z0-9._=&-]*");
    private static final int MAX_REDIRECTS = 5;
    private static final long MAX_BYTES = 300L * 1024 * 1024;

    private final Object lock = new Object();
    private Thread worker;
    private volatile boolean cancelled;
    private volatile HttpURLConnection connection;

    @Override
    public void load() {
        // an APK left over from an earlier update is no longer needed
        deleteQuietly(apkFile());
        deleteQuietly(partFile());
        Log.i(TAG, "AppUpdater plugin loaded");
    }

    /**
     * {supported, allowed}: supported is false in a build without REQUEST_INSTALL_PACKAGES (the Google Play bundle; the
     * page then keeps the browser download); allowed: may this app hand an APK to the package installer now? (Android 8
     * and later ask once per app)
     */
    @PluginMethod
    public void canInstall(PluginCall call) {
        boolean supported = declaresInstallPermission();
        JSObject ret = new JSObject();
        ret.put("supported", supported);
        ret.put("allowed", supported && installAllowed());
        call.resolve(ret);
    }

    /** opens Android's "Install unknown apps" page for this app; {opened} */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            ret.put("opened", false);
            call.resolve(ret);
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            ret.put("opened", true);
            call.resolve(ret);
        } catch (ActivityNotFoundException e) {
            ret.put("opened", false);
            call.resolve(ret);
        }
    }

    /** download({url}): fetch and check the APK; resolves {versionCode, bytes} */
    @PluginMethod
    public void download(final PluginCall call) {
        final String url = call.getString("url", "");
        if (!allowedStart(url)) {
            call.reject("Only Orbique's own GitHub release downloads are allowed", "BAD_URL");
            return;
        }
        synchronized (lock) {
            if (worker != null && worker.isAlive()) {
                call.reject("An update is already downloading", "BUSY");
                return;
            }
            cancelled = false;
            worker = new Thread(() -> runDownload(call, url), "OrbiqueUpdater");
            worker.start();
        }
    }

    /** stops a download in progress (its download() call fails with CANCELLED) */
    @PluginMethod
    public void cancel(PluginCall call) {
        cancelled = true;
        HttpURLConnection c = connection;
        if (c != null) {
            try {
                c.disconnect();
            } catch (Exception ignored) {
                // already closed
            }
        }
        call.resolve();
    }

    /** hands the checked APK to Android's package installer; resolves {started: true} */
    @PluginMethod
    public void install(PluginCall call) {
        File apk = apkFile();
        if (!apk.isFile()) {
            call.reject("No checked update to install. Download it first.", "NO_FILE");
            return;
        }
        String problem = check(apk);
        if (problem != null) {
            deleteQuietly(apk);
            call.reject(message(problem), problem);
            return;
        }
        if (!declaresInstallPermission()) {
            call.reject("This build of Orbique cannot install updates itself", "UNSUPPORTED");
            return;
        }
        if (!installAllowed()) {
            call.reject("Orbique is not allowed to install updates yet", "NEEDS_PERMISSION");
            return;
        }
        try {
            Context ctx = getContext();
            Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, APK_MIME);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("started", true);
            call.resolve(ret);
        } catch (ActivityNotFoundException e) {
            call.reject("This phone has no app that installs updates", "NO_INSTALLER");
        } catch (IllegalArgumentException e) {
            call.reject("The update file cannot be shared with the installer", "NO_FILE", e);
        }
    }

    // ------------------------------------------------------------------ download

    private void runDownload(PluginCall call, String start) {
        File part = partFile();
        File apk = apkFile();
        deleteQuietly(part);
        deleteQuietly(apk);
        HttpURLConnection c = null;
        try {
            File dir = part.getParentFile();
            if (dir != null && !dir.isDirectory() && !dir.mkdirs()) throw new StorageException();
            URL url = new URL(start);
            for (int hop = 0; ; hop++) {
                c = (HttpURLConnection) url.openConnection();
                connection = c;
                c.setInstanceFollowRedirects(false);
                c.setConnectTimeout(20000);
                c.setReadTimeout(30000);
                c.setRequestProperty("User-Agent", "Orbique-Android-Updater");
                c.setRequestProperty("Accept", "application/octet-stream");
                if (cancelled) throw new CancelledException();
                int status = c.getResponseCode();
                if (status >= 300 && status < 400) {
                    String loc = c.getHeaderField("Location");
                    c.disconnect();
                    if (loc == null || hop >= MAX_REDIRECTS) throw new IOException("Bad redirect");
                    url = new URL(url, loc);
                    if (!allowedHop(url)) throw new IOException("Redirect to an address that is not GitHub's: " + url.getHost());
                    continue;
                }
                if (status != HttpURLConnection.HTTP_OK) throw new IOException("HTTP " + status);
                break;
            }
            long total = c.getContentLengthLong();
            if (total > MAX_BYTES) throw new IOException("The file is too large");
            long done = 0;
            int lastPercent = -2;
            byte[] buf = new byte[64 * 1024];
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                int n;
                while ((n = in.read(buf)) != -1) {
                    if (cancelled) throw new CancelledException();
                    out.write(buf, 0, n);
                    done += n;
                    if (done > MAX_BYTES) throw new IOException("The file is too large");
                    int percent = total > 0 ? (int) Math.min(100, (done * 100) / total) : -1;
                    if (percent != lastPercent) {
                        lastPercent = percent;
                        progress(percent, done, total);
                    }
                }
            } catch (IOException e) {
                if (cancelled) throw new CancelledException();
                if (part.getUsableSpace() < 1024 * 1024) throw new StorageException();
                throw e;
            }
            if (cancelled) throw new CancelledException();
            if (total > 0 && done != total) throw new IOException("The download stopped early");
            if (!part.renameTo(apk)) throw new StorageException();
            String problem = check(apk);
            if (problem != null) {
                deleteQuietly(apk);
                call.reject(message(problem), problem);
                return;
            }
            JSObject ret = new JSObject();
            ret.put("versionCode", versionCode(getContext().getPackageManager().getPackageArchiveInfo(apk.getPath(), 0)));
            ret.put("bytes", done);
            call.resolve(ret);
        } catch (CancelledException e) {
            deleteQuietly(part);
            deleteQuietly(apk);
            call.reject("The download was cancelled", "CANCELLED");
        } catch (StorageException e) {
            deleteQuietly(part);
            deleteQuietly(apk);
            call.reject("Not enough space on the phone for the update", "STORAGE");
        } catch (Exception e) {
            deleteQuietly(part);
            deleteQuietly(apk);
            if (cancelled) call.reject("The download was cancelled", "CANCELLED");
            else call.reject("The update could not be downloaded: " + e.getMessage(), "NETWORK");
        } finally {
            if (c != null) c.disconnect();
            connection = null;
        }
    }

    private void progress(int percent, long done, long total) {
        JSObject e = new JSObject();
        e.put("percent", percent);
        e.put("downloaded", done);
        e.put("total", total);
        notifyListeners("downloadProgress", e);
    }

    /** the first address must be one of this repository's release downloads (https, github.com, no user or port) */
    static boolean allowedStart(String s) {
        if (s == null || !s.startsWith(DOWNLOAD_PREFIX) || s.contains("..") || s.contains("\\")) return false;
        try {
            URL u = new URL(s);
            return "https".equals(u.getProtocol()) && "github.com".equals(u.getHost()) && u.getUserInfo() == null && u.getPort() == -1 &&
                u.getRef() == null && RELEASE_PATH.matcher(u.getPath()).matches() && (u.getQuery() == null || SAFE_QUERY.matcher(u.getQuery()).matches());
        } catch (Exception e) {
            return false;
        }
    }

    /** a redirect GitHub sends: https on github.com or one of its download hosts (*.githubusercontent.com) */
    static boolean allowedHop(URL u) {
        if (!"https".equals(u.getProtocol()) || u.getUserInfo() != null || (u.getPort() != -1 && u.getPort() != 443)) return false;
        String h = u.getHost() == null ? "" : u.getHost().toLowerCase(Locale.ROOT);
        return h.equals("github.com") || h.endsWith(".githubusercontent.com");
    }

    // ------------------------------------------------------------------ checks

    /** null when the APK may be installed, else an error code */
    private String check(File apk) {
        Context ctx = getContext();
        PackageManager pm = ctx.getPackageManager();
        String pkg = ctx.getPackageName();
        PackageInfo archive;
        PackageInfo installed;
        try {
            archive = pm.getPackageArchiveInfo(apk.getPath(), signatureFlags());
            installed = pm.getPackageInfo(pkg, signatureFlags());
        } catch (Exception e) {
            return "INVALID_APK";
        }
        if (archive == null || installed == null) return "INVALID_APK";
        if (!pkg.equals(archive.packageName)) return "WRONG_PACKAGE";
        Set<String> want = signers(installed);
        Set<String> got = signers(archive);
        if (want.isEmpty() || got.isEmpty() || !want.equals(got)) return "WRONG_SIGNATURE";
        if (versionCode(archive) <= versionCode(installed)) return "NOT_NEWER";
        return null;
    }

    @SuppressWarnings("deprecation")
    private static int signatureFlags() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
    }

    /** SHA-256 of each certificate the package is signed with now */
    @SuppressWarnings("deprecation")
    private static Set<String> signers(PackageInfo info) {
        Signature[] sigs = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            SigningInfo si = info.signingInfo;
            if (si != null) {
                if (si.hasMultipleSigners()) {
                    sigs = si.getApkContentsSigners();
                } else {
                    Signature[] history = si.getSigningCertificateHistory();
                    // the current certificate is the last one in the rotation history
                    if (history != null && history.length > 0) sigs = new Signature[] { history[history.length - 1] };
                }
            }
        } else {
            sigs = info.signatures;
        }
        Set<String> out = new HashSet<>();
        if (sigs == null) return out;
        for (Signature s : sigs) {
            if (s == null) continue;
            try {
                byte[] d = MessageDigest.getInstance("SHA-256").digest(s.toByteArray());
                StringBuilder b = new StringBuilder();
                for (byte x : d) b.append(String.format(Locale.ROOT, "%02x", x));
                out.add(b.toString());
            } catch (Exception ignored) {
                // SHA-256 is always there
            }
        }
        return out;
    }

    @SuppressWarnings("deprecation")
    private static long versionCode(PackageInfo info) {
        if (info == null) return 0;
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
    }

    private boolean declaresInstallPermission() {
        try {
            Context ctx = getContext();
            PackageInfo info = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), PackageManager.GET_PERMISSIONS);
            if (info.requestedPermissions == null) return false;
            for (String p : info.requestedPermissions) if (Manifest.permission.REQUEST_INSTALL_PACKAGES.equals(p)) return true;
        } catch (Exception ignored) {
            // treated as not declared
        }
        return false;
    }

    private boolean installAllowed() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return getContext().getPackageManager().canRequestPackageInstalls();
    }

    private static String message(String code) {
        switch (code) {
            case "WRONG_PACKAGE":
                return "The downloaded file is not the Orbique app";
            case "WRONG_SIGNATURE":
                return "The downloaded app is not signed like the installed Orbique app";
            case "NOT_NEWER":
                return "The downloaded app is not newer than the installed one";
            default:
                return "The downloaded file is not a valid app";
        }
    }

    // ------------------------------------------------------------------ files (cache/updates: res/xml/file_paths.xml cache-path)

    private File apkFile() {
        return new File(new File(getContext().getCacheDir(), "updates"), "Orbique-update.apk");
    }

    private File partFile() {
        return new File(new File(getContext().getCacheDir(), "updates"), "Orbique-update.apk.part");
    }

    private static void deleteQuietly(File f) {
        try {
            if (f.exists() && !f.delete()) Log.w(TAG, "Could not delete " + f.getName());
        } catch (Exception ignored) {
            // nothing to clean up
        }
    }

    private static class CancelledException extends Exception {}

    private static class StorageException extends Exception {}
}
