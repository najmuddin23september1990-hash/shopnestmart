const http = require("http");
const https = require("https");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const nodemailer = require("nodemailer");
const { MongoClient } = require("mongodb");

const root = __dirname;
const dataDir = path.join(root, "data");
const dataFile = path.join(dataDir, "store.json");
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "0.0.0.0";
const adminPassword = process.env.ADMIN_PASSWORD || "ShopNest@123";
const adminSession = `shopnest-${Buffer.from(adminPassword).toString("base64url")}`;
const razorpayKeyId = process.env.RAZORPAY_KEY_ID || "";
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || "";
const notifyEmail = process.env.ORDER_NOTIFY_EMAIL || "";
const brevoApiKey = process.env.BREVO_API_KEY || "";
const brevoSenderEmail = process.env.BREVO_SENDER_EMAIL || process.env.SMTP_USER || notifyEmail;
const brevoSenderName = process.env.BREVO_SENDER_NAME || "Shop Nest";
const mongoUri = process.env.MONGODB_URI || "";
const mongoDbName = process.env.MONGODB_DB || "shopnestmart";
const smtpConfig = {
  host: process.env.SMTP_HOST || "",
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
  },
};
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const starterData = {
  products: [
    {
      id: "steel-wall-hooks",
      name: "Steel Wall Hooks",
      category: "Hooks & fittings",
      price: "Ask for current rate",
      image: "wall-hook-5.jpg",
      images: ["wall-hook-5.jpg"],
      description: "Strong wall-mounted hooks with round plate fitting for display, storage, and daily use.",
      stock: "Available",
      featured: true,
    },
    {
      id: "shop-display-hooks",
      name: "Shop Display Hooks",
      category: "Display fitting",
      price: "Ask for current rate",
      image: "wall-hook-5.jpg",
      images: ["wall-hook-5.jpg"],
      description: "Useful for hanging packets, tools, accessories, and lightweight display items in retail setups.",
      stock: "Available",
      featured: false,
    },
    {
      id: "home-workshop-hooks",
      name: "Home & Workshop Hooks",
      category: "Storage support",
      price: "Ask for current rate",
      image: "wall-hook-5.jpg",
      images: ["wall-hook-5.jpg"],
      description: "Clean wall-mounted hooks for organizing small tools, cables, bags, and daily-use items.",
      stock: "Available",
      featured: false,
    },
  ],
  enquiries: [],
  orders: [],
};

let storeQueue = Promise.resolve();
let mongoClient;
let mongoDb;

async function ensureDataFile() {
  await fsp.mkdir(dataDir, { recursive: true });
  try {
    await fsp.access(dataFile);
  } catch {
    await fsp.writeFile(dataFile, JSON.stringify(starterData, null, 2));
  }
}

async function readStore() {
  await ensureDataFile();
  const raw = await fsp.readFile(dataFile, "utf8");
  return JSON.parse(raw);
}

async function writeStore(store) {
  await fsp.writeFile(dataFile, JSON.stringify(store, null, 2));
}

async function getDb() {
  if (!mongoUri) return null;
  if (mongoDb) return mongoDb;

  mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();
  mongoDb = mongoClient.db(mongoDbName);
  console.log(`MongoDB connected: ${mongoDbName}`);
  return mongoDb;
}

async function seedMongoIfEmpty(db) {
  const count = await db.collection("products").countDocuments();
  if (count === 0) {
    await db.collection("products").insertMany(starterData.products);
  }
}

async function listCollection(name) {
  const db = await getDb();
  if (!db) {
    const store = await readStore();
    return store[name];
  }

  if (name === "products") await seedMongoIfEmpty(db);
  return db.collection(name).find({}).sort({ createdAt: -1, _id: -1 }).toArray();
}

async function insertDocument(name, document) {
  const db = await getDb();
  if (!db) return updateStore((store) => {
    store[name].unshift(document);
    return document;
  });

  await db.collection(name).insertOne(document);
  return document;
}

async function deleteProduct(id) {
  const db = await getDb();
  if (!db) {
    await updateStore((store) => {
      store.products = store.products.filter((product) => product.id !== id);
      return { ok: true };
    });
    return;
  }

  await db.collection("products").deleteOne({ id });
}

