# Shop Nest Deployment

Domain: shopnestmart.in

## Required Hosting

This project needs Node.js hosting because it has:

- Admin login
- Product add/delete
- Enquiry storage
- Order storage
- API routes

Static hosting is not enough for the admin panel.

## Environment Variables

Set these on the hosting provider:

```text
HOST=0.0.0.0
PORT=provided by host
ADMIN_PASSWORD=change-this-password
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/shopnestmart?retryWrites=true&w=majority
MONGODB_DB=shopnestmart
ORDER_NOTIFY_EMAIL=your-email@example.com
BREVO_API_KEY=your-brevo-api-key
BREVO_SENDER_EMAIL=verified-sender@example.com
BREVO_SENDER_NAME=Shop Nest
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_SECURE=false
```

Most hosts automatically provide `PORT`, so only set it if the host asks.

For reliable notifications on Render Free, prefer `BREVO_API_KEY` because free Render services can block outbound SMTP ports.

## Start Command

```text
npm start
```

## GoDaddy DNS

After hosting gives a live app URL and DNS target:

1. Open GoDaddy domain DNS settings for `shopnestmart.in`.
2. Add/update the root domain record according to the hosting provider.
3. Add/update `www` as a CNAME according to the hosting provider.
4. Enable HTTPS/SSL in the hosting dashboard.

## Important

The current data storage is `data/store.json`. For a real live store, move products, enquiries, and orders to a database before taking important customer orders.
