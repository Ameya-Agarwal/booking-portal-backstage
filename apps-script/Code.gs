// Sends the booking emails from the Google account that deploys this script.
// Setup is in the README ("Decision emails"). The secret lives in Project Settings,
// under Script properties, as MAIL_SECRET, never in this file.

function doPost(e) {
  try {
    const secret = PropertiesService.getScriptProperties().getProperty("MAIL_SECRET");
    const d = JSON.parse(e.postData.contents);
    if (!secret || d.secret !== secret) return reply({ ok: false, error: "bad secret" });
    MailApp.sendEmail({ to: d.to, subject: d.subject, body: d.text, htmlBody: d.html, name: "Main Audi Bookings" });
    return reply({ ok: true });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
