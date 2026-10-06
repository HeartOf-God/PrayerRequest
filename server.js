// The Heart Of God Ministries — Prayer Request server
// Your WhatsApp number and email live ONLY in the .env file on the server.
// They are never sent to the browser.

require("dotenv").config();
const path = require("path");
const express = require("express");
const multer = require("multer");
const nodemailer = require("nodemailer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 15);

app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://cdn.jsdelivr.net", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
        connectSrc: ["'self'"],
      },
    },
  })
);

app.use(express.static(path.join(__dirname, "public")));

// ---------- Uploads ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 3 },
  fileFilter: (req, file, cb) => {
    const ok =
      (file.fieldname === "image" && file.mimetype.startsWith("image/")) ||
      ((file.fieldname === "audio" || file.fieldname === "voice") &&
        (file.mimetype.startsWith("audio/") || file.mimetype === "video/webm" || file.mimetype === "video/mp4"));
    ok ? cb(null, true) : cb(new Error("Only image and audio files are allowed."));
  },
}).fields([
  { name: "image", maxCount: 1 },
  { name: "audio", maxCount: 1 },
  { name: "voice", maxCount: 1 },
]);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests from this device. Please try again in a few minutes." },
});

// ---------- Email ----------
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_SECURE || "true") === "true",
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 20000,
});

const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function buildEmail({ name, contact, message, files, when }) {
  const fileList = files.length
    ? files.map((f) => `<li>${esc(labelFor(f.fieldname))}: ${esc(f.originalname)} (${(f.size / 1024).toFixed(0)} KB)</li>`).join("")
    : "<li>None</li>";
  return {
    subject: `🙏 Prayer request from ${name}`,
    text: `Name: ${name}\nContact: ${contact || "-"}\nReceived: ${when}\n\nPrayer request:\n${message || "(no typed message — see attachments)"}\n\nAttachments: ${files.length}`,
    html: `
      <div style="font-family:Georgia,serif;max-width:600px;color:#1d2340">
        <h2 style="margin:0 0 4px">New prayer request</h2>
        <p style="margin:0 0 16px;color:#666">${esc(when)}</p>
        <p><strong>Name:</strong> ${esc(name)}<br><strong>Contact:</strong> ${esc(contact || "-")}</p>
        <div style="background:#f5f3ee;border-left:4px solid #b8902f;padding:12px 16px;white-space:pre-wrap">${esc(message || "(no typed message — see attachments)")}</div>
        <p><strong>Attachments:</strong></p><ul>${fileList}</ul>
      </div>`,
  };
}

// Email goes through Resend's web API when RESEND_API_KEY is set (works on Render's free plan,
// which blocks SMTP ports). Otherwise it falls back to Gmail SMTP.
async function sendEmail(payload) {
  const to = process.env.PRAYER_EMAIL_TO;
  if (!to) throw new Error("PRAYER_EMAIL_TO is not set");
  const { subject, text, html } = buildEmail(payload);
  const files = payload.files;

  if (process.env.RESEND_API_KEY) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || "Prayer Requests <onboarding@resend.dev>",
        to: [to],
        subject, text, html,
        attachments: files.map((f) => ({ filename: f.originalname || f.fieldname, content: f.buffer.toString("base64") })),
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`Resend error ${r.status}: ${await r.text()}`);
    return "sent via Resend";
  }

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) throw new Error("No email method configured (set RESEND_API_KEY)");
  await mailer.sendMail({
    from: `"Prayer Requests" <${process.env.SMTP_USER}>`,
    to, subject, text, html,
    attachments: files.map((f) => ({ filename: f.originalname || f.fieldname, content: f.buffer, contentType: f.mimetype })),
  });
  return "sent via Gmail";
}

// ---------- WhatsApp ----------
// Default provider: CallMeBot (free, text only, sends to your own number).
// Attachments always arrive by email; WhatsApp gets the text + a note about attachments.
async function sendWhatsApp({ name, contact, message, files }) {
  const provider = (process.env.WHATSAPP_PROVIDER || "callmebot").toLowerCase();
  const to = process.env.WHATSAPP_TO;
  if (provider === "none") return "skipped";
  if (!to) throw new Error("WhatsApp is not configured");

  let text =
    `🙏 *New prayer request*\n*Name:* ${name}\n` +
    (contact ? `*Contact:* ${contact}\n` : "") +
    `\n${message || "(no typed message)"}`;
  if (files.length) text += `\n\n📎 ${files.length} attachment(s): ${files.map((f) => labelFor(f.fieldname)).join(", ")} — see email.`;
  if (text.length > 1500) text = text.slice(0, 1450) + "…\n(full text in email)";

  if (provider === "callmebot") {
    const key = process.env.CALLMEBOT_APIKEY;
    if (!key || key === "pending") throw new Error("CALLMEBOT_APIKEY not set yet");
    const url =
      "https://api.callmebot.com/whatsapp.php?" +
      new URLSearchParams({ phone: to, text, apikey: key }).toString();
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`CallMeBot error ${r.status}`);
    return "sent";
  }

  if (provider === "meta") {
    // WhatsApp Cloud API (official). Free-form text only reaches you inside the
    // 24-hour window after you last messaged the business number; otherwise use an approved template.
    const r = await fetch(`https://graph.facebook.com/v20.0/${process.env.META_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: to.replace(/\D/g, ""), type: "text", text: { body: text } }),
    });
    if (!r.ok) throw new Error(`Meta API error ${r.status}: ${await r.text()}`);
    return "sent";
  }

  throw new Error(`Unknown WHATSAPP_PROVIDER: ${provider}`);
}

function labelFor(field) {
  return { image: "Photo", audio: "Audio file", voice: "Voice recording" }[field] || field;
}

// ---------- Route ----------
app.post("/api/prayer", limiter, (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      const msg = err.code === "LIMIT_FILE_SIZE" ? `Each file must be under ${MAX_FILE_MB} MB.` : err.message;
      return res.status(400).json({ ok: false, error: msg });
    }

    // Honeypot: real people never fill this hidden field
    if (req.body.website) return res.json({ ok: true });

    const name = String(req.body.name || "").trim().slice(0, 100);
    const contact = String(req.body.contact || "").trim().slice(0, 120);
    const message = String(req.body.message || "").trim().slice(0, 5000);
    const files = Object.values(req.files || {}).flat();

    if (!name) return res.status(400).json({ ok: false, error: "Please enter your name." });
    if (!message && !files.length)
      return res.status(400).json({ ok: false, error: "Please type, speak, or attach your prayer request." });

    const when = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) + " IST";
    const payload = { name, contact, message, files, when };

    const [email, wa] = await Promise.allSettled([sendEmail(payload), sendWhatsApp(payload)]);
    console.log(`Prayer request from "${name}" — email: ${email.status === "fulfilled" ? email.value : "FAILED: " + email.reason?.message} | whatsapp: ${wa.status === "fulfilled" ? wa.value : "FAILED: " + wa.reason?.message}`);

    if (email.status === "fulfilled" || (wa.status === "fulfilled" && wa.value === "sent")) {
      return res.json({ ok: true });
    }
    return res.status(502).json({ ok: false, error: "Your request could not be delivered right now. Please try again shortly." });
  });
});

app.get("/healthz", (req, res) => res.send("ok"));

app.listen(PORT, () => console.log(`Prayer request site running on http://localhost:${PORT}`));
