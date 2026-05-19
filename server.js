const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const root = __dirname;
const dataDir = path.join(root, "data");
const dataFile = path.join(dataDir, "store.json");
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "0.0.0.0";
const adminPassword = process.env.ADMIN_PASSWORD || "ShopNest@123";
const adminSession = `shopnest-${Buffer.from(adminPassword).toString("base64url")}`;
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
      image: "assets/wall-hook-5.jpg",
      description: "Strong wall-mounted hooks with round plate fitting for display, storage, and daily use.",
      stock: "Available",
      featured: true,
    },
    {
      id: "shop-display-hooks",
      name: "Shop Display Hooks",
      category: "Display fitting",
      price: "Ask for current rate",
      image: "assets/wall-hook-5.jpg",
      description: "Useful for hanging packets, tools, accessories, and lightweight display items in retail setups.",
      stock: "Available",
      featured: false,
    },
    {
      id: "home-workshop-hooks",
      name: "Home & Workshop Hooks",
      category: "Storage support",
      price: "Ask for current rate",
      image: "assets/wall-hook-5.jpg",
      description: "Clean wall-mounted hooks for organizing small tools, cables, bags, and daily-use items.",
      stock: "Available",
      featured: false,
    },
  ],
  enquiries: [],
  orders: [],
};

let storeQueue = Promise.resolve();

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

async function handleApi(request, response, url) {
  const store = await readStore();

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
    sendJson(response, 200, store.products);
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

    const product = await updateStore((currentStore) => {
      const nextProduct = {
        id: createId("product"),
        name: draft.name,
        category: draft.category,
        price: cleanText(body.price) || "Ask for current rate",
        image: cleanText(body.image) || "assets/wall-hook-5.jpg",
        description: draft.description,
        stock: cleanText(body.stock) || "Available",
        featured: Boolean(body.featured),
        createdAt: new Date().toISOString(),
      };
      currentStore.products.unshift(nextProduct);
      return nextProduct;
    });
    sendJson(response, 201, product);
    return;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/products/")) {
    if (!requireAdmin(request, response)) return;
    const id = decodeURIComponent(url.pathname.replace("/api/products/", ""));
    await updateStore((currentStore) => {
      currentStore.products = currentStore.products.filter((product) => product.id !== id);
      return { ok: true };
    });
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/enquiries") {
    if (!requireAdmin(request, response)) return;
    sendJson(response, 200, store.enquiries);
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

    const enquiry = await updateStore((currentStore) => {
      const nextEnquiry = {
        id: createId("enquiry"),
        name: draft.name,
        phone: draft.phone,
        requirement: draft.requirement,
        product: cleanText(body.product),
        status: "New",
        createdAt: new Date().toISOString(),
      };
      currentStore.enquiries.unshift(nextEnquiry);
      return nextEnquiry;
    });
    sendJson(response, 201, enquiry);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/orders") {
    if (!requireAdmin(request, response)) return;
    sendJson(response, 200, store.orders);
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

    const order = await updateStore((currentStore) => {
      const nextOrder = {
        id: createId("order"),
        customer: draft.customer,
        phone: draft.phone,
        product: draft.product,
        quantity: cleanText(body.quantity),
        amount: cleanText(body.amount),
        status: cleanText(body.status) || "Pending",
        createdAt: new Date().toISOString(),
      };
      currentStore.orders.unshift(nextOrder);
      return nextOrder;
    });
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
