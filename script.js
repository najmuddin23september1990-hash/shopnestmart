const navToggle = document.querySelector(".nav-toggle");
const siteNav = document.querySelector(".site-nav");
const contactForms = document.querySelectorAll("form:not(#paymentForm)");
const formNote = document.querySelector(".form-note");
const productGrid = document.querySelector("#productGrid");
const paymentForm = document.querySelector("#paymentForm");
const paymentNote = document.querySelector("#paymentNote");

navToggle.addEventListener("click", () => {
  const isOpen = siteNav.classList.toggle("is-open");
  navToggle.setAttribute("aria-expanded", String(isOpen));
});

siteNav.addEventListener("click", (event) => {
  if (event.target.matches("a")) {
    siteNav.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
  }
});

function productCard(product) {
  const images = normalizeImages(product);
  const image = images[0];
  const thumbs = images.slice(0, 4).map((item) => `
    <img src="${item}" alt="${product.name}" onerror="this.src='wall-hook-5.jpg'">
  `).join("");

  return `
    <article class="project-card">
      <img src="${image}" alt="${product.name}" onerror="this.src='wall-hook-5.jpg'">
      <div>
        <span>${product.category}</span>
        <h3>${product.name}</h3>
        <p>${product.description}</p>
        ${images.length > 1 ? `<div class="product-thumbs">${thumbs}</div>` : ""}
        <small class="product-meta">${product.price || "Ask for current rate"} | ${product.stock || "Available"}</small>
      </div>
    </article>
  `;
}

function normalizeImages(product) {
  const source = Array.isArray(product.images) && product.images.length
    ? product.images
    : [product.image || "wall-hook-5.jpg"];
  return source
    .map((item) => String(item || "").replace("assets/wall-hook-5.jpg", "wall-hook-5.jpg"))
    .filter(Boolean);
}

async function loadProducts() {
  if (!productGrid) return;

  try {
    const response = await fetch("/api/products");
    if (!response.ok) return;
    const products = await response.json();
    productGrid.innerHTML = products.map(productCard).join("");
  } catch {
    // Keep the static product cards visible if the backend is unavailable.
  }
}

contactForms.forEach((contactForm) => {
  contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const note = contactForm.querySelector(".form-note") || formNote;
    const data = Object.fromEntries(new FormData(contactForm).entries());

    note.textContent = "Sending inquiry...";

    try {
      const response = await fetch("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to send inquiry.");

      note.textContent = "Thank you. Your inquiry has been saved.";
      contactForm.reset();
    } catch (error) {
      note.textContent = error.message;
    }
  });
});

loadProducts();

async function savePaidOrder(orderData, response) {
  await fetch("/api/orders/paid", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...orderData,
      paymentId: response.razorpay_payment_id,
      razorpayOrderId: response.razorpay_order_id,
    }),
  });
}

async function startPayment(event) {
  event.preventDefault();
  if (!window.Razorpay) {
    paymentNote.textContent = "Payment checkout could not load. Please refresh and try again.";
    return;
  }

  const orderData = Object.fromEntries(new FormData(paymentForm).entries());
  paymentNote.textContent = "Creating payment...";

  try {
    const configResponse = await fetch("/api/payment-config");
    const config = await configResponse.json();
    if (!config.enabled) {
      throw new Error("Payment gateway is not configured yet.");
    }

    const orderResponse = await fetch("/api/payments/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orderData),
    });
    const razorpayOrder = await orderResponse.json();
    if (!orderResponse.ok) throw new Error(razorpayOrder.error || "Unable to create payment.");

    const checkout = new Razorpay({
      key: config.keyId,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      name: "Shop Nest",
      image: `${window.location.origin}/shop-nest-logo-compact.svg`,
      description: orderData.product,
      order_id: razorpayOrder.id,
      prefill: {
        name: orderData.customer,
        contact: orderData.phone,
      },
      theme: {
        color: "#c28b2c",
      },
      handler: async (response) => {
        paymentNote.textContent = "Payment received. Saving order...";
        await savePaidOrder(orderData, response);
        paymentNote.textContent = "Payment successful. Your order has been saved.";
        paymentForm.reset();
      },
      modal: {
        ondismiss: () => {
          paymentNote.textContent = "Payment was closed before completion.";
        },
      },
    });

    checkout.open();
  } catch (error) {
    paymentNote.textContent = error.message;
  }
}

if (paymentForm) {
  paymentForm.addEventListener("submit", startPayment);
}
