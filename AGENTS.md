# Repository guidance

- Keep `README.md` concise, in English, and limited to an introduction, features, playground screenshots, and license. Keep the Korean version in `docs/README.ko.md`.
- Keep `docs/` for public reader documentation and assets only. Do not commit release checklists, publishing notes, or test strategy documents there.
- Before making the repository public, review tracked files and Git history for personal information, local paths, credentials, and private assets. Publish from fresh history if old commit metadata contains personal information. Ignore generated files and keep screenshots in English, optimized as equal-size WebP images.
- Keep the root, app, fixture, and package versions aligned with `CHANGELOG.md`.
- Run relevant type checks and tests before releasing. Keep operational release and test notes out of public docs.
