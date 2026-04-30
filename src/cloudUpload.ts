import { AwsClient } from 'aws4fetch';
import type { CloudSettings, R2Settings, S3Settings } from './settings';

export type Provider = 's3' | 'r2';

export interface UploadResult {
  provider: Provider;
  url: string;
}

export interface UploadFailure {
  provider: Provider;
  error: string;
}

export interface CloudObjectRef {
  provider: Provider;
  key: string;
  url: string;
}

function joinKey(prefix: string, filename: string): string {
  const trimmed = prefix.replace(/^\/+/, '').replace(/\/+$/, '');
  return trimmed ? `${trimmed}/${filename}` : filename;
}

function publicUrl(base: string, key: string, fallback: string): string {
  if (!base) return fallback;
  const trimmed = base.replace(/\/+$/, '');
  return `${trimmed}/${key}`;
}

function s3Endpoint(s: S3Settings, key: string): string {
  return `https://${s.bucket}.s3.${s.region}.amazonaws.com/${encodeURI(key)}`;
}

function r2Endpoint(r: R2Settings, key: string): string {
  return `https://${r.accountId}.r2.cloudflarestorage.com/${r.bucket}/${encodeURI(key)}`;
}

function s3Client(s: S3Settings): AwsClient {
  return new AwsClient({
    accessKeyId: s.accessKeyId,
    secretAccessKey: s.secretAccessKey,
    region: s.region,
    service: 's3',
  });
}

function r2Client(r: R2Settings): AwsClient {
  return new AwsClient({
    accessKeyId: r.accessKeyId,
    secretAccessKey: r.secretAccessKey,
    region: 'auto',
    service: 's3',
  });
}

function clientForProvider(provider: Provider, settings: CloudSettings): { client: AwsClient; endpoint: (key: string) => string; publicBase: string } {
  if (provider === 's3') {
    if (!settings.s3.accessKeyId || !settings.s3.secretAccessKey || !settings.s3.region || !settings.s3.bucket) {
      throw new Error('S3 settings are incomplete');
    }
    return {
      client: s3Client(settings.s3),
      endpoint: (k) => s3Endpoint(settings.s3, k),
      publicBase: settings.s3.publicUrlBase,
    };
  }
  if (!settings.r2.accountId || !settings.r2.accessKeyId || !settings.r2.secretAccessKey || !settings.r2.bucket) {
    throw new Error('R2 settings are incomplete');
  }
  return {
    client: r2Client(settings.r2),
    endpoint: (k) => r2Endpoint(settings.r2, k),
    publicBase: settings.r2.publicUrlBase,
  };
}

function prefixForProvider(provider: Provider, settings: CloudSettings): string {
  return provider === 's3' ? settings.s3.pathPrefix : settings.r2.pathPrefix;
}

export async function uploadToS3(
  blob: Blob,
  filename: string,
  contentType: string,
  s: S3Settings,
): Promise<string> {
  if (!s.accessKeyId || !s.secretAccessKey || !s.region || !s.bucket) {
    throw new Error('S3 settings are incomplete');
  }
  const key = joinKey(s.pathPrefix, filename);
  const endpoint = s3Endpoint(s, key);
  const body = await blob.arrayBuffer();
  const res = await s3Client(s).fetch(endpoint, {
    method: 'PUT',
    body,
    headers: { 'Content-Type': contentType },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`S3 upload failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return publicUrl(s.publicUrlBase, key, endpoint);
}

export async function uploadToR2(
  blob: Blob,
  filename: string,
  contentType: string,
  r: R2Settings,
): Promise<string> {
  if (!r.accountId || !r.accessKeyId || !r.secretAccessKey || !r.bucket) {
    throw new Error('R2 settings are incomplete');
  }
  const key = joinKey(r.pathPrefix, filename);
  const endpoint = r2Endpoint(r, key);
  const body = await blob.arrayBuffer();
  const res = await r2Client(r).fetch(endpoint, {
    method: 'PUT',
    body,
    headers: { 'Content-Type': contentType },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`R2 upload failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return publicUrl(r.publicUrlBase, key, endpoint);
}

export async function uploadToAllEnabled(
  blob: Blob,
  filename: string,
  contentType: string,
  settings: CloudSettings,
): Promise<{ results: UploadResult[]; failures: UploadFailure[] }> {
  const tasks: Promise<UploadResult | UploadFailure>[] = [];
  if (settings.s3.enabled) {
    tasks.push(
      uploadToS3(blob, filename, contentType, settings.s3)
        .then<UploadResult>((url) => ({ provider: 's3', url }))
        .catch<UploadFailure>((e) => ({ provider: 's3', error: String(e?.message ?? e) })),
    );
  }
  if (settings.r2.enabled) {
    tasks.push(
      uploadToR2(blob, filename, contentType, settings.r2)
        .then<UploadResult>((url) => ({ provider: 'r2', url }))
        .catch<UploadFailure>((e) => ({ provider: 'r2', error: String(e?.message ?? e) })),
    );
  }
  const settled = await Promise.all(tasks);
  const results: UploadResult[] = [];
  const failures: UploadFailure[] = [];
  for (const item of settled) {
    if ('url' in item) results.push(item);
    else failures.push(item);
  }
  return { results, failures };
}

export async function uploadToProvider(
  provider: Provider,
  blob: Blob,
  filename: string,
  contentType: string,
  settings: CloudSettings,
): Promise<CloudObjectRef> {
  const { client, endpoint, publicBase } = clientForProvider(provider, settings);
  const key = joinKey(prefixForProvider(provider, settings), filename);
  const ep = endpoint(key);
  const body = await blob.arrayBuffer();
  const res = await client.fetch(ep, {
    method: 'PUT',
    body,
    headers: { 'Content-Type': contentType },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${provider.toUpperCase()} upload failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return { provider, key, url: publicUrl(publicBase, key, ep) };
}

export async function downloadFromCloud(
  provider: Provider,
  key: string,
  settings: CloudSettings,
): Promise<Blob> {
  const { client, endpoint } = clientForProvider(provider, settings);
  const res = await client.fetch(endpoint(key), { method: 'GET' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${provider.toUpperCase()} download failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return await res.blob();
}

export async function deleteFromCloud(
  provider: Provider,
  key: string,
  settings: CloudSettings,
): Promise<void> {
  const { client, endpoint } = clientForProvider(provider, settings);
  const res = await client.fetch(endpoint(key), { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw new Error(`${provider.toUpperCase()} delete failed (${res.status}): ${text.slice(0, 200)}`);
  }
}
