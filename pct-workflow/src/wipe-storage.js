import { ensure } from './state.js';

const B2_HOST = 'https://api.backblazeb2.com';
const B2_BATCH = 24;
const R2_BATCH = 100;
const ID = /^pct_[a-f0-9]{24}$/;

function apiOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname.endsWith('.backblazeb2.com') &&
        url.origin === url.href.replace(/\/$/, '')) return url.origin;
  } catch { /* invalid provider address */ }
  throw new Error('wipe_storage_invalid_host');
}

const validPage = (entries, limit, owns) => Array.isArray(entries) && entries.length <= limit && entries.every(owns);

export async function caseFileStore(env, id, { fetcher = fetch, signal = AbortSignal.timeout(18_000) } = {}) {
  ensure(ID.test(id || ''), 'Case not found.', 404, 'not_found');
  const prefix = `pct-workflow/cases/${id}/`;
  const owns = key => typeof key === 'string' && key.startsWith(prefix) && key.length > prefix.length;
  if (env.PCT_STORE) {
    const bucket = env.PCT_STORE;
    const list = async limit => {
      signal.throwIfAborted();
      const page = await bucket.list({ prefix, limit });
      if (!validPage(page?.objects, limit, o => owns(o?.key)) || typeof page.truncated !== 'boolean') {
        throw new Error('wipe_storage_invalid_listing');
      }
      return { items:page.objects.map(o => o.key), more:page.truncated };
    };
    return { check: () => list(1), async purge() {
      const page = await list(R2_BATCH);
      signal.throwIfAborted();
      if (page.items.length) await bucket.delete(page.items);
      const remaining = await list(1);
      return remaining.items.length === 0 && !remaining.more;
    } };
  }

  const request = async (url, headers, body) => {
    signal.throwIfAborted();
    const r = await fetcher(url, {
      redirect:'manual', signal, headers:{ ...headers, ...(body ? {'content-type':'application/json'} : {}) },
      ...(body ? {method:'POST', body:JSON.stringify(body)} : {}),
    });
    const value = await r.json().catch(() => null);
    if (r.ok && value) return value;
    if (r.status === 400 && value?.code === 'file_not_present' && url.endsWith('/b2_delete_file_version')) return null;
    throw new Error('wipe_storage_request_failed');
  };
  const credentials = btoa(`${env.B2_KEY_ID}:${env.B2_APPLICATION_KEY}`);
  const auth = await request(B2_HOST + '/b2api/v4/b2_authorize_account', {authorization:`Basic ${credentials}`});
  const storage = auth?.apiInfo?.storageApi, allowed = storage?.allowed;
  const buckets = allowed?.buckets;
  ensure(Array.isArray(buckets) && buckets.length === 1 && buckets[0]?.id === env.B2_BUCKET_ID &&
    ['pct-workflow/', 'pct-workflow/cases/', prefix].includes(allowed.namePrefix) &&
    ['listFiles','deleteFiles'].every(cap => allowed.capabilities?.includes(cap)) &&
    typeof auth.authorizationToken === 'string' && auth.authorizationToken.length > 0,
  'The Backblaze key must be scoped to the private PCT bucket and allow listing and deleting file versions.', 503, 'wipe_storage_permission');
  const api = apiOrigin(storage.apiUrl) + '/b2api/v4/';
  const headers = {authorization:auth.authorizationToken};
  const list = async limit => {
    const page = await request(api+'b2_list_file_versions', headers, {bucketId:env.B2_BUCKET_ID,prefix,maxFileCount:limit});
    if (!validPage(page?.files, limit, file => owns(file?.fileName) && typeof file.fileId === 'string' && file.fileId.length > 0) ||
        (page.nextFileName != null && !owns(page.nextFileName))) throw new Error('wipe_storage_invalid_listing');
    return {items:page.files, more:page.nextFileName != null || page.nextFileId != null};
  };
  return { check: () => list(1), async purge() {
    const page = await list(B2_BATCH);
    for (let i=0;i<page.items.length;i+=4) {
      const results = await Promise.allSettled(page.items.slice(i,i+4).map(({fileName,fileId}) =>
        request(api+'b2_delete_file_version',headers,{fileName,fileId}),
      ));
      if (results.some(r => r.status !== 'fulfilled')) throw new Error('wipe_storage_delete_incomplete');
    }
    const remaining = await list(1);
    return remaining.items.length === 0 && !remaining.more;
  } };
}
