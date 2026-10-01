const SHEET_NAME = "Signups";
const CLUBYCLUB_OPS_EMAIL = "clubyclub.ops@gmail.com";
const ALLOWED_INTENTS = ["waitlist", "create_club", "find_role"];
const ALLOWED_ROLES = ["Vice President", "Treasurer", "Secretary", "Marketing Officer", "President", "Other"];
const SUMMARY_TIME_ZONE = "America/Los_Angeles";
const SUMMARY_SPREADSHEET_ID_PROPERTY = "WEEKLY_SUMMARY_SPREADSHEET_ID";
const SHEET_HEADERS = [
  "Submitted at",
  "Email",
  "Intent",
  "Role",
  "Client time",
  "User agent",
  "Status",
];

function doGet() {
  return jsonResponse({ ok: true, service: "clubyclub-signups" });
}

// Run this once from the Apps Script editor after adding email confirmations.
function authorizeEmail() {
  assertClubyclubOpsAccount();
  return MailApp.getRemainingDailyQuota();
}

// Run once to send the owner a weekly digest on Fridays around 5 PM Pacific.
function setupWeeklySummary() {
  const sender = assertClubyclubOpsAccount();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new Error("Open this script from the clubyclub Google Sheet before running setup.");
  }

  const sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Missing sheet: ${SHEET_NAME}`);
  ensureHeaders(sheet);

  PropertiesService.getScriptProperties().setProperty(
    SUMMARY_SPREADSHEET_ID_PROPERTY,
    spreadsheet.getId(),
  );

  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === "sendWeeklySignupSummary")
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger("sendWeeklySignupSummary")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.FRIDAY)
    .atHour(17)
    .nearMinute(0)
    .inTimezone(SUMMARY_TIME_ZONE)
    .create();

  return `Weekly summaries will be sent from ${sender} to ${CLUBYCLUB_OPS_EMAIL} on Fridays around 5 PM Pacific.`;
}

// Run once after updating the script to migrate the header row immediately.
function migrateSheetStructure() {
  assertClubyclubOpsAccount();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("Open this script from the clubyclub Google Sheet before running the migration.");
  const sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Missing sheet: ${SHEET_NAME}`);
  ensureHeaders(sheet);
  return `Sheet migrated to: ${SHEET_HEADERS.join(" | ")}`;
}

function disableWeeklySummary() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === "sendWeeklySignupSummary")
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
}

function doPost(event) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  let sheet;
  let rowNumber;
  let email;
  let intent;
  let role;

  try {
    const params = event && event.parameter ? event.parameter : {};
    email = String(params.email || "").trim().toLowerCase();
    intent = String(params.intent || "waitlist").trim();
    role = String(params.role || "").trim();
    const honeypot = String(params.company || "").trim();

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) throw new Error("No active spreadsheet is connected to this script.");
    sheet = spreadsheet.getSheetByName(SHEET_NAME);
    if (!sheet) throw new Error(`Missing sheet: ${SHEET_NAME}`);
    ensureHeaders(sheet);

    if (honeypot) {
      appendStatusRow(sheet, params, email, intent, role, "spam_blocked");
      return jsonResponse({ ok: true, status: "spam_blocked" });
    }

    if (!isValidEmail(email)) {
      appendStatusRow(sheet, params, email, intent, role, "email_invalid");
      return jsonResponse({ ok: false, error: "invalid_email", status: "email_invalid" });
    }

    if (!ALLOWED_INTENTS.includes(intent)) {
      appendStatusRow(sheet, params, email, intent, role, "invalid_intent");
      return jsonResponse({ ok: false, error: "invalid_intent", status: "invalid_intent" });
    }

    if (intent === "find_role" && !ALLOWED_ROLES.includes(role)) {
      appendStatusRow(sheet, params, email, intent, role, "invalid_role");
      return jsonResponse({ ok: false, error: "invalid_role", status: "invalid_role" });
    }

    if (intent !== "find_role") {
      role = "";
    }

    if (hasRecentDuplicate(sheet, email, role)) {
      return jsonResponse({ ok: true, duplicate: true, email_sent: false, status: "duplicate_24h" });
    }

    rowNumber = appendStatusRow(sheet, params, email, intent, role, "pending");
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: "server_error" });
  } finally {
    lock.releaseLock();
  }

  const emailStatus = sendConfirmationEmail(email, intent, role);
  sheet.getRange(rowNumber, 7).setValue(emailStatus);
  SpreadsheetApp.flush();

  return jsonResponse({ ok: true, email_sent: emailStatus === "email_sent", status: emailStatus });
}

