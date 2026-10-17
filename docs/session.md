# Browser sessions

The UI exchanges a management key once for an 8-hour signed session cookie through `POST /api/session`. `GET /api/session` restores login state on page load, including F5. The session has a fixed expiry; refresh does not extend it. The master key is not stored in localStorage, sessionStorage or files and is cleared from the input after login.

The cookie uses `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, no Domain, and a `__Host-` prefix. Session signatures are domain-separated from file-share signatures and tied to the current management key and request origin. Rotating the management key invalidates all existing browser sessions. No extra Cloudflare binding or credential file is required.

Cookie-authenticated writes require a matching Origin header. Existing Bearer-authenticated command-line clients keep working. The browser uploader uses the same-origin cookie without retaining the management key.

Lock calls `DELETE /api/session` and clears the cookie and sensitive UI state for this browser. Session tokens are stateless: a separately copied token remains valid until expiry or management-key rotation. The frontend clears its state on expiry or a 401 response. The app should be used over HTTPS; local browser handling of Secure cookies varies.

Validation: session persistence across fresh requests, cookie flags, expiry after 8 hours, tampering, origin binding, key rotation, cookie-authenticated uploads, write-origin checks and cookie clearing are tested in Miniflare and unit tests. The full suite contains 11 passing tests. Actual browser refresh and cross-tab behavior remain manual checks.

Changes were made in the canonical repository at D:\serverless-cloud-file-storage. Existing local README edits were preserved without committing them.

Cookie attribute reference: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie
