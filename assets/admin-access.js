// Independent of the main workspace JavaScript bundle, so an account holder
// can still reach Control from the account menu if a workspace module fails.
const shortcut = document.getElementById("platform-admin-shortcut");
if (shortcut) {
  fetch("/api/admin/me", { credentials: "same-origin", cache: "no-store" })
    .then(response => {
      // A successful admin-only API response is the sole condition for
      // revealing this link. Its presence never grants privileges by itself.
      if (response.ok) shortcut.hidden = false;
    })
    .catch(() => {
      // Fail closed on an offline request or an unavailable API.
    });
}
