# Authenticated Chrome review

Playwright's normal `open` command creates an isolated browser profile. It does not
share the cookies from your everyday Chrome, so it cannot prove authenticated Trove
screens work.

To let the agent inspect the Chrome session you are already signed into:

1. In that Chrome window, open `chrome://inspect/#remote-debugging`.
2. Turn on **Allow remote debugging for this browser instance**.
3. From the repository root, run:

   ```bash
   ./scripts/playwright-current-chrome.sh attach
   ```

4. Leave that Chrome window open. The agent can now use the same session with:

   ```bash
   ./scripts/playwright-current-chrome.sh goto http://localhost:3000/trips
   ./scripts/playwright-current-chrome.sh snapshot
   ```

5. When the review is complete, detach without closing Chrome:

   ```bash
   ./scripts/playwright-current-chrome.sh detach
   ```

This setup attaches over Chrome DevTools Protocol. It does not copy cookies,
credentials, or storage into the repository. Do not use `close` on the attached
session unless you intend to close the browser page; use `detach` instead.
