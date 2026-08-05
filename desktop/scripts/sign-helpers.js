// Sign the bundled Swift/CLI helpers (yap, camstate, callstate) with hardened
// runtime + entitlements BEFORE electron-builder signs the outer app, so
// notarization doesn't reject unsigned nested executables. No-op without an
// identity (local dev / ad-hoc builds).
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function signHelpers(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const identity =
    process.env.CSC_NAME ||
    (context.packager.platformSpecificBuildOptions &&
      context.packager.platformSpecificBuildOptions.identity);
  if (!identity) {
    console.log('sign-helpers: no signing identity — skipping (dev build).');
    return;
  }
  const appName = context.packager.appInfo.productFilename;
  const binDir = path.join(context.appOutDir, `${appName}.app`, 'Contents', 'Resources', 'bin');
  const ent = path.join(__dirname, '..', 'entitlements.mac.plist');
  for (const f of ['yap', 'camstate', 'callstate']) {
    const p = path.join(binDir, f);
    if (!fs.existsSync(p)) continue;
    execSync(
      `codesign --force --options runtime --timestamp --entitlements "${ent}" --sign "${identity}" "${p}"`,
      { stdio: 'inherit' }
    );
    console.log('sign-helpers: signed', f);
  }
};
