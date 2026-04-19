import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { chromium } from 'playwright';

const GROUP_LINKS_URL =
  process.env.VK_GROUP_LINKS_URL ?? 'https://vk.com/kapital_rust?act=links';
const TARGET_URL =
  process.env.VK_TARGET_URL ?? 'https://kapital-group.github.io/social-links/';
const LINK_TITLE = process.env.VK_LINK_TITLE ?? 'Kapital Rust';
const PROFILE_DIR = path.resolve('playwright/.profile/vk');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function waitForManualConfirm(rl, message) {
  await rl.question(`${message}\nPress Enter to continue... `);
}

async function optionalClick(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) && (await locator.isVisible().catch(() => false))) {
      await locator.click({ force: true });
      return true;
    }
  }
  return false;
}

async function findFirst(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) && (await locator.isVisible().catch(() => false))) {
      return locator;
    }
  }
  return null;
}

async function main() {
  await ensureDir(PROFILE_DIR);

  const rl = readline.createInterface({ input, output });
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1440, height: 960 },
    locale: 'ru-RU',
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(GROUP_LINKS_URL, { waitUntil: 'domcontentloaded' });

    if (!page.url().includes('kapital_rust')) {
      await waitForManualConfirm(
        rl,
        `Log into VK in the opened browser and navigate to ${GROUP_LINKS_URL}`
      );
      await page.goto(GROUP_LINKS_URL, { waitUntil: 'domcontentloaded' });
    }

    await page.waitForLoadState('networkidle').catch(() => {});

    const opened = await optionalClick(page, [
      'button:has-text("Добавить ссылку")',
      '[role="button"]:has-text("Добавить ссылку")',
      'a:has-text("Добавить ссылку")',
      '.FlatButton:has-text("Добавить ссылку")',
      '.FlatButton:has-text("Добавить")',
    ]);

    if (!opened) {
      throw new Error('Could not find the "Добавить ссылку" button on the page.');
    }

    await page.locator('#group_al_url').waitFor({ state: 'visible', timeout: 15000 });

    const urlInput = await findFirst(page, ['#group_al_url', 'input[placeholder*="https://"]']);

    if (!urlInput) {
      throw new Error('Could not find the URL input in the link dialog.');
    }

    await urlInput.click();
    await urlInput.fill('');
    await urlInput.pressSequentially(TARGET_URL, { delay: 30 });
    await page.evaluate(() => {
      const input = document.querySelector('#group_al_url');
      if (!input) return;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      if (window.GroupsEdit?.checkLink) {
        window.GroupsEdit.checkLink(input);
      }
    });
    await page.waitForTimeout(2500);

    const titleInput = await findFirst(page, ['#group_al_title']);

    if (titleInput) {
      await titleInput.fill(LINK_TITLE);
    }

    const thumb = await findFirst(page, [
      '#group_al_thumb_img',
      '.group_al_thumb_img',
      'img[src*="kapital-group.github.io"]',
      'img[src*="lnkouter"]',
    ]);

    if (thumb) {
      const thumbSrc = await thumb.getAttribute('src');
      console.log(`Preview image src: ${thumbSrc ?? '<empty>'}`);
    } else {
      console.log('Preview image not found in the dialog.');
    }

    await waitForManualConfirm(
      rl,
      'The URL should already be filled automatically. Only review the preview now. If VK still shows the default external-link icon, this flow also did not produce a custom image.'
    );

    const added = await optionalClick(page, [
      '#box_layer_wrap .FlatButton--primary:has-text("Добавить")',
      '#box_layer_wrap .FlatButton--primary:has-text("Сохранить")',
      '#box_layer_wrap button:has-text("Добавить")',
      '#box_layer_wrap button:has-text("Сохранить")',
    ]);

    if (!added) {
      throw new Error('Could not find the final confirm button in the dialog.');
    }

    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);
    console.log('Browser flow finished. Check the group links block in the opened page.');
    await waitForManualConfirm(rl, 'Close the browser or inspect the result.');
  } finally {
    await context.close();
    rl.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
