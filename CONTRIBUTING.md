# Contributing to Polycrisis Intelligence

Thank you for your interest in contributing! This document outlines how you can help improve the WSSI platform.

## Code of Conduct

Be respectful. Assume good intent. Focus on constructive feedback.

## Ways to Contribute

### 1. Report Issues

Found a bug or have a suggestion? Open an issue with:
- Clear description
- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Screenshots if applicable

### 2. Submit Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Test thoroughly
5. Commit with clear messages
6. Push to your fork
7. Open a Pull Request

### 3. Add Data Sources

We're always looking to expand WSSI coverage:
- Open data APIs with economic, climate, or geopolitical indicators
- Historical datasets for backtesting
- Documentation for new data integrations

See `docs/research/` (in development) for data source requirements.

### 4. Improve Documentation

- Fix typos
- Clarify explanations
- Add examples
- Translate (coming soon)

## Development Setup

```bash
# Clone
git clone https://github.com/TashiikiD/Polycrisis-Intelligence.git
cd Polycrisis-Intelligence

# Dashboard
cd dashboard/v2
python -m http.server 8000

# Or React version (WIP)
cd apps/web
npm install
npm run dev

# API
cd wssi-api
pip install -r requirements.txt
uvicorn main:app --reload
```

## Project Structure

```
dashboard/        # Web dashboard (vanilla JS)
apps/web/         # React dashboard (WIP)
wssi-api/         # FastAPI backend
legal/            # Terms, Privacy
```

## Coding Standards

- **JavaScript/TypeScript:** ESLint + Prettier
- **Python:** PEP 8, type hints encouraged
- **CSS:** Tailwind utility classes (React app)
- **Commits:** Clear, descriptive messages

## Questions?

Open a Discussion or reach out via GitHub issues.

---

Built with 🌩️ by contributors like you.
