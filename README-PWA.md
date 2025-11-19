```markdown
# BAT_MEDIA — Invoice & Receipt PWA

What this package contains
- index.html — main app UI (responsive, mobile-first)
- styles.css — all styling and responsive rules
- script.js — app logic: editor, preview, export, history, PWA install prompt
- manifest.json — PWA manifest (standalone)
- service-worker.js — basic service worker for caching
- README.md — this file

Images you must add
- BAT LOGO.png — your logo (place in project root)
- bat signature.png — signature image (place in project root)
- icon-192.png and icon-512.png — app icons used by manifest and install (place in project root).
  If you don't have icons, create 192x192 and 512x512 PNGs from your logo.

How to run locally
1. Place all files in a single folder and add the PNGs above.
2. Serve the folder over HTTPS (or use `npx http-server -c-1` for local testing on localhost).
3. Open the site in Chrome (Android or Desktop). On first loads Chrome will register the service worker.
4. On Android Chrome the browser will show an install prompt OR the in-page install prompt will appear
   (the in-page "Install" button is shown only when `beforeinstallprompt` is fired).
5. Use the Editor to edit company fields and items. Click Preview to see the exact A4 rendering. Use Download PNG/PDF to export documents.

Export size tips
- Default PNG DPI = 200 (good balance between size & quality). Use 300 DPI when you need maximum print sharpness.
- PDF is built by embedding a JPEG of the rendered canvas. The "PDF Image Quality" slider controls JPEG quality (0.6..0.95). Lower quality reduces file size.
- Aim for ~200 DPI + PDF quality 0.85 for typical 1–2MB PDFs.

PWA notes
- The app must be served via HTTPS for install and service worker to work.
- The manifest and icons must be present for the browser to show a proper install UI.
- This project is a PWA (not an APK). If later you want a Play Store APK, I can prepare a Trusted Web Activity (TWA) package using Bubblewrap.

Support
If you'd like I can:
- Generate icon-192.png and icon-512.png from your logo and embed them.
- Tune default DPI/quality to hit a specific PDF size target (e.g., 1.5MB).
- Produce a Bubblewrap project for a Play Store APK.

```