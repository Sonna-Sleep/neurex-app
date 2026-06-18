// Pre-Start live preview: connect + stream so the contact ring is live BEFORE the
// user commits to recording. Reuses the existing startStream UNCHANGED (no edits to
// the core recording path) by streaming to a throwaway session dir that is deleted
// on stop — so there's one packet decoder and zero risk to the recording flow. The
// few KB temp file lives only while previewing.
//
// One BLE link exists at a time: the Sleep screen stops the preview before calling
// startSession (the real recording reconnects fresh). Best-effort: any failure just
// means no ring, never a crash or a surfaced error.

import { Directory, Paths } from 'expo-file-system';

import {
  feedContactQuality,
  startContactQuality,
  stopContactQuality,
} from './contactQualityService';
import { bleClient } from './index';
import type { ConnectedDevice, StreamCallbacks, StreamHandle } from './types';

const PREVIEW_SESSION_ID = '__contact_preview__';
const PREVIEW_CONNECT_TIMEOUT_MS = 15_000;

let device: ConnectedDevice | null = null;
let handle: StreamHandle | null = null;
let starting = false;

function deletePreviewDir(): void {
  try {
    const dir = new Directory(new Directory(Paths.document, 'sessions'), PREVIEW_SESSION_ID);
    if (dir.exists) dir.delete();
  } catch {
    // best-effort cleanup
  }
}

export function isPreviewing(): boolean {
  return device != null || starting;
}

/** Connect + stream (non-persisted) so the ring goes live. No-op if already
 *  previewing. Swallows failures (preview is a bonus, never blocks the user). */
export async function startPreview(deviceId: string): Promise<void> {
  if (device || starting) return;
  starting = true;
  try {
    const d = await bleClient.connect(deviceId, { timeoutMs: PREVIEW_CONNECT_TIMEOUT_MS });
    const cb: StreamCallbacks = {
      onPacket: (pkt) => feedContactQuality(pkt.samples.map((s) => s.fp1_uV)),
      onError: () => undefined, // preview is best-effort
    };
    const h = await d.startStream(PREVIEW_SESSION_ID, cb);
    device = d;
    handle = h;
    startContactQuality();
  } catch (e) {
    if (__DEV__) console.warn('[contactPreview] start failed (no ring):', (e as Error)?.message);
    await stopPreview();
  } finally {
    starting = false;
  }
}

/** Stop the preview, disconnect, reset quality, and delete the temp dir. Safe to
 *  call when not previewing. Await before startSession so the BLE link is free. */
export async function stopPreview(): Promise<void> {
  const h = handle;
  const d = device;
  handle = null;
  device = null;
  stopContactQuality();
  if (h) await h.stop().catch(() => undefined);
  if (d) await d.disconnect().catch(() => undefined);
  deletePreviewDir();
}
