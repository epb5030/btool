import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { BrowserType } from './browser.js';

export interface ResolvedProfile {
  path: string;
  isEphemeral: boolean;
  isClonedFromExisting: boolean;
}

export class ProfileManager {
  static async resolveProfile(browser: BrowserType, profileNameOrPath?: string): Promise<ResolvedProfile> {
    if (!profileNameOrPath) {
      const ephemeralPath = await fs.mkdtemp(path.join(os.tmpdir(), `btool-${browser}-ephemeral-`));
      return { path: ephemeralPath, isEphemeral: true, isClonedFromExisting: false };
    }

    // 1. Check if directly a directory path
    if (fsSync.existsSync(profileNameOrPath) && fsSync.statSync(profileNameOrPath).isDirectory()) {
      return this.prepareProfile(profileNameOrPath, browser);
    }

    // 2. Resolve named profile from browser profiles.ini
    const resolvedPath = await this.findProfileDirByName(browser, profileNameOrPath);
    if (resolvedPath && fsSync.existsSync(resolvedPath)) {
      return this.prepareProfile(resolvedPath, browser);
    }

    throw new Error(`Profile '${profileNameOrPath}' not found for browser '${browser}'.`);
  }

  private static async findProfileDirByName(browser: BrowserType, name: string): Promise<string | null> {
    const home = os.homedir();
    const iniCandidates: Record<BrowserType, string[]> = {
      zen: [
        path.join(home, '.config', 'zen', 'profiles.ini'),
        path.join(home, '.zen', 'profiles.ini')
      ],
      firefox: [
        path.join(home, '.config', 'mozilla', 'firefox', 'profiles.ini'),
        path.join(home, '.mozilla', 'firefox', 'profiles.ini')
      ],
      brave: [
        path.join(home, '.config', 'BraveSoftware', 'Brave-Browser')
      ]
    };

    if (browser === 'brave') {
      const baseDir = iniCandidates.brave[0];
      const target = name.toLowerCase() === 'default' ? 'Default' : name;
      const full = path.join(baseDir, target);
      return fsSync.existsSync(full) ? full : null;
    }

    for (const iniPath of iniCandidates[browser]) {
      if (fsSync.existsSync(iniPath)) {
        const content = await fs.readFile(iniPath, 'utf-8');
        const dir = path.dirname(iniPath);
        const resolved = this.parseProfilesIni(content, dir, name);
        if (resolved) return resolved;
      }
    }
    return null;
  }

  private static parseProfilesIni(content: string, baseDir: string, targetName: string): string | null {
    const sections = content.split(/\[Profile\d+\]/g).slice(1);
    let defaultProfilePath: string | null = null;

    for (const sec of sections) {
      const lines = sec.split('\n');
      let name = '';
      let relPath = '';
      let isDefault = false;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('Name=')) name = trimmed.substring(5).trim();
        if (trimmed.startsWith('Path=')) relPath = trimmed.substring(5).trim();
        if (trimmed.startsWith('Default=1')) isDefault = true;
      }

      if (relPath) {
        const full = path.resolve(baseDir, relPath);
        if (isDefault) defaultProfilePath = full;
        if (targetName.toLowerCase() === 'default' && isDefault) return full;
        if (name.toLowerCase() === targetName.toLowerCase()) return full;
        if (relPath.toLowerCase().includes(targetName.toLowerCase())) return full;
      }
    }

    return defaultProfilePath;
  }

  private static async prepareProfile(originalPath: string, browser: BrowserType): Promise<ResolvedProfile> {
    // ALWAYS clone cookies, storage, logins, and preferences into a dedicated temporary sandbox.
    // This guarantees btool NEVER locks the user's live profile directory, allowing
    // you to open and use your desktop Firefox or Zen anytime without collision or lock contention.
    const clonedPath = await fs.mkdtemp(path.join(os.tmpdir(), `btool-${browser}-cloned-`));
    
    // Copy key database and cookie files
    const filesToCopy = [
      'cookies.sqlite',
      'cookies.sqlite-wal',
      'places.sqlite',
      'favicons.sqlite',
      'key4.db',
      'logins.json',
      'cert9.db',
      'prefs.js'
    ];

    for (const file of filesToCopy) {
      const src = path.join(originalPath, file);
      const dest = path.join(clonedPath, file);
      if (fsSync.existsSync(src)) {
        try {
          await fs.copyFile(src, dest);
        } catch {
          // ignore non-critical copy error
        }
      }
    }

    // Copy storage directory if present
    const storageSrc = path.join(originalPath, 'storage');
    if (fsSync.existsSync(storageSrc)) {
      try {
        await fs.cp(storageSrc, path.join(clonedPath, 'storage'), { recursive: true });
      } catch {
        // ignore
      }
    }

    return { path: clonedPath, isEphemeral: true, isClonedFromExisting: true };
  }
}