function ensureHeaders(sheet) {
  const existingColumnCount = Math.max(sheet.getLastColumn(), 1);
  const existingHeaders = sheet.getRange(1, 1, 1, existingColumnCount).getValues()[0];

  // Migrate the original six-column layout by inserting Role before Source, then remove Source.
  if (existingHeaders[3] === "Source" && !existingHeaders.includes("Role")) {
    sheet.insertColumnAfter(3);
    sheet.deleteColumn(5);
  } else if (existingHeaders[4] === "Source") {
    // Migrate the previous eight-column layout by removing Source.
    sheet.deleteColumn(5);
  }

  const headerRange = sheet.getRange(1, 1, 1, SHEET_HEADERS.length);
  headerRange.setValues([SHEET_HEADERS]);
}

function appendStatusRow(sheet, params, email, intent, role, status) {
  sheet.appendRow([
    new Date(),
    email,
    intent,
    role,
    String(params.client_time || ""),
    String(params.user_agent || "").slice(0, 500),
    status,
  ]);
  SpreadsheetApp.flush();
  return sheet.getLastRow();
}

function hasRecentDuplicate(sheet, email, role) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedRole = String(role || "").trim().toLowerCase();
  const rows = sheet.getRange(2, 1, lastRow - 1, 4).getValues();

  return rows.some((row) => {
    const submittedAt = row[0] instanceof Date ? row[0].getTime() : new Date(row[0]).getTime();
    return submittedAt >= cutoff
      && String(row[1] || "").trim().toLowerCase() === normalizedEmail
      && String(row[3] || "").trim().toLowerCase() === normalizedRole;
  });
}

function sendConfirmationEmail(email, intent, role) {
  const sender = getEffectiveUserEmail();

  if (sender !== CLUBYCLUB_OPS_EMAIL) {
    console.error(`Confirmation not sent: deploy the web app from ${CLUBYCLUB_OPS_EMAIL}. Current sender: ${sender || "unknown"}`);
    return "sender_mismatch";
  }

  try {
    const remainingQuota = MailApp.getRemainingDailyQuota();
    if (remainingQuota <= 0) {
      return "quota_exceeded";
    }
    if (remainingQuota === 1) {
      return "quota_reserved_for_summary";
    }

    const selection = getSelectionLabel(intent, role);
    const subject = "You’re on the clubyclub waitlist";
    const body = [
      "You’re officially on the clubyclub waitlist!",
      "",
      `Your selection: ${selection}`,
      "",
      "We saved your spot and will reach out as club opportunities become available.",
      "",
      "— The clubyclub team",
      "clubyclub.com",
      "",
      "If you didn’t submit this email, you can safely ignore this message.",
    ].join("\n");

    const htmlBody = `
      <div style="margin:0;padding:32px 16px;background:#f4f0e6;font-family:Arial,sans-serif;color:#15213a">
        <div style="max-width:560px;margin:0 auto;overflow:hidden;background:#ffffff;border-radius:20px">
          <div style="padding:28px 32px;background:#132449;color:#ffffff">
            <div style="font-size:22px;font-weight:800">cluby<span style="color:#dfff67">club</span></div>
          </div>
          <div style="padding:34px 32px">
            <p style="margin:0 0 12px;color:#65708a;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">You’re confirmed</p>
            <h1 style="margin:0 0 18px;font-size:28px;line-height:1.15;color:#132449">You’re officially on the waitlist!</h1>
            <p style="margin:0 0 22px;font-size:16px;line-height:1.6">We saved your spot for <strong>${escapeHtml(selection)}</strong>.</p>
            <div style="margin:0 0 24px;padding:18px 20px;background:#eef2ff;border-radius:14px">
              <strong style="display:block;margin-bottom:6px;color:#132449">What happens next?</strong>
              <span style="font-size:14px;line-height:1.55;color:#536078">We’ll keep your place and reach out as club opportunities and early access become available.</span>
            </div>
            <p style="margin:0;font-size:15px;line-height:1.6">Good people find good people.<br><strong>— The clubyclub team</strong></p>
          </div>
          <div style="padding:18px 32px;background:#f8f8f6;color:#7a8190;font-size:11px;line-height:1.5">
            You received this because this address was submitted at clubyclub.com. If that wasn’t you, you can safely ignore this email.
          </div>
        </div>
      </div>`;

    MailApp.sendEmail({
      to: email,
      subject,
      body,
      htmlBody,
      name: "clubyclub",
      replyTo: CLUBYCLUB_OPS_EMAIL,
    });

    return "email_sent";
  } catch (error) {
    console.error(error);
    return "email_failed";
  }
}

