// @vitest-environment jsdom
// F-029, PM-1 to PM-4: the seller shows the item. The requirement is visible before anything is added; a file that
// needs another look is said plainly; the guided camera has a refused state and a plain-picker fallback.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProofCapture, type ProofCaptureProps } from '../src/trade/proof/ProofCapture';
import { expectNoAxeViolations } from './axe';
import { answerWith, callsTo, id, renderWithApi, type CallFn } from './support/workspace';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
let uploads = 0;

const serve = () =>
  answerWith(api.call, {
    'POST /files/upload-url': () => {
      uploads += 1;
      return {
        fileId: id(89 + uploads),
        cloudName: 'komtru',
        uploadUrl: 'https://upload.test/x',
        params: { signature: 's' },
        maxBytes: 5_000_000,
        expiresAt: '2026-11-09T12:00:00.000Z',
      };
    },
    'POST /files/:id/finalize': ({ params }: { params?: Record<string, string> }) => ({
      fileId: params?.id,
      uploadState: 'PENDING',
    }),
  });

beforeEach(() => {
  api.call.mockReset();
  uploads = 0;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  serve();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const file = (name: string, type = 'image/jpeg', extra: Record<string, unknown> = {}) =>
  Object.assign(new File(['x'], name, { type, lastModified: 1 }), extra);

const show = (props: Partial<ProofCaptureProps> = {}) => {
  const onChange = vi.fn();
  const view = renderWithApi(
    api.call,
    <ProofCapture needs={{ photos: 3, video: true }} step="send" onChange={onChange} {...props} />,
  );
  const gallery = () =>
    view.container.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement;
  return { ...view, onChange, gallery };
};

const camera = (opts: { reject?: string } = {}) => {
  const stop = vi.fn();
  const getUserMedia = vi.fn(() =>
    opts.reject === undefined
      ? Promise.resolve({ getTracks: () => [{ stop }] })
      : Promise.reject(new DOMException('no', opts.reject)),
  );
  vi.stubGlobal('navigator', { ...navigator, onLine: true, mediaDevices: { getUserMedia } });
  return { getUserMedia, stop };
};

describe('PM-1: the requirement is visible before anything is added', () => {
  it('says what is required, what is missing, and offers the camera and the gallery', async () => {
    const { container } = show();
    expect(screen.getByRole('heading', { name: 'Show the item as it really is' })).toBeTruthy();
    const required = screen.getByLabelText('What’s required');
    expect(within(required).getByText('0 of 3')).toBeTruthy();
    expect(within(required).getByText('0 of 1')).toBeTruthy();
    expect(screen.getByText('Proof of the item needed')).toBeTruthy();
    expect(screen.getByText(/Attach 3 photos and a video of the item/)).toBeTruthy();
    expect(screen.getByText('Take a photo now')).toBeTruthy();
    expect(screen.getByText('Choose from my gallery')).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('counts each file in as it uploads, and tells the parent the ids and the photo and video counts', async () => {
    const { gallery, onChange } = show();
    fireEvent.change(gallery(), {
      target: { files: [file('a.jpg'), file('b.jpg'), file('v.mp4', 'video/mp4')] },
    });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(3);
    });
    expect(onChange).toHaveBeenLastCalledWith(
      [id(90), id(91), id(92)],
      { photos: 2, videos: 1 },
      expect.any(Array),
    );
    expect(screen.getByText('2 of 3')).toBeTruthy();
    expect(screen.getByText('1 of 1 ✓')).toBeTruthy();
    expect(screen.getByText(/Attach 1 more before you can send this proposal/)).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/files/:id/finalize')).toHaveLength(3);
  });

  it('takes a file back off', async () => {
    const { gallery, onChange } = show();
    fireEvent.change(gallery(), { target: { files: [file('a.jpg')] } });
    await screen.findByText('1 of 3');
    fireEvent.click(screen.getByRole('button', { name: 'Remove a.jpg' }));
    expect(onChange).toHaveBeenLastCalledWith([], { photos: 0, videos: 0 }, []);
  });

  it('says a file is too large, and that an upload that did not go through can be added again', async () => {
    api.call.mockReset();
    answerWith(api.call, {
      'POST /files/upload-url': {
        fileId: id(90),
        cloudName: 'k',
        uploadUrl: 'https://upload.test/x',
        params: {},
        maxBytes: 0,
        expiresAt: '2026-11-09T12:00:00.000Z',
      },
    });
    const { gallery } = show();
    fireEvent.change(gallery(), { target: { files: [file('big.jpg')] } });
    expect(await screen.findByText('big.jpg is too large. Choose a smaller file.')).toBeTruthy();
  });

  it('stops asking for uploads while the device is offline, and says so', () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    show();
    expect(screen.getByText('You’re offline')).toBeTruthy();
    expect(screen.getByLabelText('Choose from my gallery').hasAttribute('disabled')).toBe(true);
  });
});

describe('PM-3: a photo that needs another look', () => {
  it('flags an empty file in plain words, uploads nothing, and offers one way forward', async () => {
    const { gallery, container } = show();
    fireEvent.change(gallery(), { target: { files: [new File([], 'photo_2.jpg', { type: 'image/jpeg' })] } });
    expect(await screen.findByRole('heading', { name: 'One photo needs replacing' })).toBeTruthy();
    expect(screen.getByText('photo_2.jpg')).toBeTruthy();
    expect(screen.getByText('Too small to show the item clearly')).toBeTruthy();
    expect(screen.queryByText(/AI-generated/)).toBeNull();
    expect(screen.getByText(/isn’t in the app yet/)).toBeTruthy();
    expect(screen.getByText('Retake this photo')).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/files/upload-url')).toHaveLength(0);
    await expectNoAxeViolations(container);
    fireEvent.click(screen.getByRole('button', { name: 'Remove it' }));
    expect(screen.queryByRole('heading', { name: 'One photo needs replacing' })).toBeNull();
  });

  it('flags something that is not a photo or video, and the same file added twice', async () => {
    const { gallery } = show();
    fireEvent.change(gallery(), { target: { files: [file('a.pdf', 'application/pdf')] } });
    expect(await screen.findByText('This isn’t a photo or a video')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove it' }));
    fireEvent.change(gallery(), { target: { files: [file('a.jpg')] } });
    await screen.findByText('1 of 3');
    fireEvent.change(gallery(), { target: { files: [file('a.jpg')] } });
    expect(await screen.findByText('You’ve already added this one')).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/files/upload-url')).toHaveLength(1);
  });
});

describe('PM-3: a batch with files turned away in it', () => {
  const empty = (name: string) => new File([], name, { type: 'image/jpeg' });

  it('keeps every file turned away, and a good file in the same batch does not clear the flag', async () => {
    const { gallery, onChange } = show();
    fireEvent.change(gallery(), { target: { files: [empty('tiny.jpg'), file('good.jpg')] } });
    expect(await screen.findByRole('heading', { name: 'One photo needs replacing' })).toBeTruthy();
    expect(screen.getByText('tiny.jpg', { selector: 'b, div, span' })).toBeTruthy();
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole('heading', { name: 'One photo needs replacing' })).toBeTruthy();
    // Another good file, later, still leaves the flag where it is.
    fireEvent.change(gallery(), { target: { files: [file('also-good.jpg')] } });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByRole('heading', { name: 'One photo needs replacing' })).toBeTruthy();
  });

  it('shows all of several files turned away, not just the last', async () => {
    const { gallery } = show();
    fireEvent.change(gallery(), { target: { files: [empty('bad1.jpg'), empty('bad2.jpg')] } });
    expect(await screen.findByRole('heading', { name: '2 photos need replacing' })).toBeTruthy();
    expect(screen.getAllByText(/^bad[12]\.jpg$/, { selector: 'b, div, span' })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Remove them' }));
    expect(screen.queryByRole('heading', { name: /need replacing/ })).toBeNull();
  });

  it('announces it and moves focus to the heading, so it is heard without seeing the outlined tile', async () => {
    const { gallery } = show();
    fireEvent.change(gallery(), { target: { files: [empty('bad.jpg')] } });
    const heading = await screen.findByRole('heading', { name: 'One photo needs replacing' });
    expect(heading.closest('[role="alert"]')).not.toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
  });

  it('replaces the flagged photo only when the retake comes, and keeps the flag if the camera is closed first', async () => {
    camera();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) => {
      done(new Blob(['x'], { type: 'image/jpeg' }));
    });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { value: 1200, configurable: true });
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      value: () => Promise.resolve(),
      configurable: true,
    });
    const { gallery, onChange } = show();
    fireEvent.change(gallery(), { target: { files: [empty('bad.jpg')] } });
    await screen.findByRole('heading', { name: 'One photo needs replacing' });
    fireEvent.click(screen.getByRole('button', { name: 'Retake this photo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Take photos' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('heading', { name: 'One photo needs replacing' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retake this photo' }));
    const again = await screen.findByRole('dialog', { name: 'Take photos' });
    const shutter = within(again).getByRole<HTMLButtonElement>('button', { name: 'Take photo' });
    await waitFor(() => {
      expect(shutter.disabled).toBe(false);
    });
    fireEvent.click(shutter);
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /needs replacing/ })).toBeNull();
    });
  });

  it('turns away a photo the browser cannot open, but lets an iPhone HEIC through for the platform to judge', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('cannot decode')));
    const { gallery, onChange } = show();
    fireEvent.change(gallery(), { target: { files: [file('broken.jpg')] } });
    expect(await screen.findByText('We couldn’t open this photo. It may be damaged')).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/files/upload-url')).toHaveLength(0);
    fireEvent.change(gallery(), { target: { files: [file('IMG_1.heic', 'image/heic')] } });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
  });

  it('lets a legitimately small photo through', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 599, height: 799, close: () => undefined }),
    );
    const { gallery, onChange } = show();
    fireEvent.change(gallery(), { target: { files: [file('old-phone.jpg')] } });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
  });
});