function updateStore(mutator) {
  storeQueue = storeQueue.then(async () => {
    const store = await readStore();
    const result = await mutator(store);
    await writeStore(store);
    return result;
  });
  return storeQueue;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function parseCookies(request) {
  return String(request.headers.cookie || "")
    .split(";")
    .map((cookie) => cookie.trim().split("="))
    .filter(([name]) => name)
    .reduce((cookies, [name, value]) => {
      cookies[name] = decodeURIComponent(value || "");
      return cookies;
    }, {});
}

function isAdmin(request) {
  return parseCookies(request).shopnest_admin === adminSession;
}

function requireAdmin(request, response) {
  if (isAdmin(request)) return true;
  sendJson(response, 401, { error: "Admin login required." });
  return false;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Request body too large"));
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function cleanText(value) {
  return String(value || "").trim();
}

function parseImages(value) {
  const images = String(value || "")
    .split(",")
    .map((item) => cleanText(item))
    .filter(Boolean);
  return images.length ? images : ["wall-hook-5.jpg"];
}

function emailEnabled() {
  return Boolean(notifyEmail && (brevoApiKey || (smtpConfig.host && smtpConfig.auth.user && smtpConfig.auth.pass)));
}

function sendBrevoApiEmail(subject, lines) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      sender: {
        name: brevoSenderName,
        email: brevoSenderEmail,
      },
      to: [
        {
          email: notifyEmail,
        },
      ],
      subject,
      textContent: lines.join("\n"),
    });

    const request = https.request(
      {
        hostname: "api.brevo.com",
        path: "/v3/smtp/email",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "api-key": brevoApiKey,
        },
      },
      (brevoResponse) => {
        let data = "";
        brevoResponse.on("data", (chunk) => {
          data += chunk;
        });
        brevoResponse.on("end", () => {
          if (brevoResponse.statusCode >= 400) {
            reject(new Error(data || "Brevo API email failed."));
            return;
          }
          resolve(data);
        });
      }
    );

    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

async function sendNotification(subject, lines) {
  if (!emailEnabled()) {
    console.log("Email notification skipped: SMTP environment variables are incomplete.");
    return;
  }

  if (brevoApiKey) {
    await sendBrevoApiEmail(subject, lines);
    console.log(`Email notification sent with Brevo API: ${subject}`);
    return;
  }

  const transporter = nodemailer.createTransport(smtpConfig);
  await transporter.sendMail({
    from: `"Shop Nest" <${smtpConfig.auth.user}>`,
    to: notifyEmail,
    subject,
    text: lines.join("\n"),
  });
  console.log(`Email notification sent: ${subject}`);
}

