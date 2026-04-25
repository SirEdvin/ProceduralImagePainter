export interface S3Settings {
  enabled: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  pathPrefix: string;
  publicUrlBase: string;
}

export interface R2Settings {
  enabled: boolean;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  pathPrefix: string;
  publicUrlBase: string;
}

export interface CloudSettings {
  s3: S3Settings;
  r2: R2Settings;
  recentImagesInCloud: boolean;
}

const STORAGE_KEY = 'cloudStorageSettings';

function defaultSettings(): CloudSettings {
  return {
    s3: {
      enabled: false,
      accessKeyId: '',
      secretAccessKey: '',
      region: '',
      bucket: '',
      pathPrefix: '',
      publicUrlBase: '',
    },
    r2: {
      enabled: false,
      accountId: '',
      accessKeyId: '',
      secretAccessKey: '',
      bucket: '',
      pathPrefix: '',
      publicUrlBase: '',
    },
    recentImagesInCloud: false,
  };
}

export function loadSettings(): CloudSettings {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultSettings();
  try {
    const parsed = JSON.parse(raw) as Partial<CloudSettings>;
    const base = defaultSettings();
    return {
      s3: { ...base.s3, ...(parsed.s3 ?? {}) },
      r2: { ...base.r2, ...(parsed.r2 ?? {}) },
      recentImagesInCloud: parsed.recentImagesInCloud ?? base.recentImagesInCloud,
    };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings: CloudSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function clearSettings(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function hasAnyEnabled(settings: CloudSettings): boolean {
  return settings.s3.enabled || settings.r2.enabled;
}

export function primaryProvider(settings: CloudSettings): 's3' | 'r2' | null {
  if (settings.s3.enabled) return 's3';
  if (settings.r2.enabled) return 'r2';
  return null;
}
