const SHEET_NAME = "Signups";
const ALLOWED_INTENTS = ["waitlist", "create_club", "find_role"];

function doGet() {
  return jsonResponse({ ok: true, service: "clubyclub-signups" });
}

function doPost(event) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const params = event && event.parameter ? event.parameter : {};
    const email = String(params.email || "").trim().toLowerCase();
    const intent = String(params.intent || "waitlist").trim();
    const honeypot = String(params.company || "").trim();

    if (honeypot) {
      return jsonResponse({ ok: true });
    }

    if (!isValidEmail(email)) {
      return jsonResponse({ ok: false, error: "invalid_email" });
    }

    if (!ALLOWED_INTENTS.includes(intent)) {
      return jsonResponse({ ok: false, error: "invalid_intent" });
    }

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName(SHEET_NAME);

    if (!sheet) {
      throw new Error(`Missing sheet: ${SHEET_NAME}`);
    }

    sheet.appendRow([
      new Date(),
      email,
      intent,
      "clubyclub.com",
      String(params.client_time || ""),
      String(params.user_agent || "").slice(0, 500),
    ]);

    SpreadsheetApp.flush();
    return jsonResponse({ ok: true });
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: "server_error" });
  } finally {
    lock.releaseLock();
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
