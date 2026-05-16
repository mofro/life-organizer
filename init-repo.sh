#!/bin/bash
# Git initialization and push script
# Run this after creating the GitHub repository

echo "Initializing git repository..."
cd /Users/mo/Code/life-organizer

# Initialize git
git init

# Add all files
git add .

# Initial commit
git commit -m "Initial commit: Life Organizer project setup

- Complete ARD (Architecture Requirements Document) with full discussion
- Implementation plan with Beads task structure
- README with project overview
- .gitignore configured
- Beads initialized for task tracking
- Phase 0 foundation complete

Next: Begin Phase 1 (Working MVP Artifact)"

echo ""
echo "✅ Repository initialized and committed locally"
echo ""
echo "Next steps:"
echo "1. Create GitHub repository at: https://github.com/new"
echo "   - Name: life-organizer"
echo "   - Description: AI-powered productivity app with MCP integrations"
echo "   - Public or Private: Your choice"
echo "   - DO NOT initialize with README (we have one)"
echo ""
echo "2. Add remote and push:"
echo "   git remote add origin https://github.com/YOUR-USERNAME/life-organizer.git"
echo "   git branch -M main"
echo "   git push -u origin main"
echo ""
echo "Or use GitHub CLI:"
echo "   gh repo create life-organizer --public --source=. --remote=origin --push"
