import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Photo Usage Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/usage');
  });

  test('should display all required sections', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Personal Use/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Required Attribution/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Commercial Use/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /What's Not Allowed/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Privacy & Takedown Requests/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Contact/i })).toBeVisible();
  });

  test('should have contact form link', async ({ page }) => {
    const contactLink = page.getByRole('link', { name: /Contact via Form/i });
    await expect(contactLink).toBeVisible();
    await expect(contactLink).toHaveAttribute('href', 'https://photos.thijsvtol.nl/#contact');
  });

  test('should have no accessibility violations', async ({ page }) => {
    // Disable landmark rules as the page uses custom layout
    const accessibilityScanResults = await new AxeBuilder({ page })
      .disableRules(['landmark-one-main', 'region'])
      .analyze();
    
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('should have proper heading hierarchy', async ({ page }) => {
    const h1 = await page.locator('h1').count();
    const h2 = await page.locator('h2').count();
    
    expect(h1).toBe(1); // Only one h1
    expect(h2).toBeGreaterThan(0); // Multiple h2 for sections
  });

  test('should display copyright notice with current year', async ({ page }) => {
    const currentYear = new Date().getFullYear();
    await expect(page.getByText(new RegExp(`© ${currentYear} Thijs van Tol`)).first()).toBeVisible();
  });

  test('should be mobile responsive', async ({ page }) => {
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    await expect(page.getByRole('heading', { name: /Photo Usage Rights/i, level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /Contact via Form/i })).toBeVisible();
  });
});
