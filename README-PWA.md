```markdown
# PWA files for Bat Media (what I added and how to use them)

What I added
- service-worker.js — improved caching & offline handling.
- register-sw.js — registration and install/update UI hooks.
- manifest.json — ready-to-edit PWA manifest.
- offline.html — offline fallback page.

Where to place files
- Put service-worker.js and offline.html at your site root (so scope is '/').
- Put manifest.json at site root and update <link rel="manifest" href="/manifest.json"> in your <head>.
- Place register-sw.js in your assets and include it before </body>:
  <script src="/register-sw.js"></script>

Icons
- Provide /icon-192.png and /icon-512.png at site root (or update paths in manifest and precache).

Testing locally
1. Serve your site over HTTPS. For local dev, Chrome allows service workers on http://localhost.
2. Open DevTools > Application:
   - Check 'Service Workers' to confirm registration.
   - Inspect Cache Storage to see the precache and runtime caches.
3. Simulate offline: DevTools > Network > Offline. Reload a navigated page to see offline.html served.

Updating / releasing a new service worker
- Bump CACHE_VERSION in service-worker.js (e.g., v3) and deploy.
- The new SW will install and wait. You can show an "Update" button that sends SKIP_WAITING to the SW (see register-sw.js).
- After activating, refresh clients or prompt users to reload.

Notes & recommendations
- Keep large vendor libraries out of precache if you don't need them immediately offline; rely on runtime stale-while-revalidate to reduce deploy size.
- Monitor your cache usage (Quota and DevTools) on target devices.
- For Play Store or other packaging later, you can use Bubblewrap / TWA; for web install, this is all you need.

Security
- Do NOT cache private API responses or pages that contain user-sensitive data.
- Only precache static app shell assets.

If you want me to add these files to your repo as a new branch and open a PR, tell me the branch name and whether to place files at the repository root or a subfolder (e.g., /public).
```