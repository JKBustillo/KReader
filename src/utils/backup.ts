import { mkdir, writeTextFile, readDir, remove, BaseDirectory } from "@tauri-apps/plugin-fs";
import { exportLibraryData } from "./libraryStore";
import { getAutoBackup, getLastBackupAt, saveLastBackupAt } from "./settingsStore";

const BACKUP_DIR = "backups";
const BACKUP_PREFIX = "kreader-backup-";
const BACKUP_EXT = ".json";
const MAX_BACKUPS = 5;
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // throttle: at most one backup per day
const JSON_INDENT = 2;

// Backups live next to the .dat stores in app_config_dir().
const BASE = { baseDir: BaseDirectory.AppConfig };

/**
 * Writes a timestamped JSON backup of the library store (same shape as the
 * manual export, so it restores via the existing import) into
 * app_config_dir()/backups — but only when auto-backup is enabled and at least
 * BACKUP_INTERVAL_MS has elapsed since the last one. Keeps the most recent
 * MAX_BACKUPS files. Never throws: failures are logged so app startup is safe.
 */
export async function runAutoBackupIfDue(): Promise<void> {
  try {
    if (!(await getAutoBackup())) return;

    const now = Date.now();
    if (now - (await getLastBackupAt()) < BACKUP_INTERVAL_MS) return;

    await mkdir(BACKUP_DIR, { ...BASE, recursive: true });

    const data = await exportLibraryData();
    const json = JSON.stringify(data, null, JSON_INDENT);
    await writeTextFile(`${BACKUP_DIR}/${BACKUP_PREFIX}${now}${BACKUP_EXT}`, json, BASE);

    await saveLastBackupAt(now);
    await pruneOldBackups();
  } catch (err) {
    console.error("[auto-backup]", err);
  }
}

/** Keeps only the most recent MAX_BACKUPS files, deleting the oldest. */
async function pruneOldBackups(): Promise<void> {
  const entries = await readDir(BACKUP_DIR, BASE);
  const backups = entries
    .filter((e) => e.isFile && e.name.startsWith(BACKUP_PREFIX) && e.name.endsWith(BACKUP_EXT))
    .map((e) => e.name)
    .sort(); // epoch-ms timestamp in the name → lexicographic order is chronological

  const excess = backups.length - MAX_BACKUPS;
  for (let i = 0; i < excess; i++) {
    await remove(`${BACKUP_DIR}/${backups[i]}`, BASE);
  }
}
