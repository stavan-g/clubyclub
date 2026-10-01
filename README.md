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
4. Make sure you are signed in as `clubyclub.ops@gmail.com`, then select **Deploy → New deployment → Web app**.
5. Set **Execute as** to yourself and **Who has access** to anyone.
6. Deploy, approve the requested Google permissions, and copy the `/exec` web-app URL.
7. Paste that URL into `config.js` as the value of `waitlistEndpoint`.
8. In the function menu, select `authorizeEmail`, click **Run**, and approve the requested mail permission.
9. Update the existing web-app deployment with **Deploy → Manage deployments → Edit → New version → Deploy**.
10. While signed in as `clubyclub.ops@gmail.com`, select `migrateSheetStructure`, click **Run**, and confirm the header row now has `Role` and `Status` and no `Source` column.
11. Submit one test email from the website and confirm both the new Sheet row and confirmation email.
12. While signed in as `clubyclub.ops@gmail.com`, select `setupWeeklySummary`, click **Run**, and approve the trigger permission. A signup digest will be emailed to `clubyclub.ops@gmail.com` every Friday around 5 PM Pacific.

Each row records the server timestamp, email, signup intent, selected role, client timestamp, browser user agent, and status. The form includes a hidden bot-trap field, server-side validation, and a 24-hour duplicate guard keyed by email plus role. A duplicate is neither recorded nor emailed. The script reserves the last available daily MailApp slot for the weekly summary, so the 100th participant attempt is recorded as `quota_reserved_for_summary` rather than sending an email. If the quota is already exhausted, it is recorded as `quota_exceeded`.

Possible statuses include `email_sent`, `quota_reserved_for_summary`, `quota_exceeded`, `email_failed`, `sender_mismatch`, `email_invalid`, `spam_blocked`, `invalid_intent`, and `invalid_role`.

Confirmation emails are restricted to the `clubyclub.ops@gmail.com` sender account and weekly summaries are addressed to `clubyclub.ops@gmail.com`. If the script is authorized, deployed, or scheduled from a different account, the sender check stops the email instead of sending it from the wrong address. Updating the existing deployment keeps the public `/exec` URL the same.

To preview the owner digest immediately, run `sendWeeklySignupSummary` from the Apps Script editor. To stop the scheduled digest, run `disableWeeklySummary`.

Confirm the final email address, website URL, and social handle in the footer before publishing.