function sendWeeklySignupSummary() {
  assertClubyclubOpsAccount();
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = properties.getProperty(SUMMARY_SPREADSHEET_ID_PROPERTY);

  const spreadsheet = spreadsheetId
    ? SpreadsheetApp.openById(spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new Error("Run setupWeeklySummary once before sending a summary.");
  }
  const sheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    throw new Error(`Missing sheet: ${SHEET_NAME}`);
  }

  ensureHeaders(sheet);

  const now = new Date();
  const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const values = sheet.getDataRange().getValues();
  const records = values.slice(1)
    .map((row) => ({
      submittedAt: row[0] instanceof Date ? row[0] : new Date(row[0]),
      email: String(row[1] || ""),
      intent: String(row[2] || "waitlist"),
      role: String(row[3] || ""),
      status: String(row[6] || "not_recorded"),
    }))
    .filter((record) => !Number.isNaN(record.submittedAt.getTime()) && record.submittedAt >= cutoff)
    .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());

  const intentCounts = {
    create_club: records.filter((record) => record.intent === "create_club").length,
    find_role: records.filter((record) => record.intent === "find_role").length,
    waitlist: records.filter((record) => record.intent === "waitlist").length,
  };
  const roleCounts = records.reduce((counts, record) => {
    if (record.role) counts[record.role] = (counts[record.role] || 0) + 1;
    return counts;
  }, {});
  const statusCounts = records.reduce((counts, record) => {
    counts[record.status] = (counts[record.status] || 0) + 1;
    return counts;
  }, {});

  const roleSummary = Object.entries(roleCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([role, count]) => `${role}: ${count}`);
  const statusSummary = Object.entries(statusCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => `${status}: ${count}`);
  const recentRecords = records.slice(0, 25);
  const formattedPeriod = `${Utilities.formatDate(cutoff, SUMMARY_TIME_ZONE, "MMM d")}–${Utilities.formatDate(now, SUMMARY_TIME_ZONE, "MMM d, yyyy")}`;
  const subject = `clubyclub weekly summary — ${records.length} new signup${records.length === 1 ? "" : "s"}`;
  const bodyRows = recentRecords.length
    ? recentRecords.map((record) => [
      Utilities.formatDate(record.submittedAt, SUMMARY_TIME_ZONE, "MMM d, h:mm a"),
      record.email,
      getSelectionLabel(record.intent, record.role),
      record.status,
    ].join(" | "))
    : ["No new signups this week."];
  const body = [
    `clubyclub weekly signup summary (${formattedPeriod})`,
    "",
    `Total new signups: ${records.length}`,
    `Creating clubs: ${intentCounts.create_club}`,
    `Finding roles: ${intentCounts.find_role}`,
    `General waitlist: ${intentCounts.waitlist}`,
    "",
    `Requested roles: ${roleSummary.join(", ") || "None this week"}`,
    `Status: ${statusSummary.join(", ") || "No statuses this week"}`,
    "",
    "Newest signups:",
    ...bodyRows,
    "",
    `Open the full Sheet: ${spreadsheet.getUrl()}`,
  ].join("\n");

  const htmlRows = recentRecords.length
    ? recentRecords.map((record) => `
        <tr>
          <td style="padding:10px 8px;border-bottom:1px solid #e9ebf0;white-space:nowrap">${escapeHtml(Utilities.formatDate(record.submittedAt, SUMMARY_TIME_ZONE, "MMM d, h:mm a"))}</td>
          <td style="padding:10px 8px;border-bottom:1px solid #e9ebf0">${escapeHtml(record.email)}</td>
          <td style="padding:10px 8px;border-bottom:1px solid #e9ebf0">${escapeHtml(getSelectionLabel(record.intent, record.role))}</td>
          <td style="padding:10px 8px;border-bottom:1px solid #e9ebf0">${escapeHtml(record.status)}</td>
        </tr>`).join("")
    : `<tr><td colspan="4" style="padding:20px 8px;color:#687187;text-align:center">No new signups this week.</td></tr>`;
  const roleChips = roleSummary.length
    ? roleSummary.map((item) => `<span style="display:inline-block;margin:0 6px 6px 0;padding:7px 10px;background:#eef2ff;border-radius:999px;font-size:12px">${escapeHtml(item)}</span>`).join("")
    : `<span style="color:#687187;font-size:13px">No specific roles requested this week.</span>`;
  const htmlBody = `
    <div style="margin:0;padding:28px 14px;background:#f4f0e6;font-family:Arial,sans-serif;color:#15213a">
      <div style="max-width:720px;margin:0 auto;overflow:hidden;background:#ffffff;border-radius:20px">
        <div style="padding:26px 30px;background:#132449;color:#ffffff">
          <div style="font-size:22px;font-weight:800">cluby<span style="color:#dfff67">club</span></div>
          <div style="margin-top:7px;color:#c8d0de;font-size:13px">Weekly signup summary · ${escapeHtml(formattedPeriod)}</div>
        </div>
        <div style="padding:28px 30px">
          <h1 style="margin:0 0 20px;font-size:26px">${records.length} new signup${records.length === 1 ? "" : "s"}</h1>
          <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:26px">
            <div style="padding:14px 16px;background:#dfff67;border-radius:13px"><strong style="display:block;font-size:22px">${intentCounts.create_club}</strong><span style="font-size:12px">Creating clubs</span></div>
            <div style="padding:14px 16px;background:#dfe7ff;border-radius:13px"><strong style="display:block;font-size:22px">${intentCounts.find_role}</strong><span style="font-size:12px">Finding roles</span></div>
            <div style="padding:14px 16px;background:#ffe3dc;border-radius:13px"><strong style="display:block;font-size:22px">${intentCounts.waitlist}</strong><span style="font-size:12px">General waitlist</span></div>
          </div>
          <h2 style="margin:0 0 10px;font-size:16px">Requested roles</h2>
          <div style="margin-bottom:26px">${roleChips}</div>
          <h2 style="margin:0 0 10px;font-size:16px">Newest signups</h2>
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead><tr style="background:#f5f6f8;text-align:left"><th style="padding:10px 8px">Time</th><th style="padding:10px 8px">Email</th><th style="padding:10px 8px">Selection</th><th style="padding:10px 8px">Status</th></tr></thead>
              <tbody>${htmlRows}</tbody>
            </table>
          </div>
          <a href="${escapeHtml(spreadsheet.getUrl())}" style="display:inline-block;margin-top:24px;padding:12px 18px;color:#132449;background:#dfff67;border-radius:10px;font-size:13px;font-weight:700;text-decoration:none">Open the full Sheet</a>
        </div>
      </div>
    </div>`;

  MailApp.sendEmail({
    to: CLUBYCLUB_OPS_EMAIL,
    subject,
    body,
    htmlBody,
    name: "clubyclub",
    replyTo: CLUBYCLUB_OPS_EMAIL,
  });
}

function getEffectiveUserEmail() {
  return String(Session.getEffectiveUser().getEmail() || "").trim().toLowerCase();
}

function assertClubyclubOpsAccount() {
  const email = getEffectiveUserEmail();

  if (email !== CLUBYCLUB_OPS_EMAIL) {
    throw new Error(`Sign in as ${CLUBYCLUB_OPS_EMAIL} before authorizing, deploying, or creating the trigger.`);
  }

  return email;
}

function getSelectionLabel(intent, role) {
  if (intent === "find_role") return role ? `${role} opportunities` : "finding a club role";
  if (intent === "create_club") return "creating and growing a club";
  return "clubyclub early access";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
