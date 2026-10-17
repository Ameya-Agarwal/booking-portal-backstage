import recipients from "../config/notification-recipients.json" with { type: "json" };
import { RESOURCES } from "./lib.js";

// The requester comes from the authenticated booking owner; team addresses are server configuration.
const statusNames = { pending: "Pending", approved: "Approved", rejected: "Denied" };
const time = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function bookingTeamRecipients(bookings, requester, config = recipients) {
  const groups = new Set(["backstage"]);
  for (const booking of bookings) {
    for (const resource of RESOURCES) {
      if (Number(booking.items?.[resource.id]) > 0) {
        groups.add(resource.group === "sound" ? "sounds" : resource.group);
      }
    }
  }
  const addresses = new Set();
  for (const group of groups) {
    if (!Array.isArray(config[group])) throw new Error(`Email recipients for ${group} must be an array`);
    for (const value of config[group]) {
      if (typeof value !== "string" || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim())) {
        throw new Error(`Invalid email recipient in ${group}`);
      }
      addresses.add(value.trim().toLowerCase());
    }
  }
  addresses.delete(requester.trim().toLowerCase());
  return [...addresses];
}

export function bookingEmail(bookings, submitted = false) {
  const status = statusNames[bookings[0].status];
  const heading = submitted ? "Booking request received" : `Booking ${status.toLowerCase()}`;
  const details = bookings.map((b) => [
    `Booking reference: ${b.id}`,
    `Club / department: ${b.club}`,
    `Booking: ${b.title}`,
    `Resources: ${RESOURCES.filter((r) => Number(b.items?.[r.id]) > 0).map((r) => r.name).join(", ") || "None"}`,
    `Date: ${b.date}`,
    `Time: ${time(b.startMin)}–${time(b.endMin)} IST (Asia/Kolkata)`,
    `Status: ${statusNames[b.status]}`,
    ...(b.note ? [`Staff note: ${b.note}`] : []),
  ].join("\n")).join("\n\n");
  return {
    subject: `Main Audi: ${heading}`,
    text: `${heading}\n\n${details}\n\n${submitted ? "Your request is pending review. You will receive another email when it is approved or denied." : "You can check your booking in the Main Audi Bookings Portal."}`,
  };
}

export async function notifyBooking(env, recipient, bookings, submitted = false) {
  try {
    if (!env.RESEND_API_KEY || !env.BOOKING_EMAIL_FROM) {
      throw new Error("RESEND_API_KEY or BOOKING_EMAIL_FROM is missing");
    }
    const bcc = bookingTeamRecipients(bookings, recipient);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: env.BOOKING_EMAIL_FROM,
        to: [recipient],
        // BCC keeps team addresses out of the requester's email headers.
        ...(bcc.length ? { bcc } : {}),
        ...bookingEmail(bookings, submitted),
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}`);
    return null;
  } catch (error) {
    // Do not turn a committed booking into an API error: clients might submit it again.
    console.error("Booking notification failed", bookings.map((b) => b.id), error.message);
    return "The booking was saved, but its email notification could not be sent. Check the portal for the current status.";
  }
}
