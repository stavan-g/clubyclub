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
  "Status",
  "User agent",
];

function doGet(event) {
  const action = String(event && event.parameter && event.parameter.action || "").trim();
  if (action === "roles_list") return handleRolesList();
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
  const requestedAction = String(event && event.parameter && event.parameter.action || "").trim();
  if (requestedAction && requestedAction !== "waitlist") return handleAppPost(event, requestedAction);

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
  const columns = getHeaderColumnMap(sheet);
  sheet.getRange(rowNumber, columns["Status"]).setValue(emailStatus);
  SpreadsheetApp.flush();

  return jsonResponse({ ok: true, email_sent: emailStatus === "email_sent", status: emailStatus });
}


function handleAppPost(event, action) {
  try {
    const params = event && event.parameter ? event.parameter : {};
    if (action === "account_start") return appAccountStart(params);
    if (action === "account_verify") return appAccountVerify(params);
    if (action === "session_profile") return appSessionProfile(params);
    if (action === "matches_list") return appMatchesList(params);
    if (action === "profile_save") return appProfileSave(params);
    if (action === "role_create") return appRoleCreate(params);
    return jsonResponse({ ok: false, error: "unknown_action" });
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: error.message || "server_error" });
  }
}

function appSheet(name, headers) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("No active spreadsheet is connected to this script.");
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  const current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0].map(String);
  headers.forEach((header, index) => { if (String(current[index] || "").trim() !== header) sheet.getRange(1, index + 1).setValue(header); });
  return sheet;
}

function appColumns(sheet) {
  const values = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const columns = {};
  values.forEach((value, index) => { if (String(value || "").trim()) columns[String(value).trim()] = index + 1; });
  return columns;
}

function appFindRow(sheet, columnName, expected) {
  if (sheet.getLastRow() < 2) return 0;
  const columns = appColumns(sheet);
  const values = sheet.getRange(2, columns[columnName], sheet.getLastRow() - 1, 1).getValues();
  const normalized = String(expected || "").trim().toLowerCase();
  for (let index = 0; index < values.length; index += 1) {
    if (String(values[index][0] || "").trim().toLowerCase() === normalized) return index + 2;
  }
  return 0;
}

function appRandomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function appRandomToken() {
  return Utilities.getUuid() + Utilities.getUuid();
}

function appPublicProfile(sheet, row) {
  const columns = appColumns(sheet);
  return {
    email: String(sheet.getRange(row, columns.Email).getValue() || ""),
    display_name: String(sheet.getRange(row, columns["Display name"]).getValue() || ""),
    user_type: String(sheet.getRange(row, columns["User type"]).getValue() || "candidate"),
    school: String(sheet.getRange(row, columns.School).getValue() || ""),
    skills: String(sheet.getRange(row, columns.Skills).getValue() || ""),
    bio: String(sheet.getRange(row, columns.Bio).getValue() || ""),
    availability: String(sheet.getRange(row, columns.Availability).getValue() || "open"),
  };
}

function appAccountStart(params) {
  const email = String(params.email || "").trim().toLowerCase();
  const userType = ["candidate", "club"].includes(String(params.user_type || "")) ? String(params.user_type) : "candidate";
  if (!isValidEmail(email)) return jsonResponse({ ok: false, error: "Enter a valid email address." });
  if (getEffectiveUserEmail() !== CLUBYCLUB_OPS_EMAIL) return jsonResponse({ ok: false, error: "Account email is temporarily unavailable. Please try again later." });

  const sheet = appSheet("Accounts", ["Created at", "Email", "User type", "Display name", "School", "Skills", "Bio", "Availability", "Verified", "Verification code", "Code expires", "Session token"]);
  const row = appFindRow(sheet, "Email", email);
  const code = appRandomCode();
  const expires = new Date(Date.now() + 15 * 60 * 1000);
  if (row) {
    const columns = appColumns(sheet);
    sheet.getRange(row, columns["User type"]).setValue(userType);
    sheet.getRange(row, columns["Verification code"]).setValue(code);
    sheet.getRange(row, columns["Code expires"]).setValue(expires);
  } else {
    const columns = appColumns(sheet);
    const values = Array(sheet.getLastColumn()).fill("");
    values[columns["Created at"] - 1] = new Date();
    values[columns.Email - 1] = email;
    values[columns["User type"] - 1] = userType;
    values[columns["Verification code"] - 1] = code;
    values[columns["Code expires"] - 1] = expires;
    values[columns.Verified - 1] = "No";
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, values.length).setValues([values]);
  }
  MailApp.sendEmail({ to: email, subject: "Your clubyclub verification code", body: "Your clubyclub verification code is " + code + ". It expires in 15 minutes.", name: "clubyclub", replyTo: CLUBYCLUB_OPS_EMAIL });
  return jsonResponse({ ok: true, message: "Check your email for a 6-digit verification code." });
}

