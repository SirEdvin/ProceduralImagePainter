import { AwsClient } from 'aws4fetch';
import type { CloudSettings, R2Settings, S3Settings } from './settings';

export interface UploadResult {
  provider: 's3' | 'r2';
  url: string;
}

export interface UploadFailure {
  provider: 's3' | 'r2';
  error: string;
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

async function blobBody(blob: Blob): Promise<ArrayBuffer> {
  return await blob.arrayBuffer();
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
  const client = new AwsClient({
    accessKeyId: s.accessKeyId,
    secretAccessKey: s.secretAccessKey,
    region: s.region,
    service: 's3',
  });
  const key = joinKey(s.pathPrefix, filename);
  const endpoint = `https://${s.bucket}.s3.${s.region}.amazonaws.com/${encodeURI(key)}`;
  const body = await blobBody(blob);
  const res = await client.fetch(endpoint, {
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
  const client = new AwsClient({
    accessKeyId: r.accessKeyId,
    secretAccessKey: r.secretAccessKey,
    region: 'auto',
    service: 's3',
  });
  const key = joinKey(r.pathPrefix, filename);
  const endpoint = `https://${r.accountId}.r2.cloudflarestorage.com/${r.bucket}/${encodeURI(key)}`;
  const body = await blobBody(blob);
  const res = await client.fetch(endpoint, {
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
