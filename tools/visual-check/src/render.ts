// The one stage that needs a browser. Both sides go through the same Chromium, at the same device
// scale, with the same stylesheet injected, so the only thing left to differ is the design.
import { chromium, type Browser, type Page } from '@playwright/test';

import { fontStylesheet } from './fonts.ts';
import { REFERENCE_VIEWPORT, type CarvedScreen } from './reference.ts';

export { chromium };

export interface Shot {
  png: Buffer;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Launches Chromium and always closes it, so a thrown assertion cannot leak a browser process. */
export async function withBrowser<T>(run: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await chromium.launch();
  try {
    return await run(browser);
  } finally {
    await browser.close();
  }
}

async function settle(page: Page, injectFonts: boolean): Promise<void> {
  if (injectFonts) await page.addStyleTag({ content: fontStylesheet() });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

export interface ShootOptions {
  /** Off only in the test that proves the injected faces change what is rendered. */
  injectFonts?: boolean;
}

/**
 * The reference screen, clipped to the frame's content. The frame's children that are the mock
 * browser bezel are left out: a drawing of a URL bar is not something the built screen can match,
 * and leaving it in would put a guaranteed band of deviation at the top of every mobile shot.
 */
export async function shootReference(
  browser: Browser,
  carved: CarvedScreen,
  options: ShootOptions = {},
): Promise<Shot> {
  const page = await browser.newPage({
    viewport: { ...REFERENCE_VIEWPORT },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  try {
    await page.setContent(carved.document, { waitUntil: 'load' });
    await settle(page, options.injectFonts ?? true);

    const clip = await page.evaluate(() => {
      const frame = document.querySelector('[data-komtru-vc="frame"]');
      if (frame === null) return null;
      const screens = [...frame.children].filter(
        (child) => !child.classList.contains('mweb-chrome') && !child.classList.contains('dweb-chrome'),
      );
      if (screens.length === 0) return null;
      const boxes = screens.map((child) => child.getBoundingClientRect());
      const x = Math.min(...boxes.map((box) => box.left));
      const y = Math.min(...boxes.map((box) => box.top));
      return {
        x,
        y,
        width: Math.round(Math.max(...boxes.map((box) => box.right)) - x),
        height: Math.round(Math.max(...boxes.map((box) => box.bottom)) - y),
      };
    });

    if (clip === null || clip.width === 0 || clip.height === 0) {
      throw new Error(
        `${carved.row.id} renders no screen inside its ${carved.frame.classes.join('.')} frame`,
      );
    }
    // The page is as tall as it needs to be, but the viewport is not; without this the clip can
    // reach below the fold and Playwright returns a short image.
    await page.setViewportSize({
      width: REFERENCE_VIEWPORT.width,
      height: Math.max(REFERENCE_VIEWPORT.height, Math.ceil(clip.y + clip.height) + 1),
    });

    return { png: await page.screenshot({ clip }), width: clip.width, height: clip.height };
  } finally {
    await page.close();
  }
}

/** The built screen, at exactly the size the reference's frame turned out to be. */
export async function shootBuilt(
  browser: Browser,
  url: string,
  size: Size,
  options: ShootOptions = {},
): Promise<Shot> {
  const page = await browser.newPage({
    viewport: { ...size },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  try {
    try {
      await page.goto(url, { waitUntil: 'networkidle' });
    } catch (cause) {
      throw new Error(`Could not open ${url} — is the app running?`, { cause });
    }
    await settle(page, options.injectFonts ?? true);
    return { png: await page.screenshot(), ...size };
  } finally {
    await page.close();
  }
}