describe('PM-4: ready', () => {
  it('says the proof is ready, counts extras, and says what happens to it next', async () => {
    const { gallery, container } = show();
    fireEvent.change(gallery(), {
      target: {
        files: [file('1.jpg'), file('2.jpg'), file('3.jpg'), file('4.jpg'), file('v.mp4', 'video/mp4')],
      },
    });
    expect(await screen.findByRole('heading', { name: 'Your proof is ready' })).toBeTruthy();
    expect(screen.getByText('Four photos and one video, added from this device.')).toBeTruthy();
    expect(screen.getByText('4 of 3 ✓')).toBeTruthy();
    expect(screen.queryByText('Proof of the item needed')).toBeNull();
    const next = screen.getByLabelText('What happens next');
    expect(within(next).getByText('You can change it until you send')).toBeTruthy();
    expect(within(next).getByText('It’s kept with the Trade once it’s agreed')).toBeTruthy();
    await expectNoAxeViolations(container);
  });
});

describe('PM-2: the camera is let go of on every path', () => {
  it('stops a stream that arrives after the sheet has closed', async () => {
    const stop = vi.fn();
    let resolve: (stream: unknown) => void = () => undefined;
    const getUserMedia = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    vi.stubGlobal('navigator', { ...navigator, onLine: true, mediaDevices: { getUserMedia } });
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Take a photo now' }));
    const dialog = await screen.findByRole('dialog', { name: 'Take photos' });
    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalled();
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    resolve({ getTracks: () => [{ stop }] });
    await waitFor(() => {
      expect(stop).toHaveBeenCalledTimes(1);
    });
  });

  it('stops the stream when the whole screen goes while the camera is open', async () => {
    const { stop } = camera();
    const { unmount } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Take a photo now' }));
    await screen.findByRole('dialog', { name: 'Take photos' });
    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });
    await new Promise((done) => setTimeout(done, 0));
    unmount();
    expect(stop).toHaveBeenCalled();
  });

  it('passes the accessibility check with the camera sheet open, live and refused', async () => {
    camera();
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Take a photo now' }));
    await screen.findByRole('dialog', { name: 'Take photos' });
    await expectNoAxeViolations(document.body);
    cleanup();
    camera({ reject: 'NotAllowedError' });
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Take a photo now' }));
    await screen.findByText('The camera is off for Komtru');
    await expectNoAxeViolations(document.body);
  });
});

