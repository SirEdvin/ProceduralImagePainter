import { clearSettings, loadSettings, saveSettings, validateCloudSettings, type CloudSettings } from './settings';

interface SettingsForm {
  s3Enabled: HTMLInputElement;
  s3AccessKeyId: HTMLInputElement;
  s3SecretAccessKey: HTMLInputElement;
  s3Region: HTMLInputElement;
  s3Bucket: HTMLInputElement;
  s3PathPrefix: HTMLInputElement;
  s3PublicUrlBase: HTMLInputElement;
  r2Enabled: HTMLInputElement;
  r2AccountId: HTMLInputElement;
  r2AccessKeyId: HTMLInputElement;
  r2SecretAccessKey: HTMLInputElement;
  r2Bucket: HTMLInputElement;
  r2PathPrefix: HTMLInputElement;
  r2PublicUrlBase: HTMLInputElement;
  recentImagesInCloud: HTMLInputElement;
  saveBtn: HTMLButtonElement;
  clearBtn: HTMLButtonElement;
  status: HTMLDivElement;
}

function getForm(): SettingsForm {
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  return {
    s3Enabled: get<HTMLInputElement>('s3Enabled'),
    s3AccessKeyId: get<HTMLInputElement>('s3AccessKeyId'),
    s3SecretAccessKey: get<HTMLInputElement>('s3SecretAccessKey'),
    s3Region: get<HTMLInputElement>('s3Region'),
    s3Bucket: get<HTMLInputElement>('s3Bucket'),
    s3PathPrefix: get<HTMLInputElement>('s3PathPrefix'),
    s3PublicUrlBase: get<HTMLInputElement>('s3PublicUrlBase'),
    r2Enabled: get<HTMLInputElement>('r2Enabled'),
    r2AccountId: get<HTMLInputElement>('r2AccountId'),
    r2AccessKeyId: get<HTMLInputElement>('r2AccessKeyId'),
    r2SecretAccessKey: get<HTMLInputElement>('r2SecretAccessKey'),
    r2Bucket: get<HTMLInputElement>('r2Bucket'),
    r2PathPrefix: get<HTMLInputElement>('r2PathPrefix'),
    r2PublicUrlBase: get<HTMLInputElement>('r2PublicUrlBase'),
    recentImagesInCloud: get<HTMLInputElement>('recentImagesInCloud'),
    saveBtn: get<HTMLButtonElement>('settingsSaveBtn'),
    clearBtn: get<HTMLButtonElement>('settingsClearBtn'),
    status: get<HTMLDivElement>('settingsStatus'),
  };
}

function fillForm(f: SettingsForm, s: CloudSettings): void {
  f.s3Enabled.checked = s.s3.enabled;
  f.s3AccessKeyId.value = s.s3.accessKeyId;
  f.s3SecretAccessKey.value = s.s3.secretAccessKey;
  f.s3Region.value = s.s3.region;
  f.s3Bucket.value = s.s3.bucket;
  f.s3PathPrefix.value = s.s3.pathPrefix;
  f.s3PublicUrlBase.value = s.s3.publicUrlBase;
  f.r2Enabled.checked = s.r2.enabled;
  f.r2AccountId.value = s.r2.accountId;
  f.r2AccessKeyId.value = s.r2.accessKeyId;
  f.r2SecretAccessKey.value = s.r2.secretAccessKey;
  f.r2Bucket.value = s.r2.bucket;
  f.r2PathPrefix.value = s.r2.pathPrefix;
  f.r2PublicUrlBase.value = s.r2.publicUrlBase;
  f.recentImagesInCloud.checked = s.recentImagesInCloud;
}

function readForm(f: SettingsForm): CloudSettings {
  return {
    s3: {
      enabled: f.s3Enabled.checked,
      accessKeyId: f.s3AccessKeyId.value.trim(),
      secretAccessKey: f.s3SecretAccessKey.value.trim(),
      region: f.s3Region.value.trim(),
      bucket: f.s3Bucket.value.trim(),
      pathPrefix: f.s3PathPrefix.value.trim(),
      publicUrlBase: f.s3PublicUrlBase.value.trim(),
    },
    r2: {
      enabled: f.r2Enabled.checked,
      accountId: f.r2AccountId.value.trim(),
      accessKeyId: f.r2AccessKeyId.value.trim(),
      secretAccessKey: f.r2SecretAccessKey.value.trim(),
      bucket: f.r2Bucket.value.trim(),
      pathPrefix: f.r2PathPrefix.value.trim(),
      publicUrlBase: f.r2PublicUrlBase.value.trim(),
    },
    recentImagesInCloud: f.recentImagesInCloud.checked,
  };
}

function showStatus(el: HTMLDivElement, text: string, kind: 'ok' | 'error' = 'ok'): void {
  el.textContent = text;
  el.dataset.kind = kind;
  if (text && kind === 'ok') {
    setTimeout(() => {
      if (el.textContent === text) {
        el.textContent = '';
        delete el.dataset.kind;
      }
    }, 3000);
  }
}

export function initSettingsPage(): void {
  const f = getForm();
  fillForm(f, loadSettings());

  f.saveBtn.addEventListener('click', () => {
    try {
      const settings = readForm(f);
      const errors = validateCloudSettings(settings);
      if (errors.length > 0) {
        showStatus(f.status, errors.join(' '), 'error');
        return;
      }
      saveSettings(settings);
      showStatus(f.status, 'Saved.', 'ok');
    } catch (e) {
      showStatus(f.status, `Save failed: ${(e as Error).message}`, 'error');
    }
  });

  f.clearBtn.addEventListener('click', () => {
    if (!confirm('Remove all stored cloud storage credentials?')) return;
    clearSettings();
    fillForm(f, loadSettings());
    showStatus(f.status, 'Cleared.', 'ok');
  });
}
