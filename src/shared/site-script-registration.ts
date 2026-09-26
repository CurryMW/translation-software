export function siteScriptId(domain: string): string {
  return `site-${[...domain].map((character) => character.codePointAt(0)!.toString(16)).join("-")}`;
}

export function siteMatchPatterns(domain: string): string[] {
  return [`http://${domain}/*`, `https://${domain}/*`];
}
