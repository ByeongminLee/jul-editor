import { VERSION as REACT_VERSION } from "@jul-editor/react";
import { DiffPage } from "./diff/diff-page.js";
import { EditorPage } from "./editor-page.js";
import { PluginsDemo } from "./plugins/plugins-demo.js";
import { ReactDemo } from "./react/react-demo.js";
import { SpikePage } from "./spike-page.js";
import { VanillaPage } from "./vanilla-page.js";
import { PerfPage } from "./perf/perf-page.js";

// Plain pathname switch, no router dep for these static pages.
function Page() {
  const path = window.location.pathname;
  if (path === "/vanilla") {
    return <VanillaPage />;
  }
  if (path === "/perf") {
    return <PerfPage />;
  }
  if (path === "/bench") {
    return <div data-testid="page-bench">bench page</div>;
  }
  if (path === "/spike") {
    return <SpikePage />;
  }
  if (path === "/editor") {
    return <EditorPage />;
  }
  if (path === "/react") {
    return <ReactDemo />;
  }
  if (path === "/diff") {
    return <DiffPage />;
  }
  if (path === "/plugins") {
    return <PluginsDemo />;
  }
  return <div data-testid="page-demo">demo page (react {REACT_VERSION})</div>;
}

export function App() {
  return (
    <main className="jul-editor-playground">
      <Page />
    </main>
  );
}
