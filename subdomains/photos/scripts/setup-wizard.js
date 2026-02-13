#!/usr/bin/env node

/**
 * Interactive Setup Wizard
 * 
 * Guides users through initial configuration by:
 * - Prompting for required configuration values
 * - Generating .dev.vars and .env.local files
 * - Validating inputs
 * - Providing next steps
 */

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Helper to ask questions
function question(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

// Helper to generate random secret
function generateSecret(length = 32) {
  return randomBytes(length).toString('base64');
}

// Validate email format
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Validate domain format
function isValidDomain(domain) {
  return /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}(:[0-9]{1,5})?$/i.test(domain);
}

async function main() {
  console.log(`${colors.bright}${colors.blue}
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║          Photo Sharing Application Setup Wizard             ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
${colors.reset}
`);

  console.log(`${colors.cyan}This wizard will help you set up your photo sharing application.${colors.reset}\n`);
  console.log(`${colors.yellow}Press Ctrl+C at any time to exit.\n${colors.reset}`);

  const config = {};

  // ==================== BRANDING ====================
  console.log(`${colors.bright}${colors.green}=== Branding Configuration ===${colors.reset}\n`);

  config.appName = await question(`${colors.cyan}Full application name${colors.reset} (e.g., "Smith Family Photos"): `);
  config.appName = config.appName.trim() || 'My Photo Gallery';

  config.brandName = await question(`${colors.cyan}Short brand name${colors.reset} (e.g., "Smith Family"): `);
  config.brandName = config.brandName.trim() || config.appName;

  config.copyrightHolder = await question(`${colors.cyan}Copyright holder name${colors.reset} (e.g., "John Smith"): `);
  config.copyrightHolder = config.copyrightHolder.trim() || config.brandName;

  // ==================== DOMAIN ====================
  console.log(`\n${colors.bright}${colors.green}=== Domain Configuration ===${colors.reset}\n`);

  let domainValid = false;
  while (!domainValid) {
    config.appDomain = await question(`${colors.cyan}App domain${colors.reset} (e.g., "photos.example.com"): `);
    config.appDomain = config.appDomain.trim();
    
    if (!config.appDomain) {
      console.log(`${colors.yellow}Using localhost:5173 for development${colors.reset}`);
      config.appDomain = 'localhost:5173';
      domainValid = true;
    } else if (isValidDomain(config.appDomain)) {
      domainValid = true;
    } else {
      console.log(`${colors.red}Invalid domain format. Please try again.${colors.reset}`);
    }
  }

  // ==================== CONTACT ====================
  console.log(`\n${colors.bright}${colors.green}=== Contact Information ===${colors.reset}\n`);

  let emailValid = false;
  while (!emailValid) {
    config.contactEmail = await question(`${colors.cyan}Contact email${colors.reset}: `);
    config.contactEmail = config.contactEmail.trim();
    
    if (!config.contactEmail) {
      console.log(`${colors.red}Contact email is required.${colors.reset}`);
    } else if (isValidEmail(config.contactEmail)) {
      emailValid = true;
    } else {
      console.log(`${colors.red}Invalid email format. Please try again.${colors.reset}`);
    }
  }

  // ==================== ADMIN ====================
  console.log(`\n${colors.bright}${colors.green}=== Admin Configuration ===${colors.reset}\n`);

  const adminEmails = [];
  console.log(`${colors.yellow}Enter admin email addresses (one per line, press Enter with empty line when done):${colors.reset}`);
  
  while (true) {
    const email = await question(`${colors.cyan}Admin email ${adminEmails.length + 1}${colors.reset}: `);
    const trimmed = email.trim();
    
    if (!trimmed) break;
    
    if (isValidEmail(trimmed)) {
      adminEmails.push(trimmed);
    } else {
      console.log(`${colors.red}Invalid email format, skipping.${colors.reset}`);
    }
  }

  if (adminEmails.length === 0) {
    console.log(`${colors.yellow}No admin emails provided. Using contact email as admin.${colors.reset}`);
    adminEmails.push(config.contactEmail);
  }

  config.adminEmails = adminEmails.join(',');

  // ==================== SECRETS ====================
  console.log(`\n${colors.bright}${colors.green}=== Security Configuration ===${colors.reset}\n`);

  console.log(`${colors.yellow}Generating secure random secrets...${colors.reset}`);
  config.jwtSecret = generateSecret(32);
  config.eventCookieSecret = generateSecret(32);
  console.log(`${colors.green}✓ Secrets generated${colors.reset}`);

  // ==================== CLOUDFLARE ACCESS ====================
  console.log(`\n${colors.bright}${colors.green}=== Cloudflare Access Configuration ===${colors.reset}\n`);
  console.log(`${colors.yellow}These can be found in Cloudflare Zero Trust dashboard.${colors.reset}`);
  console.log(`${colors.yellow}Leave empty if you don't have them yet - you can add them later.${colors.reset}\n`);

  config.accessTeamDomain = await question(`${colors.cyan}Cloudflare Access Team Domain${colors.reset} (e.g., "myteam.cloudflareaccess.com"): `);
  config.accessTeamDomain = config.accessTeamDomain.trim() || 'your-team.cloudflareaccess.com';

  config.accessAud = await question(`${colors.cyan}Cloudflare Access AUD${colors.reset} (application audience tag): `);
  config.accessAud = config.accessAud.trim() || 'your-aud-value-here';

  // ==================== MAILGUN (OPTIONAL) ====================
  console.log(`\n${colors.bright}${colors.green}=== Mailgun Configuration (Optional) ===${colors.reset}\n`);
  console.log(`${colors.yellow}Required for collaboration features and email notifications.${colors.reset}`);
  console.log(`${colors.yellow}Leave empty to skip - you can add this later.${colors.reset}\n`);

  const enableMailgun = await question(`${colors.cyan}Configure Mailgun now?${colors.reset} (y/N): `);
  
  if (enableMailgun.toLowerCase() === 'y' || enableMailgun.toLowerCase() === 'yes') {
    config.mailgunApiKey = await question(`${colors.cyan}Mailgun API Key${colors.reset}: `);
    config.mailgunApiKey = config.mailgunApiKey.trim();

    config.mailgunDomain = await question(`${colors.cyan}Mailgun Domain${colors.reset}: `);
    config.mailgunDomain = config.mailgunDomain.trim();
  }

  // ==================== WRITE FILES ====================
  console.log(`\n${colors.bright}${colors.green}=== Writing Configuration Files ===${colors.reset}\n`);

  // Write .dev.vars for worker
  const devVarsPath = path.join(rootDir, '.dev.vars');
  const devVarsContent = `# Worker Environment Variables (Local Development)
# Generated by setup wizard on ${new Date().toISOString()}

# Branding
APP_NAME=${config.appName}
BRAND_NAME=${config.brandName}
COPYRIGHT_HOLDER=${config.copyrightHolder}
APP_DOMAIN=${config.appDomain}
CONTACT_EMAIL=${config.contactEmail}

# Security
ADMIN_EMAILS=${config.adminEmails}
JWT_SECRET=${config.jwtSecret}
EVENT_COOKIE_SECRET=${config.eventCookieSecret}

# Cloudflare Access
ACCESS_TEAM_DOMAIN=${config.accessTeamDomain}
ACCESS_AUD=${config.accessAud}
${config.mailgunApiKey ? `
# Mailgun (Optional - enables collaboration features)
MAILGUN_API_KEY=${config.mailgunApiKey}
MAILGUN_DOMAIN=${config.mailgunDomain}
` : `
# Mailgun (Optional - uncomment and add your credentials to enable collaboration)
# MAILGUN_API_KEY=your-key-here
# MAILGUN_DOMAIN=your-domain-here
`}`;

  fs.writeFileSync(devVarsPath, devVarsContent);
  console.log(`${colors.green}✓ Created ${devVarsPath}${colors.reset}`);

  // Write .env.local for web
  const envLocalPath = path.join(rootDir, 'apps', 'web', '.env.local');
  const envLocalContent = `# Web App Environment Variables (Local Development)
# Generated by setup wizard on ${new Date().toISOString()}

VITE_API_URL=http://localhost:8787
VITE_APP_NAME=${config.appName}
VITE_BRAND_NAME=${config.brandName}
VITE_COPYRIGHT_HOLDER=${config.copyrightHolder}
VITE_DOMAIN=${config.appDomain}
VITE_CONTACT_EMAIL=${config.contactEmail}
`;

  fs.writeFileSync(envLocalPath, envLocalContent);
  console.log(`${colors.green}✓ Created ${envLocalPath}${colors.reset}`);

  // Write .env.example if it doesn't exist
  const envExamplePath = path.join(rootDir, 'apps', 'web', '.env.example');
  if (!fs.existsSync(envExamplePath)) {
    const envExampleContent = `# Web App Environment Variables (Example)
# Copy this to .env.local and fill in your values

VITE_API_URL=http://localhost:8787
VITE_APP_NAME=My Photo Gallery
VITE_BRAND_NAME=My Gallery
VITE_COPYRIGHT_HOLDER=Your Name
VITE_DOMAIN=localhost:5173
VITE_CONTACT_EMAIL=contact@example.com
`;
    fs.writeFileSync(envExamplePath, envExampleContent);
    console.log(`${colors.green}✓ Created ${envExamplePath}${colors.reset}`);
  }

  // ==================== SUMMARY ====================
  console.log(`\n${colors.bright}${colors.green}╔══════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bright}${colors.green}║                     Setup Complete! 🎉                       ║${colors.reset}`);
  console.log(`${colors.bright}${colors.green}╚══════════════════════════════════════════════════════════════╝${colors.reset}\n`);

  console.log(`${colors.bright}Configuration Summary:${colors.reset}`);
  console.log(`  ${colors.cyan}Application:${colors.reset} ${config.appName}`);
  console.log(`  ${colors.cyan}Domain:${colors.reset} ${config.appDomain}`);
  console.log(`  ${colors.cyan}Admin Emails:${colors.reset} ${adminEmails.length} configured`);
  console.log(`  ${colors.cyan}Mailgun:${colors.reset} ${config.mailgunApiKey ? '✓ Enabled' : '✗ Not configured'}`);

  console.log(`\n${colors.bright}${colors.yellow}Next Steps:${colors.reset}\n`);
  console.log(`  1. ${colors.cyan}Install dependencies:${colors.reset}`);
  console.log(`     ${colors.yellow}npm --prefix apps/worker install${colors.reset}`);
  console.log(`     ${colors.yellow}npm --prefix apps/web install${colors.reset}\n`);
  
  console.log(`  2. ${colors.cyan}Set up database:${colors.reset}`);
  console.log(`     ${colors.yellow}npm run db:setup${colors.reset}\n`);
  
  console.log(`  3. ${colors.cyan}Start development servers:${colors.reset}`);
  console.log(`     ${colors.yellow}Terminal 1: npm --prefix apps/worker run dev${colors.reset}`);
  console.log(`     ${colors.yellow}Terminal 2: npm --prefix apps/web run dev${colors.reset}\n`);
  
  console.log(`  4. ${colors.cyan}Open browser:${colors.reset}`);
  console.log(`     ${colors.yellow}http://localhost:5173${colors.reset}\n`);

  if (!config.mailgunApiKey) {
    console.log(`${colors.yellow}Note: Collaboration features are disabled without Mailgun.${colors.reset}`);
    console.log(`${colors.yellow}Add your Mailgun credentials to .dev.vars later to enable them.${colors.reset}\n`);
  }

  console.log(`${colors.bright}For production deployment, see:${colors.reset}`);
  console.log(`  ${colors.cyan}CONFIGURATION.md${colors.reset} - Production setup guide`);
  console.log(`  ${colors.cyan}CONTRIBUTING.md${colors.reset} - Development workflow\n`);

  rl.close();
}

// Handle errors
main().catch((error) => {
  console.error(`\n${colors.red}Error: ${error.message}${colors.reset}\n`);
  rl.close();
  process.exit(1);
});
