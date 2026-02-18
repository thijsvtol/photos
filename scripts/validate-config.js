#!/usr/bin/env node

/**
 * Configuration Validation Script
 * 
 * Validates that all required configuration is present and correct:
 * - Checks environment variables
 * - Validates format of values
 * - Tests Cloudflare bindings (if available)
 * - Provides helpful error messages
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

// Track validation results
const errors = [];
const warnings = [];
const info = [];

// Helper to check if file exists
function fileExists(filePath) {
  return fs.existsSync(filePath);
}

// Helper to read .env file
function readEnvFile(filePath) {
  if (!fileExists(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const vars = {};

  content.split('\n').forEach((line) => {
    line = line.trim();
    
    // Skip comments and empty lines
    if (!line || line.startsWith('#')) return;
    
    const [key, ...valueParts] = line.split('=');
    const value = valueParts.join('=').trim();
    
    if (key && value) {
      vars[key.trim()] = value;
    }
  });

  return vars;
}

// Validate email format
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Validate domain format
function isValidDomain(domain) {
  // Allow localhost for development
  if (domain.startsWith('localhost')) return true;
  return /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}(:[0-9]{1,5})?$/i.test(domain);
}

// Check required variable
function checkRequired(vars, name, validator = null) {
  const value = vars[name];
  
  if (!value || value.includes('your-') || value.includes('example.com')) {
    errors.push(`Missing or placeholder value for ${name}`);
    return false;
  }
  
  if (validator && !validator(value)) {
    errors.push(`Invalid format for ${name}: ${value}`);
    return false;
  }
  
  info.push(`✓ ${name} is set`);
  return true;
}

// Check optional variable
function checkOptional(vars, name, validator = null) {
  const value = vars[name];
  
  if (!value) {
    warnings.push(`Optional variable ${name} is not set`);
    return false;
  }
  
  if (value.includes('your-') || value.includes('example.com')) {
    warnings.push(`${name} contains placeholder value`);
    return false;
  }
  
  if (validator && !validator(value)) {
    warnings.push(`Invalid format for ${name}: ${value}`);
    return false;
  }
  
  info.push(`✓ ${name} is set`);
  return true;
}

// Validate worker configuration
function validateWorker() {
  console.log(`\n${colors.bright}${colors.cyan}=== Validating Worker Configuration ===${colors.reset}\n`);
  
  const devVarsPath = path.join(rootDir, '.dev.vars');
  
  if (!fileExists(devVarsPath)) {
    errors.push(`.dev.vars file not found at ${devVarsPath}`);
    console.log(`${colors.red}✗ .dev.vars file not found${colors.reset}`);
    console.log(`${colors.yellow}  Run: npm run setup:wizard${colors.reset}\n`);
    return false;
  }
  
  console.log(`${colors.green}✓ .dev.vars file exists${colors.reset}`);
  
  const vars = readEnvFile(devVarsPath);
  
  // Required variables
  console.log(`\n${colors.bright}Required Variables:${colors.reset}`);
  checkRequired(vars, 'APP_NAME');
  checkRequired(vars, 'BRAND_NAME');
  checkRequired(vars, 'COPYRIGHT_HOLDER');
  checkRequired(vars, 'APP_DOMAIN', isValidDomain);
  checkRequired(vars, 'CONTACT_EMAIL', isValidEmail);
  checkRequired(vars, 'ADMIN_EMAILS', (val) => val.split(',').every(isValidEmail));
  checkRequired(vars, 'JWT_SECRET', (val) => val.length >= 32);
  checkRequired(vars, 'EVENT_COOKIE_SECRET', (val) => val.length >= 32);
  checkRequired(vars, 'ACCESS_TEAM_DOMAIN');
  checkRequired(vars, 'ACCESS_AUD');
  
  // Optional variables
  console.log(`\n${colors.bright}Optional Variables (for features):${colors.reset}`);
  const hasMailgun = checkOptional(vars, 'MAILGUN_API_KEY');
  checkOptional(vars, 'MAILGUN_DOMAIN');
  
  if (!hasMailgun) {
    console.log(`${colors.yellow}\n⚠ Mailgun not configured - collaboration features will be disabled${colors.reset}`);
  }
  
  return true;
}

// Validate web configuration
function validateWeb() {
  console.log(`\n${colors.bright}${colors.cyan}=== Validating Web Configuration ===${colors.reset}\n`);
  
  const envLocalPath = path.join(rootDir, 'apps', 'web', '.env.local');
  
  if (!fileExists(envLocalPath)) {
    errors.push(`.env.local file not found at ${envLocalPath}`);
    console.log(`${colors.red}✗ .env.local file not found${colors.reset}`);
    console.log(`${colors.yellow}  Run: npm run setup:wizard${colors.reset}\n`);
    return false;
  }
  
  console.log(`${colors.green}✓ .env.local file exists${colors.reset}`);
  
  const vars = readEnvFile(envLocalPath);
  
  // Required variables
  console.log(`\n${colors.bright}Required Variables:${colors.reset}`);
  checkRequired(vars, 'VITE_API_URL');
  checkRequired(vars, 'VITE_APP_NAME');
  checkRequired(vars, 'VITE_BRAND_NAME');
  checkRequired(vars, 'VITE_COPYRIGHT_HOLDER');
  checkRequired(vars, 'VITE_DOMAIN');
  checkRequired(vars, 'VITE_CONTACT_EMAIL', isValidEmail);
  
  return true;
}

// Validate wrangler.toml
function validateWranglerConfig() {
  console.log(`\n${colors.bright}${colors.cyan}=== Validating Wrangler Configuration ===${colors.reset}\n`);
  
  const wranglerPath = path.join(rootDir, 'wrangler.toml');
  
  if (!fileExists(wranglerPath)) {
    errors.push('wrangler.toml not found');
    console.log(`${colors.red}✗ wrangler.toml not found${colors.reset}\n`);
    return false;
  }
  
  console.log(`${colors.green}✓ wrangler.toml exists${colors.reset}`);
  
  const content = fs.readFileSync(wranglerPath, 'utf-8');
  
  // Check for required bindings
  if (!content.includes('[[d1_databases]]')) {
    warnings.push('D1 database binding not configured in wrangler.toml');
    console.log(`${colors.yellow}⚠ D1 database binding not found${colors.reset}`);
  } else {
    info.push('✓ D1 database binding configured');
  }
  
  if (!content.includes('[[r2_buckets]]')) {
    warnings.push('R2 bucket binding not configured in wrangler.toml');
    console.log(`${colors.yellow}⚠ R2 bucket binding not found${colors.reset}`);
  } else {
    info.push('✓ R2 bucket binding configured');
  }
  
  return true;
}

// Validate package installations
function validateDependencies() {
  console.log(`\n${colors.bright}${colors.cyan}=== Validating Dependencies ===${colors.reset}\n`);
  
  const workerNodeModules = path.join(rootDir, 'apps', 'worker', 'node_modules');
  const webNodeModules = path.join(rootDir, 'apps', 'web', 'node_modules');
  
  if (!fileExists(workerNodeModules)) {
    errors.push('Worker dependencies not installed');
    console.log(`${colors.red}✗ Worker dependencies not installed${colors.reset}`);
    console.log(`${colors.yellow}  Run: npm --prefix apps/worker install${colors.reset}`);
  } else {
    console.log(`${colors.green}✓ Worker dependencies installed${colors.reset}`);
  }
  
  if (!fileExists(webNodeModules)) {
    errors.push('Web dependencies not installed');
    console.log(`${colors.red}✗ Web dependencies not installed${colors.reset}`);
    console.log(`${colors.yellow}  Run: npm --prefix apps/web install${colors.reset}`);
  } else {
    console.log(`${colors.green}✓ Web dependencies installed${colors.reset}`);
  }
  
  return fileExists(workerNodeModules) && fileExists(webNodeModules);
}

// Main validation
async function main() {
  console.log(`${colors.bright}${colors.cyan}
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║            Configuration Validation Report                   ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
${colors.reset}
`);

  // Run all validations
  validateWorker();
  validateWeb();
  validateWranglerConfig();
  validateDependencies();

  // Print summary
  console.log(`\n${colors.bright}${colors.cyan}╔══════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}║                    Validation Summary                        ║${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}╚══════════════════════════════════════════════════════════════╝${colors.reset}\n`);

  if (errors.length === 0 && warnings.length === 0) {
    console.log(`${colors.bright}${colors.green}✓ All checks passed! Configuration is valid.${colors.reset}\n`);
    console.log(`${colors.cyan}You can now start the development servers:${colors.reset}`);
    console.log(`  ${colors.yellow}npm run dev${colors.reset}\n`);
    process.exit(0);
  }

  if (errors.length > 0) {
    console.log(`${colors.bright}${colors.red}Errors (${errors.length}):${colors.reset}`);
    errors.forEach((error) => {
      console.log(`  ${colors.red}✗ ${error}${colors.reset}`);
    });
    console.log();
  }

  if (warnings.length > 0) {
    console.log(`${colors.bright}${colors.yellow}Warnings (${warnings.length}):${colors.reset}`);
    warnings.forEach((warning) => {
      console.log(`  ${colors.yellow}⚠ ${warning}${colors.reset}`);
    });
    console.log();
  }

  if (errors.length > 0) {
    console.log(`${colors.red}Configuration validation failed. Please fix the errors above.${colors.reset}\n`);
    console.log(`${colors.cyan}Need help? Run the setup wizard:${colors.reset}`);
    console.log(`  ${colors.yellow}npm run setup:wizard${colors.reset}\n`);
    process.exit(1);
  } else {
    console.log(`${colors.green}Configuration is valid, but has warnings.${colors.reset}`);
    console.log(`${colors.yellow}You can proceed, but some features may be limited.${colors.reset}\n`);
    process.exit(0);
  }
}

main().catch((error) => {
  console.error(`\n${colors.red}Validation error: ${error.message}${colors.reset}\n`);
  process.exit(1);
});