function appAccountVerify(params) {
  const email = String(params.email || "").trim().toLowerCase();
  const code = String(params.code || "").trim();
  const sheet = appSheet("Accounts", ["Created at", "Email", "User type", "Display name", "School", "Skills", "Bio", "Availability", "Verified", "Verification code", "Code expires", "Session token"]);
  const row = appFindRow(sheet, "Email", email);
  if (!row) return jsonResponse({ ok: false, error: "Start with your email first." });
  const columns = appColumns(sheet);
  const expires = new Date(sheet.getRange(row, columns["Code expires"]).getValue()).getTime();
  if (String(sheet.getRange(row, columns["Verification code"]).getValue() || "") !== code || !expires || expires < Date.now()) return jsonResponse({ ok: false, error: "That code is invalid or expired." });
  const token = appRandomToken();
  sheet.getRange(row, columns.Verified).setValue("Yes");
  sheet.getRange(row, columns["Verification code"]).setValue("");
  sheet.getRange(row, columns["Code expires"]).setValue("");
  sheet.getRange(row, columns["Session token"]).setValue(token);
  return jsonResponse({ ok: true, token: token, profile: appPublicProfile(sheet, row) });
}

function appAuthorizedRow(token) {
  if (!token) return { sheet: null, row: 0 };
  const sheet = appSheet("Accounts", ["Created at", "Email", "User type", "Display name", "School", "Skills", "Bio", "Availability", "Verified", "Verification code", "Code expires", "Session token"]);
  const row = appFindRow(sheet, "Session token", token);
  return { sheet: row ? sheet : null, row: row };
}

function appSessionProfile(params) {
  const found = appAuthorizedRow(String(params.token || ""));
  if (!found.row) return jsonResponse({ ok: false, error: "Your session expired. Verify your email again." });
  return jsonResponse({ ok: true, profile: appPublicProfile(found.sheet, found.row) });
}

function appProfileSave(params) {
  const found = appAuthorizedRow(String(params.token || ""));
  if (!found.row) return jsonResponse({ ok: false, error: "Verify your email before saving your profile." });
  const columns = appColumns(found.sheet);
  ["Display name", "School", "Skills", "Bio", "Availability"].forEach((header) => {
    const key = header.toLowerCase().replace(" ", "_");
    if (params[key] !== undefined) found.sheet.getRange(found.row, columns[header]).setValue(String(params[key] || "").trim().slice(0, 1000));
  });
  return jsonResponse({ ok: true, profile: appPublicProfile(found.sheet, found.row) });
}

function appRoleCreate(params) {
  const found = appAuthorizedRow(String(params.token || ""));
  if (!found.row) return jsonResponse({ ok: false, error: "Verify your email before posting a role." });
  const account = appPublicProfile(found.sheet, found.row);
  if (account.user_type !== "club") return jsonResponse({ ok: false, error: "Choose “Build a club team” when creating your account to post roles." });
  const clubName = String(params.club_name || "").trim().slice(0, 120);
  const title = String(params.title || "").trim().slice(0, 120);
  const description = String(params.description || "").trim().slice(0, 2000);
  if (!clubName || !title || !description) return jsonResponse({ ok: false, error: "Club name, role title, and description are required." });
  const sheet = appSheet("Roles", ["Created at", "Owner email", "Club name", "Role title", "Category", "Description", "Commitment", "Location", "Status"]);
  const columns = appColumns(sheet);
  const values = Array(sheet.getLastColumn()).fill("");
  values[columns["Created at"] - 1] = new Date();
  values[columns["Owner email"] - 1] = account.email;
  values[columns["Club name"] - 1] = clubName;
  values[columns["Role title"] - 1] = title;
  values[columns.Category - 1] = String(params.category || "Leadership").slice(0, 40);
  values[columns.Description - 1] = description;
  values[columns.Commitment - 1] = String(params.commitment || "").slice(0, 120);
  values[columns.Location - 1] = String(params.location || "").slice(0, 120);
  values[columns.Status - 1] = "Open";
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, values.length).setValues([values]);
  return jsonResponse({ ok: true, message: "Role published." });
}

