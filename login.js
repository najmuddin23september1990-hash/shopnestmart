const loginForm = document.querySelector("#loginForm");
const loginNote = document.querySelector("#loginNote");

async function checkSession() {
  const response = await fetch("/api/session");
  const session = await response.json();
  if (session.authenticated) {
    window.location.href = "/admin.html";
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginNote.textContent = "Checking password...";

  const data = Object.fromEntries(new FormData(loginForm).entries());

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Login failed.");

    window.location.href = "/admin.html";
  } catch (error) {
    loginNote.textContent = error.message;
  }
});

checkSession();
