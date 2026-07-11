// Shared between the main thread (compose.jsx) and the service worker
// (public/sw.js) -- both get bundled through Vite (the service worker
// uses VitePWA's `injectManifest` strategy, which runs it through the
// normal build, so plain ES module imports work there too, same as
// anywhere else in the app).
//
// This is the freelimbo fork's fix for a real gap in the original
// (compose.jsx-only) inline-video-upload design: that design ran the
// YouTube upload + follow-up status edit as a plain fetch from the
// compose page itself, not awaited by the submit handler so the
// composer wouldn't block. That works fine as long as the page/tab
// stays alive for as long as the upload takes -- but two different
// things can kill it before it's done: closing Phanpy's popped-out
// compose window (partially mitigated separately, see compose.jsx's
// pendingVideoUploads), and, more commonly on mobile, the browser
// backgrounding/throttling the tab -- e.g. launching the real camera
// app to record a video backgrounds Chrome for the whole recording, and
// it's very natural to lock the phone right after hitting "Post" since
// the composer closes immediately either way.
//
// The Background Sync API exists for exactly this: register a task,
// and the browser guarantees it'll run in the service worker (which
// persists independent of any open tab) as soon as there's
// connectivity, retrying automatically on failure, whether or not the
// page that registered it is still open. Support is real but not
// universal -- solid on Chrome/Edge (including Android, which is what
// actually matters here), absent on Safari -- so compose.jsx falls
// back to the original direct-fetch-from-the-page behavior when
// supportsBackgroundSync() is false.
import { del, entries, set } from 'idb-keyval';

// idb-keyval's default store is a flat, shared keyspace -- prefix our
// keys so we don't collide with any other idb-keyval usage in this app,
// and can cheaply filter our own entries back out of it.
const KEY_PREFIX = 'freelimbo-video-upload:';

export const VIDEO_UPLOAD_SYNC_TAG = 'freelimbo-video-upload-sync';

export function supportsBackgroundSync() {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'SyncManager' in window
  );
}

function jobKey(statusId, token) {
  return `${KEY_PREFIX}${statusId}:${token}`;
}

// job shape:
// {
//   file: Blob,             // the video itself (idb-keyval/IndexedDB
//                            // stores Blobs natively via structured
//                            // clone -- no base64 encoding needed)
//   fileName: string,
//   instance: string,       // domain, e.g. "social.freelimbo.com"
//   accessToken: string,
//   statusId: string,       // groups jobs from the same post -- see
//                            // processVideoUploadJobGroup for why this
//                            // matters
//   originalText: string,   // status text as originally posted, still
//                            // containing every job's placeholder in
//                            // this group (identical across the whole
//                            // group -- they're all from one submit)
//   baseParams: object,     // params object used for the original
//                            // masto.v1.statuses.create/update call,
//                            // reused (with `status` overwritten) for
//                            // the follow-up edit
//   placeholder: string,    // exact placeholder substring to replace,
//                            // e.g. "[uploading-video:172...-0]"
//   uploadedUrl: string | undefined,   // set once the YouTube upload
//                            // itself succeeds
//   failed: boolean | undefined,       // set if this job terminally
//                            // failed (won't succeed on retry)
// }

export async function saveVideoUploadJob(statusId, token, job) {
  await set(jobKey(statusId, token), job);
}

async function updateVideoUploadJob(statusId, token, patch) {
  const key = jobKey(statusId, token);
  const all = await entries();
  const existing = all.find(([k]) => k === key)?.[1];
  if (!existing) return;
  await set(key, { ...existing, ...patch });
}

async function deleteVideoUploadJob(statusId, token) {
  await del(jobKey(statusId, token));
}

export async function listVideoUploadJobs() {
  const all = await entries();
  return all
    .filter(([key]) => typeof key === 'string' && key.startsWith(KEY_PREFIX))
    .map(([key, job]) => {
      const rest = key.slice(KEY_PREFIX.length);
      const sep = rest.indexOf(':');
      return { statusId: rest.slice(0, sep), token: rest.slice(sep + 1), ...job };
    });
}

