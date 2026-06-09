// POST a recording bundle (eeg.bin + optional epochs.bin) to the Modal cloud
// endpoint, authenticated with the current Supabase JWT. Returns the
// server-assigned session_id on success.
//
// When firmware BLE lands, the byte source changes from expo-document-picker
// to a streamed BLE buffer — this function's signature stays the same.

import { getSupabase } from '../auth/supabase';
import {
  NetworkError,
  NotAuthenticatedError,
  ServerError,
  UploadError,
} from './errors';

const MODAL_ENDPOINT_URL = process.env.EXPO_PUBLIC_MODAL_ENDPOINT_URL ?? '';

export type UploadInput = {
  eeg: { uri: string; name: string };
  epochs?: { uri: string; name: string };
};

export type UploadResult = {
  sessionId: string;
};

export async function uploadRecording(input: UploadInput): Promise<UploadResult> {
  if (!MODAL_ENDPOINT_URL) {
    throw new UploadError('EXPO_PUBLIC_MODAL_ENDPOINT_URL is not set');
  }

  const supabase = getSupabase();
  if (!supabase) throw new NotAuthenticatedError();

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new NotAuthenticatedError();
  }
  const token = data.session.access_token;

  // React Native's fetch supports FormData with { uri, name, type } file refs.
  // The runtime turns these into multipart/form-data parts without us having
  // to read the bytes into memory — important for large overnight BIN files.
  const form = new FormData();
  appendFile(form, 'eeg', input.eeg);
  if (input.epochs) appendFile(form, 'epochs', input.epochs);

  let response: Response;
  try {
    response = await fetch(MODAL_ENDPOINT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  } catch (e) {
    throw new NetworkError(e);
  }

  if (!response.ok) {
    let detail = await safeReadText(response);
    throw new ServerError(response.status, detail);
  }

  const body = await response.json().catch(() => null);
  const sessionId = body?.session_id;
  if (typeof sessionId !== 'string') {
    throw new ServerError(response.status, 'response missing session_id');
  }
  return { sessionId };
}

function appendFile(form: FormData, name: string, file: { uri: string; name: string }) {
  // RN FormData accepts this shape — TypeScript's lib.dom.d.ts FormData doesn't,
  // so we cast. The runtime serializes it correctly into multipart parts.
  form.append(name, {
    uri: file.uri,
    name: file.name,
    type: 'application/octet-stream',
  } as unknown as Blob);
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '(no body)';
  }
}