function handleRolesList() {
  const sheet = appSheet("Roles", ["Created at", "Owner email", "Club name", "Role title", "Category", "Description", "Commitment", "Location", "Status"]);
  const columns = appColumns(sheet);
  const roles = [];
  if (sheet.getLastRow() >= 2) {
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    rows.forEach((row) => {
      if (String(row[columns.Status - 1] || "Open") !== "Open") return;
      roles.push({ club_name: String(row[columns["Club name"] - 1] || ""), title: String(row[columns["Role title"] - 1] || ""), category: String(row[columns.Category - 1] || ""), description: String(row[columns.Description - 1] || ""), commitment: String(row[columns.Commitment - 1] || ""), location: String(row[columns.Location - 1] || ""), status: "Open" });
    });
  }
  return jsonResponse({ ok: true, roles: roles.slice(-50).reverse() });
}

function appMatchesList(params) {
  const found = appAuthorizedRow(String(params.token || ""));
  if (!found.row) return jsonResponse({ ok: false, error: "Verify your email before viewing matches." });

  const profile = appPublicProfile(found.sheet, found.row);
  const roleSheet = appSheet("Roles", ["Created at", "Owner email", "Club name", "Role title", "Category", "Description", "Commitment", "Location", "Status"]);
  const accountSheet = appSheet("Accounts", ["Created at", "Email", "User type", "Display name", "School", "Skills", "Bio", "Availability", "Verified", "Verification code", "Code expires", "Session token"]);
  const roles = appRoleRecords(roleSheet).filter((role) => role.status === "Open");

  if (profile.user_type === "candidate") {
    if (!String(profile.skills || "").trim() && !String(profile.bio || "").trim()) {
      return jsonResponse({ ok: true, mode: "candidate", needs_profile: true, matches: [] });
    }

    const matches = roles.map((role) => {
      const scored = appScoreMatch(profile, role);
      return {
        title: role.title,
        club_name: role.club_name,
        category: role.category,
        description: role.description,
        commitment: role.commitment,
        location: role.location,
        score: scored.score,
        matched_skills: scored.matched_skills,
      };
    }).sort((a, b) => b.score - a.score);

    return jsonResponse({
      ok: true,
      mode: "candidate",
      matches: matches.slice(0, 25),
      message: matches.length ? "" : "No open roles are published yet.",
    });
  }

  const ownedRoles = roles.filter((role) => role.owner_email === profile.email);
  if (!ownedRoles.length) {
    return jsonResponse({
      ok: true,
      mode: "club",
      matches: [],
      message: "Publish an open role to see candidate matches.",
    });
  }

  const candidates = appCandidateRecords(accountSheet, profile.email);
  const matches = [];

  ownedRoles.forEach((role) => {
    candidates.forEach((candidate) => {
      const scored = appScoreMatch(candidate, role);
      matches.push({
        display_name: candidate.display_name,
        school: candidate.school,
        skills: candidate.skills,
        bio: candidate.bio,
        role_title: role.title,
        score: scored.score,
        matched_skills: scored.matched_skills,
      });
    });
  });

  matches.sort((a, b) => b.score - a.score);

  return jsonResponse({
    ok: true,
    mode: "club",
    matches: matches.slice(0, 25),
    message: matches.length ? "" : "No verified candidate profiles are available yet.",
  });
}

function appRoleRecords(sheet) {
  const columns = appColumns(sheet);
  if (sheet.getLastRow() < 2) return [];

  return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues().map((row) => ({
    owner_email: String(row[columns["Owner email"] - 1] || "").trim().toLowerCase(),
    club_name: String(row[columns["Club name"] - 1] || ""),
    title: String(row[columns["Role title"] - 1] || ""),
    category: String(row[columns.Category - 1] || ""),
    description: String(row[columns.Description - 1] || ""),
    commitment: String(row[columns.Commitment - 1] || ""),
    location: String(row[columns.Location - 1] || ""),
    status: String(row[columns.Status - 1] || "Open"),
  }));
}

function appCandidateRecords(sheet, excludeEmail) {
  const columns = appColumns(sheet);
  if (sheet.getLastRow() < 2) return [];

  return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues()
    .map((row) => ({
      email: String(row[columns.Email - 1] || "").trim().toLowerCase(),
      user_type: String(row[columns["User type"] - 1] || ""),
      display_name: String(row[columns["Display name"] - 1] || ""),
      school: String(row[columns.School - 1] || ""),
      skills: String(row[columns.Skills - 1] || ""),
      bio: String(row[columns.Bio - 1] || ""),
      availability: String(row[columns.Availability - 1] || ""),
      verified: String(row[columns.Verified - 1] || ""),
    }))
    .filter((candidate) => candidate.user_type === "candidate" && candidate.verified === "Yes" && candidate.email !== String(excludeEmail || "").toLowerCase());
}

