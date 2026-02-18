# Contributing to Photos

Thank you for your interest in contributing to this project! 🎉

## Quick Start

For setup instructions, development workflow, and contribution guidelines, please see:

**[Full Contributing Guide](./docs/contributing.md)**

## TL;DR

1. **Setup:**
   ```bash
   npm install
   cd apps/worker && npm install
   cd ../web && npm install
   ```

2. **Development:**
   ```bash
   # Terminal 1: Worker
   cd apps/worker && npm run dev
   
   # Terminal 2: Web
   cd apps/web && npm run dev
   ```

3. **Testing:**
   ```bash
   npm test
   npm run test:e2e
   ```

4. **Before PR:**
   - Run tests and linting: `npm test && npm run lint`
   - Create a feature branch: `git checkout -b feature/your-feature`
   - Commit with conventional commits: `git commit -m "feat: add feature"`
   - Push and open a pull request

## Project Structure

```
.
├── apps/
│   ├── web/        # React frontend
│   ├── worker/     # Cloudflare Worker backend
│   └── android/    # Android native app
├── docs/           # Documentation
├── migrations/     # Database migrations
├── scripts/        # Setup and deployment scripts
└── README.md       # Project overview
```

## Code of Conduct

We are committed to providing a welcoming and inclusive environment for all contributors. Please review the Code of Conduct in [docs/contributing.md](./docs/contributing.md) for more information.

## Questions?

- 📖 Check the [docs](./docs/) folder
- 💬 Open a GitHub Discussion
- 🐛 Report bugs as GitHub Issues
- 📝 Read the [full contributing guide](./docs/contributing.md)

Happy contributing! 🚀