describe('PM-2: the guided camera', () => {
  it('opens the camera on the first shot, takes a shot into the proof, and lets go of the camera', async () => {
    const { stop } = camera();
    const toBlob = vi.fn((done: (blob: Blob) => void) => {
      done(new Blob(['x'], { type: 'image/jpeg' }));
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(toBlob);
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { value: 1200, configurable: true });
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      value: () => Promise.resolve(),
      configurable: true,
    });
    const { onChange } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Take a photo now' }));
    const dialog = await screen.findByRole('dialog', { name: 'Take photos' });
    expect(within(dialog).getByText('1 of 4')).toBeTruthy();
    const shutter = within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Take photo' });
    await waitFor(() => {
      expect(shutter.disabled).toBe(false);
    });
    expect(within(dialog).getByText('Shot 1 · Front of the item')).toBeTruthy();
    fireEvent.click(shutter);
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByAltText(/komtru-front-/)).toBeTruthy();
    await screen.findByText('Shot 2 · Back of the item');
    expect(within(dialog).getByText('Front ✓')).toBeTruthy();
    expect(within(dialog).getByText('Record the video next')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(stop).toHaveBeenCalled();
  });

  it('says plainly when the camera is refused, and offers the gallery instead', async () => {
    camera({ reject: 'NotAllowedError' });
    const { onChange } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Take a photo now' }));
    const dialog = await screen.findByRole('dialog', { name: 'Take photos' });
    expect(await within(dialog).findByText('The camera is off for Komtru')).toBeTruthy();
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Take photo' }).disabled).toBe(true);
    const input = within(dialog).getByLabelText('Choose from my gallery');
    fireEvent.change(input, { target: { files: [file('g.jpg')] } });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
  });

  it('says so when there is no camera to open', async () => {
    camera({ reject: 'NotFoundError' });
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Take a photo now' }));
    expect(await screen.findByText('We couldn’t open a camera')).toBeTruthy();
  });

  it('falls back to the device’s own camera picker where getUserMedia is unavailable', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: true, mediaDevices: undefined });
    const { container, onChange } = show();
    expect(screen.queryByRole('button', { name: 'Take a photo now' })).toBeNull();
    const capture = container.querySelector<HTMLInputElement>('input[capture="environment"]');
    expect(capture).not.toBeNull();
    fireEvent.change(capture as HTMLInputElement, { target: { files: [file('c.jpg')] } });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
  });
});