function appTokenize(text) {
  const stopWords = ["the", "and", "for", "with", "from", "that", "this", "your", "you", "are", "will", "their", "role", "club", "open", "person", "someone", "into", "what", "have", "has", "our"];
  return Array.from(new Set(String(text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((term) => term.length > 2 && !stopWords.includes(term))));
}

function appScoreMatch(profile, role) {
  const profileTerms = new Set(appTokenize([profile.skills, profile.bio, profile.school].join(" ")));
  const coreTerms = appTokenize([role.title, role.category].join(" "));
  const detailTerms = appTokenize([role.description, role.commitment].join(" "));
  const matchedCore = coreTerms.filter((term) => profileTerms.has(term));
  const matchedDetail = detailTerms.filter((term) => profileTerms.has(term));
  const denominator = Math.max(1, coreTerms.length * 2 + detailTerms.length);
  const score = Math.min(99, Math.round(((matchedCore.length * 2) + matchedDetail.length) / denominator * 100));
  return {
    score,
    matched_skills: Array.from(new Set(matchedCore.concat(matchedDetail))).slice(0, 6),
  };
}

function ensureHeaders(sheet) {
  const existingColumnCount = Math.max(sheet.getLastColumn(), 1);
  const existingRowCount = Math.max(sheet.getLastRow(), 1);
  const existingData = sheet.getRange(1, 1, existingRowCount, existingColumnCount).getValues();
  const existingHeaders = (existingData[0] || []).map((header) => String(header || "").trim());
  const headerIndexes = {};

  existingHeaders.forEach((header, index) => {
    if (header) headerIndexes[header] = index;
  });

  // Rebuild the visible table in the requested order while preserving values by header name.
  const migratedRows = existingData.slice(1).map((row) => SHEET_HEADERS.map((header) => {
    const index = headerIndexes[header];
    return index === undefined ? "" : row[index];
  }));
  sheet.getRange(1, 1, migratedRows.length + 1, SHEET_HEADERS.length)
    .setValues([SHEET_HEADERS, ...migratedRows]);

  if (existingColumnCount > SHEET_HEADERS.length) {
    sheet.deleteColumns(SHEET_HEADERS.length + 1, existingColumnCount - SHEET_HEADERS.length);
  }
}

function getHeaderColumnMap(sheet) {
  const headers = sheet.getRange(1, 1, 1, SHEET_HEADERS.length).getValues()[0]
    .map((header) => String(header || "").trim());
  const columns = {};

  SHEET_HEADERS.forEach((header) => {
    const index = headers.indexOf(header);
    if (index === -1) throw new Error(`Missing required column: ${header}`);
    columns[header] = index + 1;
  });

  return columns;
}

function appendStatusRow(sheet, params, email, intent, role, status) {
  const columns = getHeaderColumnMap(sheet);
  const row = Array(SHEET_HEADERS.length).fill("");
  row[columns["Submitted at"] - 1] = new Date();
  row[columns.Email - 1] = email;
  row[columns.Intent - 1] = intent;
  row[columns.Role - 1] = role;
  row[columns["Client time"] - 1] = String(params.client_time || "");
  row[columns.Status - 1] = status;
  row[columns["User agent"] - 1] = String(params.user_agent || "").slice(0, 500);
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  SpreadsheetApp.flush();
  return sheet.getLastRow();
}

function hasRecentDuplicate(sheet, email, role) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedRole = String(role || "").trim().toLowerCase();
  const columns = getHeaderColumnMap(sheet);
  const rows = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  return rows.some((row) => {
    const submittedAtValue = row[columns["Submitted at"] - 1];
    const submittedAt = submittedAtValue instanceof Date ? submittedAtValue.getTime() : new Date(submittedAtValue).getTime();
    return submittedAt >= cutoff
      && String(row[columns.Email - 1] || "").trim().toLowerCase() === normalizedEmail
      && String(row[columns.Role - 1] || "").trim().toLowerCase() === normalizedRole;
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
      "https://stavan-g.github.io/clubyclub/",
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
            You received this because this address was submitted at stavan-g.github.io/clubyclub. If that wasn’t you, you can safely ignore this email.
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
  const columns = getHeaderColumnMap(sheet);
  const values = sheet.getDataRange().getValues();
  const records = values.slice(1)
    .map((row) => ({
      submittedAt: row[columns["Submitted at"] - 1] instanceof Date
        ? row[columns["Submitted at"] - 1]
        : new Date(row[columns["Submitted at"] - 1]),
      email: String(row[columns.Email - 1] || ""),
      intent: String(row[columns.Intent - 1] || "waitlist"),
      role: String(row[columns.Role - 1] || ""),
      status: String(row[columns.Status - 1] || "not_recorded"),
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
