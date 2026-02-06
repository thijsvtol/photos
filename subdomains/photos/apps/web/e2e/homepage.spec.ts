import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Homepage', () => {
  test('should load and display the landing page', async ({ page }) => {
    await page.goto('/');
    
    // Check that the page loads
    await expect(page).toHaveTitle(/Thijs van Tol/);
    
    // Check for main hero heading
    await expect(page.getByRole('heading', { name: /Thijs van Tol Photo/i })).toBeVisible();
    
    // Check for main CTA buttons
    await expect(page.getByRole('link', { name: /View Galleries/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Favorites/i })).toBeVisible();
  });

  test('should have no accessibility violations', async ({ page }) => {
    await page.goto('/');
    
    const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
    
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('should navigate to events page', async ({ page }) => {
    await page.goto('/');
    
    await page.getByRole('link', { name: /View Galleries/i }).click();
    
    await expect(page).toHaveURL(/\/events/);
    await expect(page.getByRole('heading', { name: /Photo Events/i, level: 1 })).toBeVisible();
  });
});
