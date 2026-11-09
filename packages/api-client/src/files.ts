// Uploading a file the person owns: ask for a signed ticket, send the bytes straight to the storage
// provider, then tell the platform it landed. Mirrors `POST /files/upload-url` and `/files/:id/finalize`.
//
// The platform never sees the bytes. `uploadFile` is the whole three-step dance for a browser `File`.
import { z } from 'zod';
import { defineEndpoint } from './contracts.js';
import type { ApiClient } from './client.js';

const fileVisibilitySchema = z.enum(['PUBLIC', 'PRIVATE_OWNER', 'PRIVATE_CASE', 'INTERNAL_ONLY']);

export const uploadTicketSchema = z.object({
  fileId: z.uuid(),
  cloudName: z.string(),
  uploadUrl: z.url(),
  params: z.record(z.string(), z.string()),
  maxBytes: z.number(),
  expiresAt: z.string(),
});

export const requestUploadUrl = defineEndpoint({
  method: 'post',
  path: '/files/upload-url',
  scope: 'CONSUMER',
  retryable: false,
  schema: {
    body: z.object({
      category: z.string(),
      visibility: fileVisibilitySchema,
      contentType: z.string().min(3).max(120),
    }),
    response: uploadTicketSchema,
  },
});

export const finalizeUpload = defineEndpoint({
  method: 'post',
  path: '/files/:id/finalize',
  scope: 'CONSUMER',
  retryable: false,
  schema: {
    params: z.object({ id: z.uuid() }),
    response: z.object({ fileId: z.uuid(), uploadState: z.string() }),
  },
});

export class UploadError extends Error {
  constructor(
    message: string,
    readonly reason: 'TOO_LARGE' | 'REJECTED' | 'UNREACHABLE',
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

export interface UploadOptions {
  category: string;
  visibility: z.infer<typeof fileVisibilitySchema>;
  signal?: AbortSignal;
  /** Injected for tests; the browser's `fetch` otherwise. */
  fetchImpl?: typeof fetch;
}

/**
 * Uploads one file and returns its id. A file over the ticket's size limit is refused before a byte
 * is sent; a provider refusal or a dropped connection are different failures so a screen can say
 * whether trying again can help.
 */
export async function uploadFile(client: ApiClient, file: File, options: UploadOptions): Promise<string> {
  const doFetch = options.fetchImpl ?? fetch;
  const signal = options.signal ? { signal: options.signal } : {};
  const ticket = await client.call(
    requestUploadUrl,
    { body: { category: options.category, visibility: options.visibility, contentType: file.type } },
    signal,
  );
  if (file.size > ticket.maxBytes) {
    throw new UploadError('That file is too large', 'TOO_LARGE');
  }
  const form = new FormData();
  for (const [name, value] of Object.entries(ticket.params)) form.append(name, value);
  form.append('file', file);
  let response: Response;
  try {
    response = await doFetch(ticket.uploadUrl, { method: 'POST', body: form, ...signal });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new UploadError('The upload did not reach the storage service', 'UNREACHABLE');
  }
  if (!response.ok) throw new UploadError('The storage service refused that file', 'REJECTED');
  await client.call(finalizeUpload, { params: { id: ticket.fileId } }, signal);
  return ticket.fileId;
}
