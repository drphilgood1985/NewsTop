import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import { log, toFileUri } from './util.js';

const exec = promisify(execCb);

async function setGsettings(schema, key, value) {
  const cmd = `gsettings set ${schema} ${key} ${JSON.stringify(value)}`;
  log('Running:', cmd);
  await exec(cmd);
}

export async function setWallpaper(absPath, desktopEnv = 'cinnamon') {
  const fileUri = toFileUri(absPath);
  if (desktopEnv === 'gnome') {
    await setGsettings('org.gnome.desktop.background', 'picture-uri', fileUri);
    try { await setGsettings('org.gnome.desktop.background', 'picture-uri-dark', fileUri); } catch {}
    try { await setGsettings('org.gnome.desktop.background', 'picture-options', 'zoom'); } catch {}
  } else {
    // Default to Cinnamon (Linux Mint)
    await setGsettings('org.cinnamon.desktop.background', 'picture-uri', fileUri);
    try { await setGsettings('org.cinnamon.desktop.background', 'picture-options', 'zoom'); } catch {}
  }
}

