# Deploying Pixoto

Pixoto is a static folder. Upload the **contents of `app/`** unchanged to any web host (PHP 7.4 shared hosting is fine; PHP is not used).

1. Upload `app/` by FTP or the file manager to any folder (root or a sub-folder: all paths are relative).
2. Open the folder's URL. HTTPS is needed for install/offline (service worker); the editor itself works over HTTP.
3. Optional: keep `.htaccess` (MIME types and caching only; no rewrite rules). If the host rejects it, delete it.
4. After changing files, run `python3 tools/make-sw.py` locally (refreshes the offline file list) before uploading.

Notes: ES modules and the worker need `.js` served as JavaScript (the `.htaccess` sets it); no CDN, nothing runs on the server; all data stays in the visitor's browser.
