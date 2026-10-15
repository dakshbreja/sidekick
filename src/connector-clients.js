// Shared allowlist for registration, authorization and the consent return link.
export function connectorProvider(value, response = false) {
  let u; try { u = new URL(value); } catch { return null; }
  if (u.username || u.password || u.hash || (!response && u.search)) return null;
  if (u.origin === 'https://claude.ai' && u.pathname === '/api/mcp/auth_callback') return 'Claude';
  if (u.origin === 'https://chatgpt.com' && (u.pathname === '/connector_platform_oauth_redirect' || /^\/connector\/oauth\/[A-Za-z0-9_-]{8,160}$/.test(u.pathname))) return 'ChatGPT';
  return null;
}