// Groups pending jobs by statusId -- every video attached to the same
// post shares one originalText/baseParams and must resolve into a
// *single* combined status edit, not one edit per video. Editing once
// per video independently would race: each job would build its edit off
// whatever originalText it was given at submit time, so a job that
// finishes after another already edited the post would overwrite that
// edit with its own stale copy of the text, undoing it.
export async function groupVideoUploadJobsByStatus() {
  const jobs = await listVideoUploadJobs();
  const groups = new Map();
  for (const job of jobs) {
    if (!groups.has(job.statusId)) groups.set(job.statusId, []);
    groups.get(job.statusId).push(job);
  }
  return groups;
}

// Processes every job in one post's group: uploads whichever videos
// haven't uploaded yet (in parallel -- independent YouTube uploads, no
// shared state between them), then, only once every job in the group
// has either a real URL or a terminal failure, performs ONE combined
// status edit replacing every placeholder at once and clears the whole
// group. If any job is still stuck on a retryable failure, no edit
// happens this round -- whatever already succeeded stays recorded
// (uploadedUrl persisted per job) so next sync's retry doesn't redo it.
//
// Throws if anything in the group is still retryable, so the caller
// (the service worker's sync handler) knows to let Background Sync
// retry later.
export async function processVideoUploadJobGroup(statusId, jobs) {
  const results = await Promise.allSettled(
    jobs.map(async (job) => {
      if (job.uploadedUrl || job.failed) return job;
      try {
        const url = await uploadToYouTube(job);
        await updateVideoUploadJob(statusId, job.token, { uploadedUrl: url });
        return { ...job, uploadedUrl: url };
      } catch (err) {
        // Default to retryable: a raw fetch() rejection (dropped
        // connection, the browser cutting off this service worker's
        // execution time budget mid-upload, etc.) has no `.retryable`
        // property at all, and undefined must NOT be treated the same
        // as `false` here -- those are exactly the kind of transient
        // failures Background Sync exists to retry. Only the errors
        // this file explicitly constructs with `retryable: false`
        // (uploadToYouTube's 4xx / malformed-response cases) should
        // actually give up.
        if (err?.retryable !== false) throw err;
        await updateVideoUploadJob(statusId, job.token, { failed: true });
        return { ...job, failed: true };
      }
    }),
  );

  const stillRetrying = results.some((r) => r.status === 'rejected');
  if (stillRetrying) {
    throw new Error(
      `Group ${statusId}: one or more video uploads still retryable`,
    );
  }

  const resolvedJobs = results.map((r) => r.value);

  // Every job in the group is now either uploaded or terminally failed
  // -- safe to do the one combined edit.
  let text = resolvedJobs[0].originalText;
  for (const job of resolvedJobs) {
    text = text.replaceAll(
      job.placeholder,
      job.failed ? '[video upload to YouTube failed]' : job.uploadedUrl,
    );
  }

  const first = resolvedJobs[0];
  await editStatusText(first, text);

  for (const job of resolvedJobs) {
    await deleteVideoUploadJob(statusId, job.token);
  }
}

async function uploadToYouTube(job) {
  const form = new FormData();
  form.append('file', job.file, job.fileName || 'video');
  const res = await fetch(`https://${job.instance}/api/v1/media/youtube`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${job.accessToken}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.error || `YouTube upload failed (${res.status})`;
    throw Object.assign(new Error(message), { retryable: res.status >= 500 });
  }
  const data = await res.json();
  if (!data?.url) {
    throw Object.assign(new Error('YouTube upload response had no url'), {
      retryable: false,
    });
  }
  return data.url;
}

async function editStatusText(job, text) {
  const res = await fetch(`https://${job.instance}/api/v1/statuses/${job.statusId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${job.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...job.baseParams, status: text }),
  });
  if (!res.ok) {
    throw Object.assign(new Error(`Status edit failed (${res.status})`), {
      retryable: res.status >= 500,
    });
  }
}
