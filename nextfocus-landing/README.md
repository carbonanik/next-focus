# NextFocus Landing Page

Responsive single-file marketing site for NextFocus. The product screenshot is stored in `assets/dashboard.png`, and `assets/background.png` provides the landing page's textured background. The repository root redirects to this page for GitHub Pages; the landing page's **Get Started** links open `../app.html`.

## Preview locally

Run `python3 -m http.server 8000` from the repository root and open `http://localhost:8000/`.

## Publishing

Publish from the repository root using GitHub Pages (**Settings → Pages → Deploy from a branch → `/ (root)`**). The landing page and the app are both static files; no build command is needed.

Before launch, confirm product descriptions and claims. `assets/dashboard.png` is a generated UI concept, not a verified capture from the live extension. Add a domain, favicon, privacy policy, and analytics only if appropriate. Fonts load from Google Fonts and fall back to system fonts offline.