function createRazorpayOrder(payload) {
  return new Promise((resolve, reject) => {
    if (!razorpayKeyId || !razorpayKeySecret) {
      reject(new Error("Razorpay keys are not configured."));
      return;
    }

    const body = JSON.stringify(payload);
    const request = https.request(
      {
        hostname: "api.razorpay.com",
        path: "/v1/orders",
        method: "POST",
        auth: `${razorpayKeyId}:${razorpayKeySecret}`,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (razorpayResponse) => {
        let data = "";
        razorpayResponse.on("data", (chunk) => {
          data += chunk;
        });
        razorpayResponse.on("end", () => {
          const parsed = data ? JSON.parse(data) : {};
          if (razorpayResponse.statusCode >= 400) {
            reject(new Error(parsed.error?.description || "Unable to create Razorpay order."));
            return;
          }
          resolve(parsed);
        });
      }
    );

    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/session") {
    sendJson(response, 200, { authenticated: isAdmin(request) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/login") {
    const body = await readBody(request);
    if (cleanText(body.password) !== adminPassword) {
      sendJson(response, 401, { error: "Wrong password." });
      return;
    }

    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": `shopnest_admin=${encodeURIComponent(adminSession)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`,
    });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/logout") {
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": "shopnest_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
    });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/products") {
    sendJson(response, 200, await listCollection("products"));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/products") {
    if (!requireAdmin(request, response)) return;
    const body = await readBody(request);
    const draft = {
      name: cleanText(body.name),
      category: cleanText(body.category),
      description: cleanText(body.description),
    };

    if (!draft.name || !draft.category || !draft.description) {
      sendJson(response, 400, { error: "Product name, category, and description are required." });
      return;
    }

    const images = parseImages(body.images || body.image);
    const product = await insertDocument("products", {
      id: createId("product"),
      name: draft.name,
      category: draft.category,
      price: cleanText(body.price) || "Ask for current rate",
      image: images[0],
      images,
      description: draft.description,
      stock: cleanText(body.stock) || "Available",
      featured: Boolean(body.featured),
      createdAt: new Date().toISOString(),
    });
    sendJson(response, 201, product);
    return;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/products/")) {
    if (!requireAdmin(request, response)) return;
    const id = decodeURIComponent(url.pathname.replace("/api/products/", ""));
    await deleteProduct(id);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/enquiries") {
    if (!requireAdmin(request, response)) return;
    sendJson(response, 200, await listCollection("enquiries"));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/enquiries") {
    const body = await readBody(request);
    const draft = {
      name: cleanText(body.name),
      phone: cleanText(body.phone),
      requirement: cleanText(body.requirement),
    };

    if (!draft.name || !draft.phone || !draft.requirement) {
      sendJson(response, 400, { error: "Name, phone, and requirement are required." });
      return;
    }

    const enquiry = await insertDocument("enquiries", {
      id: createId("enquiry"),
      name: draft.name,
      phone: draft.phone,
      requirement: draft.requirement,
      product: cleanText(body.product),
      status: "New",
      createdAt: new Date().toISOString(),
    });
    sendNotification("New Shop Nest enquiry", [
      "New enquiry received.",
      "",
      `Name: ${enquiry.name}`,
      `Phone: ${enquiry.phone}`,
      `Product: ${enquiry.product || "-"}`,
      `Requirement: ${enquiry.requirement}`,
      `Time: ${enquiry.createdAt}`,
    ]).catch((error) => console.error("Email notification failed:", error.message));
    sendJson(response, 201, enquiry);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/payment-config") {
    sendJson(response, 200, {
      keyId: razorpayKeyId,
      currency: "INR",
      enabled: Boolean(razorpayKeyId && razorpayKeySecret),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/payments/create-order") {
    const body = await readBody(request);
    const amount = Number(body.amount);

    if (!Number.isFinite(amount) || amount < 1) {
      sendJson(response, 400, { error: "Valid amount is required." });
      return;
    }

    const order = await createRazorpayOrder({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: createId("receipt"),
      notes: {
        product: cleanText(body.product),
        customer: cleanText(body.customer),
        phone: cleanText(body.phone),
      },
    });

    sendJson(response, 201, order);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/orders/paid") {
    const body = await readBody(request);
    const draft = {
      customer: cleanText(body.customer),
      phone: cleanText(body.phone),
      product: cleanText(body.product),
      amount: cleanText(body.amount),
      paymentId: cleanText(body.paymentId),
      razorpayOrderId: cleanText(body.razorpayOrderId),
    };

    if (!draft.customer || !draft.phone || !draft.product || !draft.paymentId) {
      sendJson(response, 400, { error: "Customer, phone, product, and payment id are required." });
      return;
    }

    const order = await insertDocument("orders", {
      id: createId("order"),
      customer: draft.customer,
      phone: draft.phone,
      product: draft.product,
      quantity: cleanText(body.quantity),
      amount: draft.amount,
      status: "Paid",
      paymentId: draft.paymentId,
      razorpayOrderId: draft.razorpayOrderId,
      createdAt: new Date().toISOString(),
    });
    sendNotification("New paid order on Shop Nest", [
      "Payment successful. New paid order received.",
      "",
      `Customer: ${order.customer}`,
      `Phone: ${order.phone}`,
      `Product: ${order.product}`,
      `Quantity: ${order.quantity || "-"}`,
      `Amount: ${order.amount}`,
      `Payment ID: ${order.paymentId}`,
      `Razorpay Order ID: ${order.razorpayOrderId}`,
      `Time: ${order.createdAt}`,
    ]).catch((error) => console.error("Email notification failed:", error.message));
    sendJson(response, 201, order);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/orders") {
    if (!requireAdmin(request, response)) return;
    sendJson(response, 200, await listCollection("orders"));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/orders") {
    if (!requireAdmin(request, response)) return;
    const body = await readBody(request);
    const draft = {
      customer: cleanText(body.customer),
      phone: cleanText(body.phone),
      product: cleanText(body.product),
    };

    if (!draft.customer || !draft.phone || !draft.product) {
      sendJson(response, 400, { error: "Customer, phone, and product are required." });
      return;
    }

    const order = await insertDocument("orders", {
      id: createId("order"),
      customer: draft.customer,
      phone: draft.phone,
      product: draft.product,
      quantity: cleanText(body.quantity),
      amount: cleanText(body.amount),
      status: cleanText(body.status) || "Pending",
      createdAt: new Date().toISOString(),
    });
    sendNotification("New manual order on Shop Nest", [
      "New manual order added in admin panel.",
      "",
      `Customer: ${order.customer}`,
      `Phone: ${order.phone}`,
      `Product: ${order.product}`,
      `Quantity: ${order.quantity || "-"}`,
      `Amount: ${order.amount || "-"}`,
      `Status: ${order.status}`,
      `Time: ${order.createdAt}`,
    ]).catch((error) => console.error("Email notification failed:", error.message));
    sendJson(response, 201, order);
    return;
  }

  sendJson(response, 404, { error: "API route not found." });
}

function serveStatic(response, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(root, requestedPath));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
    });
    response.end(data);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${host}:${port}`);

  try {
    if (url.pathname === "/admin.html" && !isAdmin(request)) {
      response.writeHead(302, { Location: "/login.html" });
      response.end();
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    serveStatic(response, url);
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Server error" });
  }
});

ensureDataFile().then(() => {
  server.listen(port, host, () => {
    console.log(`Shop Nest preview: http://${host}:${port}`);
    console.log(`Admin panel: http://${host}:${port}/admin.html`);
    console.log(`Admin password: ${adminPassword}`);
  });
});
