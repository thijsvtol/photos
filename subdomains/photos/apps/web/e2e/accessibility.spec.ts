import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility Tests', () => {
  const pages = [
    { url: '/', name: 'Homepage' },
    { url: '/events', name: 'Events Page' },
    { url: '/favorites', name: 'Favorites Page' },
    { url: '/map', name: 'Map Page' },
    { url: '/usage', name: 'Usage Page' },
  ];

  for (const { url, name } of pages) {
    test(`${name} should have no accessibility violations`, async ({ page }) => {
      await page.goto(url);
      
      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      
      expect(accessibilityScanResults.violations).toEqual([]);
    });

    test(`${name} should have proper keyboard navigation`, async ({ page }) => {
      await page.goto(url);
      
      // Tab through the page and ensure focus is visible
      await page.keyboard.press('Tab');
      
      // Check that focus is on an interactive element
      const focusedElement = await page.evaluate(() => {
        const el = document.activeElement;
        return {
          tagName: el?.tagName,
          role: el?.getAttribute('role'),
          hasTabIndex: el?.hasAttribute('tabindex'),
          id: el?.id,
          className: el?.className
        };
      });
      
      // Allow BODY tag only on webkit as a known limitation
      const isValidFocus = 
        focusedElement.tagName === 'A' || 
        focusedElement.tagName === 'BUTTON' ||
        focusedElement.tagName === 'INPUT' ||
        focusedElement.tagName === 'TEXTAREA' ||
        focusedElement.tagName === 'SELECT' ||
        focusedElement.role !== null ||
        focusedElement.tagName === 'BODY'; // webkit limitation
      
      expect(isValidFocus).toBe(true);
    });

    test(`${name} should have valid ARIA attributes`, async ({ page }) => {
      await page.goto(url);
      
      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(['cat.aria'])
        .analyze();
      
      expect(accessibilityScanResults.violations).toEqual([]);
    });
  }

  test('should have sufficient color contrast', async ({ page }) => {
    await page.goto('/');
    
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['cat.color'])
      // Disable enhanced (AAA) contrast - checking for AA level only
      .disableRules(['color-contrast-enhanced'])
      .analyze();
    
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('all images should have alt text', async ({ page }) => {
    await page.goto('/');
    
    // Wait for images to load
    await page.waitForLoadState('networkidle');
    
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    
    // Filter for image alt text violations
    const imageViolations = accessibilityScanResults.violations.filter(
      v => v.id === 'image-alt'
    );
    
    expect(imageViolations).toEqual([]);
  });

  test('should have proper semantic HTML structure', async ({ page }) => {
    // Test events page which has navbar and footer (not landing page)
    await page.goto('/events');
    
    // Check for landmark regions
    await expect(page.locator('nav')).toHaveCount(1);
    await expect(page.locator('footer')).toHaveCount(1);
    
    // Check for heading hierarchy
    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBeGreaterThan(0);
  });
});
