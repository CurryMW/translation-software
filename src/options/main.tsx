import { createRoot } from "react-dom/client";
import { OptionsPage } from "./options-page";
import { chromeCredentialClient } from "../shared/credential-client";
import { chromeTranslationUsageClient } from "../shared/translation-usage-client";
import { chromeBaiduManualSmokeClient } from "../shared/baidu-manual-smoke-client";
import { chromeBaiduProviderPermissionClient } from "../shared/baidu-provider-permission-client";
import { chromeTranslationAppearanceClient } from "../shared/translation-appearance-client";
import { chromeSiteToggleClient } from "../shared/site-toggle-client";
import "../ui.css";

createRoot(document.getElementById("root")!).render(<OptionsPage client={chromeCredentialClient} usageClient={chromeTranslationUsageClient} manualSmokeClient={chromeBaiduManualSmokeClient} providerPermissionClient={chromeBaiduProviderPermissionClient} appearanceClient={chromeTranslationAppearanceClient} siteClient={chromeSiteToggleClient} buildVersion={chrome.runtime.getManifest().version} />);
