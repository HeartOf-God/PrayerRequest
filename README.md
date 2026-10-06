# The Heart Of God Ministries — Prayer Request Website

Visitors enter their name and prayer request. They can type it, speak it (speech-to-text),
record a voice message, or attach a photo or audio file. On **Send prayer request**, the server:

- emails everything (text + attachments) to your inbox, and
- sends a WhatsApp alert with the name and message to your phone.

Your email address and WhatsApp number live only in `.env` on the server. They never appear in the page source.

## 1. Run it locally

```bash
npm install
cp .env.example .env      # then fill in the values below
npm start                 # http://localhost:3000
```

Voice recording and speech-to-text need **https** (or localhost) to access the microphone.

## 2. Set up Gmail (required)

1. Turn on 2-Step Verification on the Google account.
2. Go to https://myaccount.google.com/apppasswords and create an App Password ("Prayer site").
3. Put the 16-character password in `SMTP_PASS`. Your normal Gmail password will not work.

## 3. Set up WhatsApp alerts

**Option A — CallMeBot (free, easiest, text only)**
1. Save `+34 644 66 32 62` in your phone contacts (check https://www.callmebot.com/blog/free-api-whatsapp-messages/ for the current number).
2. From your WhatsApp, send it: `I allow callmebot to send me messages`
3. It replies with an API key. Put it in `CALLMEBOT_APIKEY` and keep `WHATSAPP_PROVIDER=callmebot`.

**Option B — WhatsApp Cloud API by Meta (official)**
Set `WHATSAPP_PROVIDER=meta`, `META_PHONE_NUMBER_ID`, `META_ACCESS_TOKEN`.
Note: Meta only delivers free-form messages within 24 hours of your last message to the business number;
for reliable delivery you'll need an approved message template.

Photos and voice messages always arrive by email. WhatsApp gets the text plus a note that attachments are in your inbox.

## 4. Deploy

Any Node 18+ host works. Set the `.env` values as environment variables in the host's dashboard.

- **Render / Railway**: connect the repo, start command `npm start`.
- **Docker** (EC2, Cloud Run, etc.):
  ```bash
  docker build -t prayer-site .
  docker run -d -p 80:3000 --env-file .env prayer-site
  ```
  Put it behind HTTPS (Cloud Run gives it automatically; on EC2 use Nginx + Certbot or an ALB with ACM).

## Built-in protection
Rate limit (10 requests per 15 min per IP), hidden spam trap field, file type and size checks (15 MB each),
security headers via Helmet. Uploaded files are held in memory only and never saved to disk.
