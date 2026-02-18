/**
 * Feature flag system for optional functionality.
 * Features are automatically enabled/disabled based on configuration and dependencies.
 */

import type { AppConfig } from './config';
import type { Context, Next } from 'hono';
import type { Env, User } from './types';
import { getConfig } from './config';

type Variables = {
  user: User;
};

export interface Features {
  // Email-dependent features
  hasMailgun: boolean;
  canSendEmails: boolean;
  enableCollaborators: boolean;
  
  // Other features
  enableGeocoding: boolean;
  enableFavorites: boolean;
  enableAnalytics: boolean;
  
  // Development features
  isDevelopment: boolean;
  isProduction: boolean;
  enableDebugLogging: boolean;
}

/**
 * Evaluate feature flags based on configuration
 */
export function getFeatures(config: AppConfig): Features {
  // Check if Mailgun is configured
  const hasMailgun = !!(config.mailgunApiKey && config.mailgunDomain);
  
  // Email-dependent features
  const canSendEmails = hasMailgun;
  const enableCollaborators = hasMailgun; // Collaborators need email for invites
  
  // Environment flags
  const isDevelopment = config.environment === 'development';
  const isProduction = config.environment === 'production';
  const enableDebugLogging = isDevelopment;
  
  return {
    // Email features
    hasMailgun,
    canSendEmails,
    enableCollaborators,
    
    // Always-on features (can be made configurable later)
    enableGeocoding: true,
    enableFavorites: true,
    enableAnalytics: true,
    
    // Environment
    isDevelopment,
    isProduction,
    enableDebugLogging,
  };
}

/**
 * Middleware to require a specific feature to be enabled
 */
export function requireFeature(featureName: keyof Features) {
  return async (c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) => {
    const config = getConfig(c.env);
    const features = getFeatures(config);
    
    if (!isFeatureEnabled(featureName, features)) {
      return c.json({ 
        error: 'Feature not available', 
        feature: featureName,
        message: `The ${featureName} feature is not enabled on this server.`
      }, 503);
    }
    
    await next();
  };
}

/**
 * Check if feature is available (for inline checks - pass env directly)
 */
export function checkFeature(env: Env, featureName: keyof Features): boolean {
  const config = getConfig(env);
  const features = getFeatures(config);
  return isFeatureEnabled(featureName, features);
}

/**
 * Check if a feature is enabled
 */
export function isFeatureEnabled(feature: keyof Features, features: Features): boolean {
  return features[feature] === true;
}
