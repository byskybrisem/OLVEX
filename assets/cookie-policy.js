import { bindBrowserPreferences } from "./browser-preferences.js";

const preferences = document.querySelector("#browser-preferences");
for (const button of preferences.querySelectorAll("[data-preference-choice]")) button.hidden = false;
bindBrowserPreferences(preferences);
