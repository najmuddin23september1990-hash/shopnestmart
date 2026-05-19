const productForm = document.querySelector("#productForm");
const orderForm = document.querySelector("#orderForm");
const refreshAdmin = document.querySelector("#refreshAdmin");
const adminProducts = document.querySelector("#adminProducts");
const enquiryRows = document.querySelector("#enquiryRows");
const orderRows = document.querySelector("#orderRows");
const productNote = document.querySelector("#productNote");
const orderNote = document.querySelector("#orderNote");
const logoutAdmin = document.querySelector("#logoutAdmin");
const productCount = document.querySelector("#productCount");
const enquiryCount = document.querySelector("#enquiryCount");
const orderCount = document.querySelector("#orderCount");

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

function formDataToObject(form) {
  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());
  data.featured = formData.has("featured");
  return data;
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function emptyRow(message, colspan) {
  return `<tr><td colspan="${colspan}">${message}</td></tr>`;
}

function renderProducts(products) {
  productCount.textContent = products.length;
  adminProducts.innerHTML = products.map((product) => {
    const image = (product.image || "wall-hook-5.jpg").replace("assets/wall-hook-5.jpg", "wall-hook-5.jpg");

    return `
      <article class="admin-product">
        <img src="${image}" alt="${product.name}" onerror="this.src='wall-hook-5.jpg'">
        <div>
          <span>${product.category}</span>
          <strong>${product.name}</strong>
          <p>${product.description}</p>
          <small>${product.price || "Ask for current rate"} | ${product.stock || "Available"}</small>
        </div>
        <button class="small-danger" type="button" data-delete-product="${product.id}">Delete</button>
      </article>
    `;
  }).join("");
}

function renderEnquiries(enquiries) {
  enquiryCount.textContent = enquiries.length;
  enquiryRows.innerHTML = enquiries.length ? enquiries.map((enquiry) => `
    <tr>
      <td>${formatDate(enquiry.createdAt)}</td>
      <td>${enquiry.name}</td>
      <td>${enquiry.phone}</td>
      <td>${enquiry.product || "-"}</td>
      <td>${enquiry.requirement}</td>
      <td>${enquiry.status}</td>
    </tr>
  `).join("") : emptyRow("No enquiries yet.", 6);
}

function renderOrders(orders) {
  orderCount.textContent = orders.length;
  orderRows.innerHTML = orders.length ? orders.map((order) => `
    <tr>
      <td>${formatDate(order.createdAt)}</td>
      <td>${order.customer}</td>
      <td>${order.phone}</td>
      <td>${order.product}</td>
      <td>${order.quantity || "-"}</td>
      <td>${order.amount || "-"}</td>
      <td>${order.status}</td>
    </tr>
  `).join("") : emptyRow("No orders yet.", 7);
}

async function loadAdmin() {
  const [products, enquiries, orders] = await Promise.all([
    api("/api/products"),
    api("/api/enquiries"),
    api("/api/orders"),
  ]);

  renderProducts(products);
  renderEnquiries(enquiries);
  renderOrders(orders);
}

async function logout() {
  await api("/api/logout", { method: "POST" });
  window.location.href = "/login.html";
}

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  productNote.textContent = "Saving product...";
  try {
    await api("/api/products", {
      method: "POST",
      body: JSON.stringify(formDataToObject(productForm)),
    });
    productForm.reset();
    productNote.textContent = "Product added.";
    await loadAdmin();
  } catch (error) {
    productNote.textContent = error.message;
  }
});

orderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  orderNote.textContent = "Saving order...";
  try {
    await api("/api/orders", {
      method: "POST",
      body: JSON.stringify(formDataToObject(orderForm)),
    });
    orderForm.reset();
    orderNote.textContent = "Order added.";
    await loadAdmin();
  } catch (error) {
    orderNote.textContent = error.message;
  }
});

adminProducts.addEventListener("click", async (event) => {
  const id = event.target.dataset.deleteProduct;
  if (!id) return;

  await api(`/api/products/${encodeURIComponent(id)}`, { method: "DELETE" });
  await loadAdmin();
});

refreshAdmin.addEventListener("click", loadAdmin);
logoutAdmin.addEventListener("click", logout);

loadAdmin().catch((error) => {
  if (error.message.includes("Admin login")) {
    window.location.href = "/login.html";
    return;
  }
  productNote.textContent = error.message;
});
