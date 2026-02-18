import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Navigation', () => {
  test('should navigate through all main pages', async ({ page }) => {
    // Start from events page (not landing page which has no nav)
    await page.goto('/events');
    await expect(page).toHaveURL(/\/events/);
    
    // Navigate to Favorites
    await page.getByRole('link', { name: /Favorites/i }).click();
    await expect(page).toHaveURL(/\/favorites/);
    await expect(page.getByRole('heading', { name: /My Favorites/i })).toBeVisible();
    
    // Navigate to Map
    await page.getByRole('link', { name: /Map/i }).click();
    await expect(page).toHaveURL(/\/map/);
    
    // Navigate back to Events
    await page.getByRole('link', { name: /Events/i }).click();
    await expect(page).toHaveURL(/\/events/);
  });

  test('should have accessible navigation on all pages', async ({ page }) => {
    // Only test pages that have navigation (not the landing page)
    const pages = ['/events', '/favorites', '/map', '/usage'];
    
    for (const url of pages) {
      await page.goto(url);
      
      const accessibilityScanResults = await new AxeBuilder({ page })
        .include('nav')
        .analyze();
      
      expect(accessibilityScanResults.violations).toEqual([]);
    }
  });

  test('should maintain navigation state across pages', async ({ page }) => {
    await page.goto('/events');
    
    // Check that navigation is visible
    const nav = page.getByRole('navigation');
    await expect(nav).toBeVisible();
    
    // Navigate to different pages and verify nav persists
    await page.getByRole('link', { name: /Favorites/i }).click();
    await expect(nav).toBeVisible();
    
    await page.getByRole('link', { name: /Map/i }).click();
    await expect(nav).toBeVisible();
  });
});
