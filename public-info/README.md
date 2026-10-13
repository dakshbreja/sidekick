# Separate public information site — staged, not deployed

This static site has no bindings, storage, credentials, forms, scripts or outbound application requests. It serves only About, Privacy and Terms. The private workspace and its Access policy must remain unchanged.

Proposed dedicated address: `school-bridge-community-info` on the operator's existing Workers subdomain. Before enabling its public route, review the rendered pages and obtain approval for these public documents. Repository defaults deliberately keep its public route disabled. Google currently blocks Production mode pending completed branding information. After publication, use this site's home/privacy/terms URLs for Google branding and preserve the private app's existing OAuth callback.

Provider verification and domain ownership requirements can remain separate gates. Publication alone does not verify Google consent, collection or Production status.
