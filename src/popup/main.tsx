import { createRoot } from "react-dom/client";
import { PopupPage } from "./popup-page";
import { chromeCredentialClient } from "../shared/credential-client";
import { chromeSiteToggleClient } from "../shared/site-toggle-client";
import "../ui.css";

createRoot(document.getElementById("root")!).render(
  <PopupPage
    client={chromeCredentialClient}
    siteClient={chromeSiteToggleClient}
    openOptions={() => void chrome.runtime.openOptionsPage()}
  />,
);
