# Contributing Guide

Thank you for your interest in contributing to this photo sharing application! This guide will help you get started.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Feature Requests](#feature-requests)
- [Bug Reports](#bug-reports)
- [Documentation](#documentation)
- [Community](#community)

## Code of Conduct

### Our Pledge

We are committed to providing a welcoming and inclusive environment for all contributors, regardless of background or experience level.

### Expected Behavior

- Be respectful and considerate
- Welcome newcomers and help them get started
- Provide constructive feedback
- Focus on what is best for the project
- Show empathy towards other contributors

### Unacceptable Behavior

- Harassment or discrimination of any kind
- Trolling or insulting comments
- Personal or political attacks
- Publishing others' private information
- Other conduct which could reasonably be considered inappropriate

### Reporting

If you experience or witness unacceptable behavior, please report it to the project maintainers.

## Getting Started

### Prerequisites

Before contributing, ensure you have:

- **Node.js** 18+ installed
- **npm** or **yarn** package manager
- **Git** for version control
- **Cloudflare account** (free tier is fine)
- **Wrangler CLI** installed globally
- Basic knowledge of TypeScript and React
- Familiarity with git workflows

### First Time Contributors

If you're new to open source, start with:

1. Issues labeled `good first issue`
2. Documentation improvements
3. Test coverage improvements
4. Minor bug fixes

Don't be afraid to ask questions in discussions or issue comments!

## Development Setup

### 1. Fork and Clone

```bash
# Fork the repository on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/photo-sharing-app.git
cd photo-sharing-app/subdomains/photos
```

### 2. Install Dependencies

```bash
# Worker dependencies
cd apps/worker
npm install

# Web dependencies
cd ../web
npm install
```

### 3. Configure Environment

Create `.dev.vars` in `apps/worker/`:

```bash
# Required for local development
ADMIN_EMAILS=your-email@example.com
JWT_SECRET=local-dev-secret-change-in-production
EVENT_COOKIE_SECRET=another-local-secret
ACCESS_TEAM_DOMAIN=your-domain.cloudflare.com
ACCESS_AUD=your-aud-value

# Optional for testing collaboration features
MAILGUN_API_KEY=your-mailgun-key
MAILGUN_DOMAIN=your-mailgun-domain

# Branding (optional)
APP_NAME=Photos Local Dev
BRAND_NAME=Your Name
COPYRIGHT_HOLDER=Your Name
APP_DOMAIN=localhost:5173
CONTACT_EMAIL=your-email@example.com
```

Create `.env.local` in `apps/web/`:

```bash
VITE_API_URL=http://localhost:8787
VITE_APP_NAME=Photos Local Dev
VITE_BRAND_NAME=Your Name
VITE_COPYRIGHT_HOLDER=Your Name
```

### 4. Set Up Database

```bash
cd apps/worker

# Create local D1 database
wrangler d1 create photos-db-local

# Update wrangler.toml with local database_id

# Run migrations
wrangler d1 migrations apply photos-db-local --local
```

### 5. Set Up R2 Bucket

```bash
# Create development R2 bucket (or use local simulator)
wrangler r2 bucket create photos-dev

# Update wrangler.toml with dev bucket name
```

### 6. Start Development Servers

```bash
# Terminal 1: Worker (backend)
cd apps/worker
npm run dev
# Runs on http://localhost:8787

# Terminal 2: Web (frontend)
cd apps/web
npm run dev
# Runs on http://localhost:5173
```

### 7. Verify Setup

- Visit http://localhost:5173
- Check browser console for errors
- Try viewing the gallery (should be empty)
- Test admin access with your ADMIN_EMAILS

## Project Structure

```
subdomains/photos/
├── apps/
│   ├── worker/               # Backend (Cloudflare Worker)
│   │   ├── src/
│   │   │   ├── routes/       # API endpoints
│   │   │   │   └── admin/    # Admin-only routes (modular)
│   │   │   ├── config.ts     # Configuration system
│   │   │   ├── features.ts   # Feature flag system
│   │   │   ├── auth.ts       # Authentication middleware
│   │   │   └── index.ts      # Worker entry point
│   │   ├── wrangler.toml     # Worker configuration
│   │   └── package.json
│   │
│   └── web/                  # Frontend (React SPA)
│       ├── src/
│       │   ├── components/   # Reusable UI components
│       │   ├── contexts/     # React contexts
│       │   ├── hooks/        # Custom hooks
│       │   ├── pages/        # Route components
│       │   ├── services/     # Business logic
│       │   ├── utils/        # Utilities
│       │   └── config.ts     # Runtime config
│       ├── android/          # Capacitor Android
│       └── package.json
│
└── migrations/               # D1 database migrations
```

## Development Workflow

### Branch Naming

Use descriptive branch names:

```bash
# Features
git checkout -b feature/add-video-transcoding
git checkout -b feature/bulk-download

# Bug fixes
git checkout -b fix/safari-upload-issue
git checkout -b fix/geocoding-timeout

# Documentation
git checkout -b docs/update-api-docs
git checkout -b docs/add-deployment-guide

# Refactoring
git checkout -b refactor/split-admin-routes
git checkout -b refactor/extract-upload-logic
```

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples:**

```bash
feat(worker): add video transcoding support

Implements video transcoding using Cloudflare Stream API.
Includes thumbnail generation and adaptive bitrate streaming.

Closes #123

---

fix(web): resolve Safari upload issue

Safari was not properly handling multipart uploads due to
missing Content-Type header. Added explicit header.

Fixes #456

---

docs(readme): update installation instructions

Added troubleshooting section for common D1 migration errors.

---

refactor(admin): extract event routes to separate module

Split admin.ts from 1058 lines to modular structure.
Created admin/events.ts, admin/photos.ts, etc.

Part of #789
```

### Pull Request Process

1. **Create Branch**
   ```bash
   git checkout -b feature/your-feature
   ```

2. **Make Changes**
   - Write code following style guide
   - Add tests for new functionality
   - Update documentation as needed

3. **Test Locally**
   ```bash
   # Run tests
   cd apps/web && npm test
   cd apps/worker && npm test
   
   # Check types
   npm run type-check
   
   # Lint code
   npm run lint
   ```

4. **Commit Changes**
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

5. **Keep Branch Updated**
   ```bash
   git fetch origin
   git rebase origin/main
   ```

6. **Push to Fork**
   ```bash
   git push origin feature/your-feature
   ```

7. **Open Pull Request**
   - Go to GitHub and create PR
   - Fill out PR template
   - Link related issues
   - Request review

8. **Address Feedback**
   - Make requested changes
   - Push updates to same branch
   - Respond to comments

9. **Merge**
   - Maintainer will merge when approved
   - Delete branch after merge

## Coding Standards

### TypeScript

**Use Explicit Types:**

```typescript
// Good
function getEvent(slug: string): Event | null {
  // ...
}

// Avoid
function getEvent(slug) {
  // ...
}
```

**Prefer Interfaces for Objects:**

```typescript
// Good
interface Event {
  id: number;
  slug: string;
  title: string;
}

// Avoid any
const event: any = { ... };
```

**Use Enums Sparingly:**

```typescript
// Prefer literal types
type MediaType = 'photo' | 'video';

// Over enums
enum MediaType {
  Photo = 'photo',
  Video = 'video'
}
```

### React

**Use Functional Components:**

```typescript
// Good
const PhotoCard: React.FC<PhotoCardProps> = ({ photo }) => {
  return <div>...</div>;
};

// Avoid class components
class PhotoCard extends React.Component {
  // ...
}
```

**Custom Hooks for Logic:**

```typescript
// Extract reusable logic into hooks
function usePhotoSelection(photos: Photo[]) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // ... logic
  return { selected, toggleSelection, clearSelection };
}
```

**Keep Components Small:**

```typescript
// Split large components into smaller ones
// AdminEventUpload.tsx (600 lines)
//   ↓
// AdminEventUpload.tsx (400 lines)
// + EventLocationPicker.tsx (120 lines)
// + UploadQueueList.tsx (115 lines)
```

### Hono Routes

**Modular Route Organization:**

```typescript
// Good: Separate concerns
// routes/admin/events.ts
const app = new Hono<{ Bindings: Env }>();
app.get('/', listEvents);
app.post('/', createEvent);
export default app;

// Avoid: Everything in one file
// routes/admin.ts (1058 lines)
```

**Use Middleware:**

```typescript
// Good: Reusable middleware
app.use('/*', requireAuth);
app.use('/admin/*', requireAdmin);

// Avoid: Checking auth in every route
app.get('/admin/events', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Forbidden' }, 403);
  // ...
});
```

### Naming Conventions

**Files:**
- Components: `PascalCase.tsx` (PhotoCard.tsx)
- Hooks: `camelCase.ts` (usePhotoSelection.ts)
- Utils: `camelCase.ts` (imageUtils.ts)
- Routes: `kebab-case.ts` (admin-routes.ts) or `camelCase.ts`

**Variables:**
- Constants: `UPPER_SNAKE_CASE` (MAX_FILE_SIZE)
- Variables: `camelCase` (photoList)
- Types: `PascalCase` (PhotoCardProps)

**Functions:**
- Functions: `camelCase` (getEvent, createPhoto)
- React Components: `PascalCase` (PhotoCard)
- Hooks: `camelCase` starting with `use` (useAuth)

### Code Organization

**Import Order:**

```typescript
// 1. React/external libraries
import React, { useState } from 'react';
import { Hono } from 'hono';

// 2. Internal modules (absolute imports)
import { requireAuth } from '@/auth';
import { getConfig } from '@/config';

// 3. Relative imports
import { PhotoCard } from './PhotoCard';
import type { Photo } from '../types';

// 4. Assets/styles
import './styles.css';
```

**Avoid Barrel Exports:**

```typescript
// Avoid: index.ts that re-exports everything
export * from './PhotoCard';
export * from './EventCard';

// Prefer: Direct imports
import { PhotoCard } from './components/PhotoCard';
```

### Comments

**Doc Comments for Public APIs:**

```typescript
/**
 * Uploads a photo to an event with multipart upload
 * @param eventSlug - The event slug
 * @param file - The file to upload
 * @returns Upload ID and signed URLs for parts
 */
async function startUpload(eventSlug: string, file: File) {
  // ...
}
```

**Inline Comments for Complex Logic:**

```typescript
// Calculate optimal part size based on file size
// R2 requires 5MB minimum parts, except for last part
const partSize = Math.max(5 * 1024 * 1024, Math.ceil(fileSize / 100));
```

**Avoid Obvious Comments:**

```typescript
// Bad
const photos = []; // initialize photos array

// Good (no comment needed)
const photos: Photo[] = [];
```

## Testing

### Unit Tests (Vitest)

```typescript
// components/PhotoCard.test.tsx
import { render, screen } from '@testing-library/react';
import { PhotoCard } from './PhotoCard';

describe('PhotoCard', () => {
  it('should render photo with correct src', () => {
    const photo = { id: 1, preview_url: 'https://...', ... };
    render(<PhotoCard photo={photo} />);
    
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', photo.preview_url);
  });
  
  it('should call onSelect when clicked', () => {
    const onSelect = vi.fn();
    const photo = { id: 1, ... };
    render(<PhotoCard photo={photo} onSelect={onSelect} />);
    
    screen.getByRole('img').click();
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});
```

### E2E Tests (Playwright)

```typescript
// e2e/gallery.spec.ts
import { test, expect } from '@playwright/test';

test('should display event gallery', async ({ page }) => {
  await page.goto('/events/summer-festival-2024');
  
  // Check event title
  await expect(page.locator('h1')).toContainText('Summer Festival 2024');
  
  // Check photos are loaded
  const photos = page.locator('[data-testid="photo-card"]');
  await expect(photos).toHaveCount(await photos.count());
});

test('should open lightbox on photo click', async ({ page }) => {
  await page.goto('/events/summer-festival-2024');
  
  // Click first photo
  await page.locator('[data-testid="photo-card"]').first().click();
  
  // Check lightbox opens
  await expect(page.locator('[data-testid="lightbox"]')).toBeVisible();
});
```

### Running Tests

```bash
# Unit tests
npm test

# Unit tests (watch mode)
npm test -- --watch

# E2E tests
npm run test:e2e

# E2E tests (headed)
npm run test:e2e -- --headed

# Type checking
npm run type-check

# Linting
npm run lint
```

### Test Coverage

Aim for:
- **Critical paths:** 100% coverage (auth, uploads)
- **Components:** 80%+ coverage
- **Utilities:** 90%+ coverage
- **Routes:** 70%+ coverage

```bash
# Generate coverage report
npm test -- --coverage
```

## Submitting Changes

### Pull Request Template

When opening a PR, include:

```markdown
## Description
Brief description of what this PR does.

## Type of Change
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update

## Related Issues
Closes #123
Related to #456

## Testing
- [ ] Unit tests added/updated
- [ ] E2E tests added/updated
- [ ] Manual testing performed

## Screenshots (if applicable)
[Add screenshots for UI changes]

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex code
- [ ] Documentation updated
- [ ] No new warnings generated
- [ ] Tests pass locally
- [ ] Dependent changes merged
```

### Review Process

1. **Automated Checks**
   - Tests must pass
   - Linting must pass
   - Type checking must pass
   - No merge conflicts

2. **Code Review**
   - At least one approval required
   - Address all comments
   - Keep discussions constructive

3. **Merge Requirements**
   - All checks passing
   - Approved by maintainer
   - Up to date with main branch
   - Squash commits if requested

## Feature Requests

### Proposing Features

1. **Check Existing Issues**
   - Search for similar requests
   - Comment on existing issues

2. **Open Discussion**
   - Create GitHub Discussion
   - Explain use case
   - Describe desired behavior
   - Suggest implementation approach

3. **Get Feedback**
   - Wait for maintainer response
   - Discuss alternatives
   - Refine proposal

4. **Create Issue**
   - If approved, create detailed issue
   - Use feature request template
   - Link to discussion

### Feature Request Template

```markdown
## Feature Description
Clear description of the feature.

## Use Case
Explain why this feature is needed.

## Proposed Solution
How you think it should work.

## Alternatives Considered
Other approaches you've considered.

## Additional Context
Screenshots, mockups, links, etc.

## Implementation Notes
Technical considerations (optional).
```

## Bug Reports

### Reporting Bugs

1. **Search Existing Issues**
   - Check if already reported
   - Add info to existing issue

2. **Create Detailed Report**
   - Use bug report template
   - Include reproduction steps
   - Add error messages/logs
   - Specify environment

### Bug Report Template

```markdown
## Bug Description
Clear description of the bug.

## Steps to Reproduce
1. Go to '...'
2. Click on '...'
3. Scroll down to '...'
4. See error

## Expected Behavior
What should happen.

## Actual Behavior
What actually happens.

## Screenshots
If applicable.

## Environment
- OS: [e.g. macOS 14.1]
- Browser: [e.g. Chrome 120]
- Version: [e.g. v1.0.0]
- Node: [e.g. 18.19.0]

## Error Messages
```
Paste error logs here
```

## Additional Context
Any other relevant information.
```

## Documentation

### What to Document

- New features or changes to existing features
- Configuration options
- API endpoints
- Complex algorithms or business logic
- Setup instructions
- Troubleshooting guides

### Documentation Style

- Write clear, concise sentences
- Use active voice
- Include code examples
- Add screenshots for UI features
- Keep README.md updated
- Update CHANGELOG.md

### Documentation Files

- **README.md** - Project overview
- **CONFIGURATION.md** - Setup guide
- **API.md** - API reference
- **ARCHITECTURE.md** - Technical overview
- **FEATURES.md** - Feature descriptions
- **CONTRIBUTING.md** - This file
- **CHANGELOG.md** - Version history

## Community

### Communication Channels

- **GitHub Issues** - Bug reports, feature requests
- **GitHub Discussions** - Questions, ideas, general discussion
- **Pull Requests** - Code review, implementation discussion

### Getting Help

- Check documentation first
- Search existing issues
- Ask in GitHub Discussions
- Be patient and respectful

### Helping Others

- Answer questions in discussions
- Review pull requests
- Improve documentation
- Share your use cases

## Recognition

Contributors are recognized in:
- README.md contributors section
- CHANGELOG.md for significant contributions
- GitHub contributors page

Thank you for contributing! 🎉

---

## Quick Reference

```bash
# Setup
git clone <fork>
cd subdomains/photos/apps/worker && npm install
cd ../web && npm install

# Development
npm run dev          # Start dev server
npm test            # Run tests
npm run lint        # Check code style
npm run type-check  # Check types

# Before PR
npm test            # Tests pass
npm run lint        # No lint errors
npm run type-check  # No type errors
git rebase origin/main  # Up to date

# Commit
git add .
git commit -m "feat: add feature"
git push origin feature-branch

# Create PR on GitHub
```

## License

By contributing, you agree that your contributions will be licensed under the same license as the project (see LICENSE file).

## Questions?

Don't hesitate to ask! Open a discussion or comment on an issue.

Happy contributing! 🚀
