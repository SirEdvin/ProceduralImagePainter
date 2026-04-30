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

export type CloudProvider = 's3' | 'r2';

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

export function enabledProviders(settings: CloudSettings): CloudProvider[] {
  const providers: CloudProvider[] = [];
  if (settings.r2.enabled) providers.push('r2');
  if (settings.s3.enabled) providers.push('s3');
  return providers;
}

export function primaryProvider(settings: CloudSettings): CloudProvider | null {
  return enabledProviders(settings)[0] ?? null;
}

export function providerDisplayName(provider: CloudProvider): string {
  return provider === 'r2' ? 'Cloudflare R2' : 'Amazon S3';
}

function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function missingFields<T extends object>(
  settings: T,
  fields: Array<[keyof T, string]>,
): string[] {
  return fields
    .filter(([key]) => !String(settings[key] ?? '').trim())
    .map(([, label]) => label);
}

export function s3SettingsError(s: S3Settings): string | null {
  const missing = missingFields(s, [
    ['accessKeyId', 'Access Key ID'],
    ['secretAccessKey', 'Secret Access Key'],
    ['region', 'Region'],
    ['bucket', 'Bucket'],
  ]);
  const errors: string[] = [];
  if (missing.length > 0) {
    errors.push(`missing ${formatList(missing)}`);
  }
  if (s.bucket && /[\\/?#]/.test(s.bucket)) {
    errors.push('Bucket must be a bucket name only, not a path or URL.');
  }
  if (s.region && /^https?:\/\//i.test(s.region)) {
    errors.push('Region must be a region name like us-east-1, not a URL.');
  }
  return errors.length > 0 ? `${providerDisplayName('s3')} settings are invalid: ${errors.join(' ')}` : null;
}

export function r2SettingsError(r: R2Settings): string | null {
  const missing = missingFields(r, [
    ['accountId', 'Account ID'],
    ['accessKeyId', 'Access Key ID'],
    ['secretAccessKey', 'Secret Access Key'],
    ['bucket', 'Bucket'],
  ]);
  const errors: string[] = [];
  if (missing.length > 0) {
    errors.push(`missing ${formatList(missing)}`);
  }
  if (r.accountId && (/^https?:\/\//i.test(r.accountId) || /r2\.cloudflarestorage\.com/i.test(r.accountId))) {
    errors.push('Account ID must be the Cloudflare account ID only, not the R2 endpoint URL.');
  } else if (r.accountId && /[\\/?#]/.test(r.accountId)) {
    errors.push('Account ID must not contain slashes, query strings, or fragments.');
  }
  if (r.bucket && /[\\/?#]/.test(r.bucket)) {
    errors.push('Bucket must be a bucket name only, not a path or URL.');
  }
  return errors.length > 0 ? `${providerDisplayName('r2')} settings are invalid: ${errors.join(' ')}` : null;
}

export function providerSettingsError(provider: CloudProvider, settings: CloudSettings): string | null {
  return provider === 'r2' ? r2SettingsError(settings.r2) : s3SettingsError(settings.s3);
}

export function validateEnabledProviderSettings(settings: CloudSettings): string[] {
  return enabledProviders(settings)
    .map((provider) => providerSettingsError(provider, settings))
    .filter((error): error is string => error !== null);
}

export function validateCloudSettings(settings: CloudSettings): string[] {
  const errors = validateEnabledProviderSettings(settings);
  if (settings.recentImagesInCloud && !hasAnyEnabled(settings)) {
    errors.push('Recent template images are set to cloud storage, but neither Cloudflare R2 nor Amazon S3 is enabled.');
  }
  return errors;
}
