// Notarize the built .app after signing. No-op locally (no creds) so dev builds
// still work; in CI, APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD trigger notarization.
const { execSync } = require('child_process');
const path = require('path');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;
  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    console.log('notarize: no APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD — skipping (dev build).');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);
  const zipPath = path.join(appOutDir, `${appName}-notarize.zip`);

  console.log(`Zipping ${appName} for notarization...`);
  execSync(`ditto -c -k --keepParent "${appPath}" "${zipPath}"`, { stdio: 'inherit' });

  console.log(`Notarizing ${appName}...`);
  execSync(
    `xcrun notarytool submit "${zipPath}" ` +
      `--apple-id "${process.env.APPLE_ID}" ` +
      `--password "${process.env.APPLE_APP_SPECIFIC_PASSWORD}" ` +
      `--team-id "${process.env.APPLE_TEAM_ID || '6PG9CR3SRN'}" ` +
      `--wait`,
    { stdio: 'inherit' }
  );

  console.log('Stapling notarization ticket...');
  execSync(`xcrun stapler staple "${appPath}"`, { stdio: 'inherit' });
  try { execSync(`rm "${zipPath}"`); } catch {}
  console.log('Notarization complete.');
};
