# clubyclub landing page

A responsive one-page marketing site for **clubyclub**, a marketplace that helps student clubs find verified, dependable officers and helps students discover leadership opportunities.

## Preview locally

No installation or build step is required.

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173` in a browser.

## Files

- `index.html` — semantic page structure and content
- `styles.css` — responsive design, animations, and component styles
- `script.js` — mobile menu, filtering, Google Sheet submission, and scroll interactions
- `config.js` — the deployed Google Apps Script endpoint
- `google-apps-script.gs` — server-side code that validates and saves signups
- `favicon.svg` — browser icon

## Connect the signup form to Google Sheets

1. Open `clubyclub_waitlist.xlsx` in Google Sheets, or use the imported Google Sheet supplied with this project.
2. In the Sheet, open **Extensions → Apps Script**.
3. Replace the editor contents with `google-apps-script.gs` and save.
4. Select **Deploy → New deployment → Web app**.
5. Set **Execute as** to yourself and **Who has access** to anyone.
6. Deploy, approve the requested Google permissions, and copy the `/exec` web-app URL.
7. Paste that URL into `config.js` as the value of `waitlistEndpoint`.
8. Submit one test email from the website and confirm a new row appears in the `Signups` tab.

Each row records the server timestamp, email, signup intent, source, client timestamp, and browser user agent. The form includes a hidden bot-trap field and the server validates both email and intent.

Confirm the final email address, website URL, and social handle in the footer before publishing.
