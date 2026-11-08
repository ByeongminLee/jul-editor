import { createRoot } from "react-dom/client";
import { App } from "./app/app.js";
import "./styles/site.css";
import "./styles/site-dark.css";
import "./styles/chart-theme.css";
import "./styles/chart-editor.css";

createRoot(document.getElementById("root")!).render(<App />);
