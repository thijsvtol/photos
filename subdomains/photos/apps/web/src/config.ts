/**
 * Frontend configuration module.
 * Configuration is injected at runtime via window.__CONFIG__ by the worker.
 */

export interface AppConfig {
  // Branding
  appName: string;
  brandName: string;
  copyrightHolder: string;
  
  // Domain & URLs
  domain: string;
  apiUrl: string;
  
  // Contact
  contactEmail: string;
  
  // Feature flags
  features: {
    enableCollaborators: boolean;
    enableFavorites: boolean;
    enableGeocoding: boolean;
    enableAnalytics: boolean;
  };
}

// Default configuration (used in development)
const defaultConfig: AppConfig = {
  appName: 'Photos',
  brandName: 'Photos',
  copyrightHolder: 'Your Name',
  domain: 'localhost:5173',
  apiUrl: import.meta.env.VITE_API_URL || 'http://localhost:8787',
  contactEmail: 'contact@example.com',
  features: {
    enableCollaborators: true,
    enableFavorites: true,
    enableGeocoding: true,
    enableAnalytics: true,
  },
};

/**
 * Get application configuration.
 * In production, this is injected by the worker via window.__CONFIG__.
 * In development, falls back to VITE environment variables.
 */
export function getConfig(): AppConfig {
  // Check for runtime config (injected by worker in production)
  if (typeof window !== 'undefined' && (window as any).__CONFIG__) {
    return (window as any).__CONFIG__;
  }
  
  // Development fallback
  return {
    appName: import.meta.env.VITE_APP_NAME || defaultConfig.appName,
    brandName: import.meta.env.VITE_BRAND_NAME || defaultConfig.brandName,
    copyrightHolder: import.meta.env.VITE_COPYRIGHT_HOLDER || defaultConfig.copyrightHolder,
    domain: import.meta.env.VITE_DOMAIN || defaultConfig.domain,
    apiUrl: import.meta.env.VITE_API_URL || defaultConfig.apiUrl,
    contactEmail: import.meta.env.VITE_CONTACT_EMAIL || defaultConfig.contactEmail,
    features: defaultConfig.features,
  };
}

// Export singleton instance
export const config = getConfig();
