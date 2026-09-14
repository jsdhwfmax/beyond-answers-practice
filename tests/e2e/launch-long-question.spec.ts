import { mkdir, writeFile } from 'node:fs/promises';
import { test, expect, type Locator } from '@playwright/test';

test.use({ baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3000' });
const output = process.env.E2E_EVIDENCE_DIR || '.local/qa/launch-overflow-v11/after';
const chinese = '边界样例：临近毕业时想和导师认真讨论跨专业升学、目前课题的交接安排以及下一学期的实习计划，怎样把自己已经考虑过的选择、尚未确认的条件和希望得到的具体帮助说清楚，同时听懂对方的顾虑并保留继续商量的空间？';
const unbroken = `边界样例：UniversityResearchCollaboration${'WithoutAnyBreak'.repeat(8)} https://example.invalid/${'verylongpathsegment'.repeat(7)}`;

async function cardMetrics(cards: Locator) {
  return cards.evaluateAll(elements => elements.map(element => {
    const bounds = element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    const outside = [...range.getClientRects()].filter(rect => rect.width && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1));
    const next = (element.nextElementSibling ?? element.parentElement?.nextElementSibling?.firstElementChild)?.getBoundingClientRect();
    return { text: element.textContent, cardWidth: bounds.width, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, fontSize: getComputedStyle(element).fontSize, outsideTextRects: outside.length, gapToNextCard: next ? next.left - bounds.right : null };
  }));
}

for (const view of [{ name: 'desktop', width: 1280, scale: 1 }, { name: 'mobile', width: 320, scale: 1 }, { name: 'desktop-double-text', width: 1280, scale: 2 }, { name: 'mobile-double-text', width: 320, scale: 2 }]) {
  test(`启动页长中文和连续英文 URL 完整保留且留在卡片内：${view.name}`, async ({ page }) => {
    await page.setViewportSize({ width: view.width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    const wall = page.getByRole('region', { name: '校园里真实出现过的知乎问题', exact: true });
    const links = wall.getByRole('link');
    await expect(links.first()).toBeVisible();
    const hrefs = await links.evaluateAll(elements => elements.map(element => element.getAttribute('href')));
    await page.getByRole('button', { name: '暂停流动', exact: true }).click();
    await expect(page.getByRole('button', { name: '继续流动', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await links.first().focus();
    const originalCards = await cardMetrics(links);
    // Only this browser DOM receives stress text. Real source data and hrefs are untouched.
    for (const [index, text] of [chinese, unbroken].entries()) {
      await links.nth(index).evaluate((element, sample) => {
        const title = element.querySelector('[class*="questionTitle"]');
        if (title) title.textContent = sample;
        else {
          const textNode = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
          if (!textNode) throw new Error('Question title text was not found');
          textNode.textContent = sample;
        }
      }, text);
    }
    if (view.scale === 2) await wall.evaluate(element => {
      const cards = [...element.querySelectorAll<HTMLElement>('[class*="questionGroup"] > *')];
      for (const card of cards) {
        const category = card.firstElementChild as HTMLElement;
        const categorySize = parseFloat(getComputedStyle(category).fontSize);
        card.style.fontSize = `${parseFloat(getComputedStyle(card).fontSize) * 2}px`;
        category.style.fontSize = `${categorySize * 2}px`;
      }
    });
    await links.first().focus();
    const stressedCards = await cardMetrics(links);
    await mkdir(output, { recursive: true });
    await writeFile(`${output}/${view.name}-metrics.json`, JSON.stringify({ viewport: view, originalCards, stressedCards, pageWidth: await page.evaluate(() => document.documentElement.scrollWidth), boundary: 'Synthetic long text in browser DOM; real question links unchanged.' }, null, 2));
    await links.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/${view.name}-chinese.png`, fullPage: true });
    await links.nth(1).focus();
    await links.nth(1).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/${view.name}-url.png`, fullPage: true });
    await expect(links.first()).toContainText(chinese);
    await expect(links.nth(1)).toContainText(unbroken);
    expect(await links.evaluateAll(elements => elements.map(element => element.getAttribute('href')))).toEqual(hrefs);
    for (const card of stressedCards) {
      expect.soft(card.scrollWidth, card.text ?? '').toBeLessThanOrEqual(card.clientWidth + 1);
      expect.soft(card.outsideTextRects, card.text ?? '').toBe(0);
      expect.soft(card.cardWidth, card.text ?? '').toBeLessThanOrEqual(view.width);
      if (card.gapToNextCard !== null) expect.soft(card.gapToNextCard, card.text ?? '').toBeGreaterThanOrEqual(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(view.width);
    await page.getByRole('button', { name: '继续流动', exact: true }).click();
    await expect(page.getByRole('button', { name: '暂停流动', exact: true })).toHaveAttribute('aria-pressed', 'false');
    expect(await wall.locator('[class*="track"]').evaluateAll(elements => elements.every(element => getComputedStyle(element).animationPlayState === 'running'))).toBe(true);
  });
}
