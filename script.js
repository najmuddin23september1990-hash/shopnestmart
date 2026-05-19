const navToggle = document.querySelector(".nav-toggle");
const siteNav = document.querySelector(".site-nav");
const contactForms = document.querySelectorAll("form");
const formNote = document.querySelector(".form-note");
const productGrid = document.querySelector("#productGrid");

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
  const image = (product.image || "wall-hook-5.jpg").replace("assets/wall-hook-5.jpg", "wall-hook-5.jpg");

  return `
    <article class="project-card">
      <img src="${image}" alt="${product.name}" onerror="this.src='wall-hook-5.jpg'">
      <div>
        <span>${product.category}</span>
        <h3>${product.name}</h3>
        <p>${product.description}</p>
        <small class="product-meta">${product.price || "Ask for current rate"} | ${product.stock || "Available"}</small>
      </div>
    </article>
  `;
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
