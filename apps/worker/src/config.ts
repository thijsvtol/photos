/**
 * Configuration module for the Photos app worker.
 * Reads environment variables and provides type-safe configuration access.
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
  
  // Admin
  adminEmails: string[];
  
  // Secrets
  eventCookieSecret: string;
  jwtSecret: string;
  
  // Optional integrations
  mailgunApiKey?: string;
  mailgunDomain?: string;
  
  // Feature flags
  environment: 'development' | 'production';
}

/**
 * Get configuration from environment variables
 */
export function getConfig(env: any): AppConfig {
  // Required variables - throw if missing
  const requiredVars = {
    APP_NAME: env.APP_NAME,
    BRAND_NAME: env.BRAND_NAME,
    COPYRIGHT_HOLDER: env.COPYRIGHT_HOLDER,
    APP_DOMAIN: env.APP_DOMAIN,
    CONTACT_EMAIL: env.CONTACT_EMAIL,
    ADMIN_EMAILS: env.ADMIN_EMAILS,
    EVENT_COOKIE_SECRET: env.EVENT_COOKIE_SECRET,
    JWT_SECRET: env.JWT_SECRET,
  };
  
  // Validate required variables
  for (const [key, value] of Object.entries(requiredVars)) {
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
  
  const domain = env.APP_DOMAIN;
  const environment = env.ENVIRONMENT === 'production' ? 'production' : 'development';
  
  return {
    // Branding
    appName: env.APP_NAME,
    brandName: env.BRAND_NAME,
    copyrightHolder: env.COPYRIGHT_HOLDER,
    
    // Domain & URLs
    domain,
    apiUrl: `https://${domain}`,
    
    // Contact
    contactEmail: env.CONTACT_EMAIL,
    
    // Admin (parse comma-separated list)
    adminEmails: env.ADMIN_EMAILS.split(',').map((email: string) => email.trim()),
    
    // Secrets
    eventCookieSecret: env.EVENT_COOKIE_SECRET,
    jwtSecret: env.JWT_SECRET,
    
    // Optional integrations
    mailgunApiKey: env.MAILGUN_API_KEY,
    mailgunDomain: env.MAILGUN_DOMAIN,
    
    // Feature flags
    environment,
  };
}

/**
 * Check if user email is an admin
 */
export function isAdmin(email: string | undefined, config: AppConfig): boolean {
  if (!email) return false;
  return config.adminEmails.includes(email.toLowerCase());
}
