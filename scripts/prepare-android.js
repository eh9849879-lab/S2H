#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = 'build-workspace';
const BUILD_DATA = 'build-data';

const ANDROID_PERMISSIONS = {
  INTERNET: 'android.permission.INTERNET',
  ACCESS_NETWORK_STATE: 'android.permission.ACCESS_NETWORK_STATE',
  CAMERA: 'android.permission.CAMERA',
  RECORD_AUDIO: 'android.permission.RECORD_AUDIO',
  READ_EXTERNAL_STORAGE: 'android.permission.READ_EXTERNAL_STORAGE',
  READ_MEDIA_IMAGES: 'android.permission.READ_MEDIA_IMAGES',
  ACCESS_FINE_LOCATION: 'android.permission.ACCESS_FINE_LOCATION',
  ACCESS_COARSE_LOCATION: 'android.permission.ACCESS_COARSE_LOCATION',
  POST_NOTIFICATIONS: 'android.permission.POST_NOTIFICATIONS',
  VIBRATE: 'android.permission.VIBRATE'
};

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function write(p, content) { ensureDir(path.dirname(p)); fs.writeFileSync(p, content); }
function escapeXml(s) { return String(s || '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c])); }
function gradleEscape(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

function main() {
  const cfg = JSON.parse(fs.readFileSync(path.join(BUILD_DATA, 'config.json'), 'utf8'));
  const c = cfg.config || {};
  const pkg = cfg.packageName;
  const appName = cfg.projectName || 'App';
  const isRelease = (cfg.variant === 'release' || cfg.buildType === 'AAB');

  if (isRelease && !(cfg.signing && cfg.signing.keystore)) throw new Error('Release requires signing key.');

  if (fs.existsSync(ROOT)) fs.rmSync(ROOT, { recursive: true, force: true });
  ensureDir(ROOT);
  const pkgPath = pkg.replace(/\./g, '/');
  const srcDir = path.join(ROOT, 'app/src/main/java', pkgPath);
  ensureDir(srcDir);

  // 1. Gradle Files
  write(path.join(ROOT, 'settings.gradle'), `pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }\ndependencyResolutionManagement { repositories { google(); mavenCentral() } }\ninclude ':app'`);
  write(path.join(ROOT, 'build.gradle'), `plugins { id 'com.android.application' version '8.5.2' apply false; id 'org.jetbrains.kotlin.android' version '1.9.24' apply false }`);
  
  if (isRelease) {
    const b64 = (cfg.signing.keystore || '').split(',').pop();
    ensureDir(path.join(ROOT, 'app'));
    fs.writeFileSync(path.join(ROOT, 'app', 'release.p12'), Buffer.from(b64, 'base64'));
    write(path.join(ROOT, 'signing.properties'), `storePassword=${cfg.signing.storePassword}\nkeyAlias=${cfg.signing.alias}\nkeyPassword=${cfg.signing.keyPassword}`);
  }

  write(path.join(ROOT, 'app/build.gradle'), `plugins { id 'com.android.application'; id 'org.jetbrains.kotlin.android' }
def signingProps = new Properties(); def signingFile = rootProject.file('signing.properties')
if (signingFile.exists()) { signingProps.load(new FileInputStream(signingFile)) }
android {
    namespace '${gradleEscape(pkg)}'; compileSdk 34
    defaultConfig { applicationId '${gradleEscape(pkg)}'; minSdk ${c.minSdk||24}; targetSdk ${c.targetSdk||34}; versionCode ${cfg.versionCode}; versionName '${gradleEscape(cfg.versionName)}' }
    ${isRelease ? `signingConfigs { release { storeFile file('release.p12'); storeType 'PKCS12'; storePassword signingProps['storePassword']; keyAlias signingProps['keyAlias']; keyPassword signingProps['keyPassword'] } }` : ''}
    buildTypes { debug { minifyEnabled false }; release { minifyEnabled false; ${isRelease ? 'signingConfig signingConfigs.release' : ''} } }
    compileOptions { sourceCompatibility JavaVersion.VERSION_17; targetCompatibility JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = '17' }
}
dependencies { implementation 'androidx.appcompat:appcompat:1.7.0'; implementation 'androidx.core:core-ktx:1.13.1'; implementation 'androidx.webkit:webkit:1.11.0'; implementation 'com.google.android.material:material:1.12.0' }`);

  // 2. Manifest with Selected Permissions
  const permsBlock = (cfg.permissions || []).map(p => ANDROID_PERMISSIONS[p] ? `    <uses-permission android:name="${ANDROID_PERMISSIONS[p]}" />` : null).filter(Boolean).join('\n');
  const orientation = c.orientation === 'landscape' ? 'landscape' : c.orientation === 'auto' ? 'fullSensor' : 'portrait';

  write(path.join(ROOT, 'app/src/main/AndroidManifest.xml'), `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
${permsBlock}
    <application android:label="@string/app_name" android:icon="@mipmap/ic_launcher" android:theme="@style/Theme.DebugBuilder" ${c.cleartext ? 'android:usesCleartextTraffic="true"' : ''}>
        <activity android:name=".MainActivity" android:exported="true" android:screenOrientation="${orientation}" android:configChanges="orientation|screenSize|keyboardHidden">
            <intent-filter><action android:name="android.intent.action.MAIN" /><category android:name="android.intent.category.LAUNCHER" /></intent-filter>
        </activity>
    </application>
</manifest>`);

  // 3. MainActivity (Kotlin) with REAL Permission Handling
  const needsCamera = cfg.permissions.includes('CAMERA') ? 'true' : 'false';
  const needsMic = cfg.permissions.includes('RECORD_AUDIO') ? 'true' : 'false';
  const needsLocation = cfg.permissions.includes('ACCESS_FINE_LOCATION') ? 'true' : 'false';

  write(path.join(srcDir, 'MainActivity.kt'), `package ${pkg}

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.os.Bundle
import android.webkit.*
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<android.net.Uri>>? = null
    private var permissionRequest: PermissionRequest? = null
    private val FILE_CHOOSER_RESULT_CODE = 100
    private val PERMISSION_REQ_CODE = 101

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = ${c.js !== false}
            domStorageEnabled = ${c.domStorage !== false}
            databaseEnabled = true
            allowFileAccess = true
            mediaPlaybackRequiresUserGesture = false
            ${needsLocation ? 'geolocationEnabled = true' : ''}
            ${c.zoom ? 'setSupportZoom(true); builtInZoomControls = true; displayZoomControls = false' : ''}
        }

        // Request Runtime Permissions upfront if needed
        requestAppPermissions()

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    if (request.resources.any { it == PermissionRequest.RESOURCE_VIDEO_CAPTURE || it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }) {
                        permissionRequest = request
                        if (hasPermissions()) {
                            request.grant(request.resources)
                        } else {
                            ActivityCompat.requestPermissions(this@MainActivity, getRequiredPermissions(), PERMISSION_REQ_CODE)
                        }
                    } else {
                        request.deny()
                    }
                }
            }

            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                callback.invoke(origin, true, false)
            }

            override fun onShowFileChooser(webView: WebView, filePathCallback: ValueCallback<Array<android.net.Uri>>, fileChooserParams: FileChooserParams): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback
                val intent = fileChooserParams.createIntent()
                try {
                    startActivityForResult(intent, FILE_CHOOSER_RESULT_CODE)
                } catch (e: Exception) {
                    this@MainActivity.filePathCallback = null
                    return false
                }
                return true
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return false
            }
        }

        webView.loadUrl("file:///android_asset/${(c.entry || 'index.html').replace(/^\/+/, '')}")
    }

    private fun getRequiredPermissions(): Array<String> {
        val perms = mutableListOf<String>()
        ${needsCamera ? 'perms.add(Manifest.permission.CAMERA)' : ''}
        ${needsMic ? 'perms.add(Manifest.permission.RECORD_AUDIO)' : ''}
        ${needsLocation ? 'perms.add(Manifest.permission.ACCESS_FINE_LOCATION); perms.add(Manifest.permission.ACCESS_COARSE_LOCATION)' : ''}
        return perms.toTypedArray()
    }

    private fun hasPermissions(): Boolean {
        return getRequiredPermissions().all {
            ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
        }
    }

    private fun requestAppPermissions() {
        if (!hasPermissions()) {
            ActivityCompat.requestPermissions(this, getRequiredPermissions(), PERMISSION_REQ_CODE)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_REQ_CODE) {
            if (grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }) {
                permissionRequest?.grant(permissionRequest?.resources)
            } else {
                permissionRequest?.deny()
            }
            permissionRequest = null
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: android.content.Intent?) {
        if (requestCode == FILE_CHOOSER_RESULT_CODE) {
            filePathCallback?.onReceiveValue(FileChooserParams.parseResult(resultCode, data))
            filePathCallback = null
        } else {
            super.onActivityResult(requestCode, resultCode, data)
        }
    }
}`);

  // 4. Assets & Strings
  write(path.join(ROOT, 'app/src/main/res/values/strings.xml'), `<resources><string name="app_name">${escapeXml(appName)}</string></resources>`);
  write(path.join(ROOT, 'app/src/main/res/values/styles.xml'), `<resources><style name="Theme.DebugBuilder" parent="Theme.MaterialComponents.DayNight.NoActionBar"/></resources>`);
  
  const assetsDir = path.join(ROOT, 'app/src/main/assets'); ensureDir(assetsDir);
  function copyRecursive(src, dest) {
    if (!fs.existsSync(src)) return;
    fs.readdirSync(src, { withFileTypes: true }).forEach(e => {
      const s = path.join(src, e.name); const d = path.join(dest, e.name);
      if (e.isDirectory()) { ensureDir(d); copyRecursive(s, d); } else fs.copyFileSync(s, d);
    });
  }
  copyRecursive(path.join(BUILD_DATA, 'project'), assetsDir);

  // 5. Default Icon
  const iconB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1KsAAAAASUVORK5CYII=';
  ['mdpi','hdpi','xhdpi','xxhdpi','xxxhdpi'].forEach(d => {
    ensureDir(path.join(ROOT, `app/src/main/res/mipmap-${d}`));
    fs.writeFileSync(path.join(ROOT, `app/src/main/res/mipmap-${d}/ic_launcher.png`), Buffer.from(iconB64, 'base64'));
  });

  // 6. Meta
    // 6. Meta (Purana code replace karein)
  let outputPath, gradleTask;
  if (cfg.buildType === 'AAB') { 
    gradleTask = 'bundleRelease'; 
    outputPath = 'app/build/outputs/bundle/release/app-release.aab'; 
  } else if (cfg.variant === 'release') { 
    gradleTask = 'assembleRelease'; 
    outputPath = 'app/build/outputs/apk/release/app-release.apk'; 
  } else { 
    gradleTask = 'assembleDebug'; 
    outputPath = 'app/build/outputs/apk/debug/app-debug.apk'; 
  }

  // Ye line add karein taaki meta.json ban jaye
  write(path.join(ROOT, 'build-meta.json'), JSON.stringify({ buildType: cfg.buildType, variant: cfg.variant, gradleTask, outputPath }, null, 2));
