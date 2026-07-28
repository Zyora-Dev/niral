import { hydrateRoot } from "react-dom/client";
import { createElement as h } from "react";
import { App } from "./App.js";

hydrateRoot(document.getElementById("root"), h(App, { items: window.__DATA__ }));
