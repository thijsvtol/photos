#!/usr/bin/env node

/**
 * Generate staging JWT tokens for security probe testing
 * 
 * Creates:
 * 1. JWT_SECRET for staging environment
 * 2. Bearer token for admin user
 * 3. Bearer token for collaborator user
 */

import { randomBytes } from 'crypto';
import { createHmac } from 'crypto';

// Generate random secret (32 bytes = 256 bits, base64 encoded)
function generateSecret(bytes = 32) {
  return randomBytes(bytes).toString('base64');
}

// Create JWT manually (HS256)
function createJWT(payload, secret) {
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  
  const message = `${headerB64}.${payloadB64}`;
  
  // Sign with HS256
  const hmac = createHmac('sha256', secret);
  hmac.update(message);
  const signature = hmac.digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  
  return `${message}.${signature}`;
}

// Main execution
const stagingSecret = generateSecret(32);

// User IDs (can be any string, typically user email or UUID)
const adminEmail = 'vantol.thijs@gmail.com';
const adminUserId = 'admin-thijs-' + randomBytes(8).toString('hex');

const collaboratorEmail = 'collaborator@staging.test';
const collaboratorUserId = 'collab-' + randomBytes(8).toString('hex');

// Create bearer tokens
const adminPayload = {
  type: 'mobile_oauth',
  sub: adminUserId,
  email: adminEmail,
  name: 'Thijs (Admin)',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60) // 1 year expiry
};

const collaboratorPayload = {
  type: 'mobile_oauth',
  sub: collaboratorUserId,
  email: collaboratorEmail,
  name: 'Test Collaborator',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60) // 1 year expiry
};

const adminToken = createJWT(adminPayload, stagingSecret);
const collaboratorToken = createJWT(collaboratorPayload, stagingSecret);

console.log('═══════════════════════════════════════════════════════════════');
console.log('STAGING ENVIRONMENT SECRETS - Generated ' + new Date().toISOString());
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('1. JWT_SECRET (for signing tokens):');
console.log('   ' + stagingSecret);
console.log('');

console.log('2. ADMIN BEARER TOKEN (for vantol.thijs@gmail.com):');
console.log('   ' + adminToken);
console.log('');

console.log('3. COLLABORATOR BEARER TOKEN (for collaborator@staging.test):');
console.log('   ' + collaboratorToken);
console.log('');

console.log('═══════════════════════════════════════════════════════════════');
console.log('\nToken Details:');
console.log('');
console.log('Admin Token Payload:');
console.log(JSON.stringify(adminPayload, null, 2));
console.log('');
console.log('Collaborator Token Payload:');
console.log(JSON.stringify(collaboratorPayload, null, 2));
console.log('');

console.log('═══════════════════════════════════════════════════════════════');
console.log('\nNEXT STEPS:');
console.log('');
console.log('Set these in your staging-security environment with:');
console.log('');
console.log(`  gh secret set JWT_SECRET --env staging-security --body "${stagingSecret}"`);
console.log(`  gh secret set STAGING_ADMIN_BEARER_TOKEN --env staging-security --body "${adminToken}"`);
console.log(`  gh secret set STAGING_COLLAB_BEARER_TOKEN --env staging-security --body "${collaboratorToken}"`);
console.log('');
console.log('Or execute with: node scripts/generate-staging-tokens.mjs | bash');
console.log('═══════════════════════════════════════════════════════════════\n');

// Export as environment variables for shell consumption
console.log('export JWT_SECRET="' + stagingSecret + '"');
console.log('export STAGING_ADMIN_BEARER_TOKEN="' + adminToken + '"');
console.log('export STAGING_COLLAB_BEARER_TOKEN="' + collaboratorToken + '"');
