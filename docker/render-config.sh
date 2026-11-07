#!/bin/sh
# Renders the console's config.js (window.__RUNTARA_CONFIG__) and its
# security headers from RUNTARA_UI_* env vars, into RUNTARA_UI_RUNTIME_DIR
# (default /tmp/runtara), which nginx serves. Runs from the nginx image's
# /docker-entrypoint.d at every start, so one image serves any deployment.
#
#   RUNTARA_UI_AUTH_MODE          oidc (default) | local | trust_proxy
#   RUNTARA_UI_API_BASE_URL       the server's URL, e.g. https://api.example.com
#                                 (it lists this console in CORS_ALLOWED_ORIGINS);
#                                 unset only when one host routes /api to it
#   RUNTARA_UI_EVENTS_BASE_URL    where webhooks/HTTP triggers are delivered,
#                                 when not the API's host
#   RUNTARA_UI_TENANT_ID          the tenant of a server without an IdP
#   RUNTARA_UI_STRIP_ORG_ID       "true" for a single-tenant server
#   RUNTARA_UI_OIDC_AUTHORITY     required with oidc
#   RUNTARA_UI_OIDC_CLIENT_ID     required with oidc
#   RUNTARA_UI_OIDC_AUDIENCE
#   RUNTARA_UI_OIDC_ORGANIZATIONS "false" when the IdP has no Auth0 Organizations
#   RUNTARA_UI_PLAUSIBLE_DOMAIN   turns analytics on
#   RUNTARA_UI_PLAUSIBLE_HOST     default https://plausible.io
#   RUNTARA_UI_MOUNT_PATH         where the console's pages are, default /ui/
set -eu

out=${RUNTARA_UI_RUNTIME_DIR:-/tmp/runtara}
hashes=${RUNTARA_UI_SCRIPT_HASHES:-/etc/runtara/inline-script-hashes}
mkdir -p "$out"

fail() {
    echo "runtara-frontend: $*" >&2
    exit 1
}

# A JSON string. Values are URLs and identifiers; control characters are
# refused rather than escaped.
json() {
    case $1 in
        *[[:cntrl:]]*) fail "a RUNTARA_UI_* value has a control character" ;;
    esac
    printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s#</#<\\/#g')"
}

# The origin of a URL (scheme://host[:port]). Plain http is allowed: an
# air-gapped install may have no TLS.
origin() {
    value=$1
    key=$2
    case $value in
        *://*) ;;
        *) value="https://$value" ;;
    esac
    found=$(printf '%s' "$value" | sed -n 's|^\(https\{0,1\}://[^/?#]\{1,\}\).*|\1|p')
    [ -n "$found" ] || fail "$key is not an http(s) URL: $1"
    printf '%s' "$found"
}

auth_mode=${RUNTARA_UI_AUTH_MODE:-oidc}
case $auth_mode in
    oidc)
        [ -n "${RUNTARA_UI_OIDC_AUTHORITY:-}" ] || fail "authMode oidc needs RUNTARA_UI_OIDC_AUTHORITY"
        [ -n "${RUNTARA_UI_OIDC_CLIENT_ID:-}" ] || fail "authMode oidc needs RUNTARA_UI_OIDC_CLIENT_ID"
        ;;
    local | trust_proxy) ;;
    trust-proxy) auth_mode=trust_proxy ;;
    *) fail "RUNTARA_UI_AUTH_MODE must be oidc, local or trust_proxy, not '$auth_mode'" ;;
esac

config="\"hosting\":\"static\",\"authMode\":$(json "$auth_mode")"
add() {
    if [ -n "$2" ]; then config="$config,\"$1\":$(json "$2")"; fi
}
add apiBaseUrl "${RUNTARA_UI_API_BASE_URL:-}"
add eventsBaseUrl "${RUNTARA_UI_EVENTS_BASE_URL:-}"
add tenantId "${RUNTARA_UI_TENANT_ID:-}"
add stripOrgId "${RUNTARA_UI_STRIP_ORG_ID:-}"
add oidcAuthority "${RUNTARA_UI_OIDC_AUTHORITY:-}"
add oidcClientId "${RUNTARA_UI_OIDC_CLIENT_ID:-}"
add oidcAudience "${RUNTARA_UI_OIDC_AUDIENCE:-}"
add oidcOrganizations "${RUNTARA_UI_OIDC_ORGANIZATIONS:-}"
add plausibleDomain "${RUNTARA_UI_PLAUSIBLE_DOMAIN:-}"
add plausibleHost "${RUNTARA_UI_PLAUSIBLE_HOST:-}"
add mountPath "${RUNTARA_UI_MOUNT_PATH:-}"
printf 'window.__RUNTARA_CONFIG__ = {%s};\n' "$config" > "$out/config.js.tmp"
mv "$out/config.js.tmp" "$out/config.js"

if [ -z "${RUNTARA_UI_API_BASE_URL:-}" ]; then
    echo "runtara-frontend: RUNTARA_UI_API_BASE_URL is unset: the console calls /api on its own origin" >&2
fi

# The same policy as Runtara Cloud's console: the console's own origin, the
# API, the IdP and, with analytics on, Plausible.
scripts="'self'"
connects="'self'"
[ -n "${RUNTARA_UI_API_BASE_URL:-}" ] && connects="$connects $(origin "$RUNTARA_UI_API_BASE_URL" RUNTARA_UI_API_BASE_URL)"
[ -n "${RUNTARA_UI_OIDC_AUTHORITY:-}" ] && connects="$connects $(origin "$RUNTARA_UI_OIDC_AUTHORITY" RUNTARA_UI_OIDC_AUTHORITY)"
if [ -n "${RUNTARA_UI_PLAUSIBLE_DOMAIN:-}" ]; then
    plausible=$(origin "${RUNTARA_UI_PLAUSIBLE_HOST:-https://plausible.io}" RUNTARA_UI_PLAUSIBLE_HOST)
    scripts="$scripts $plausible"
    connects="$connects $plausible"
fi
scripts="$scripts 'wasm-unsafe-eval' $(tr '\n' ' ' < "$hashes")"

csp="default-src 'self'; script-src ${scripts% }; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src $connects; manifest-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'"
cat > "$out/security-headers.conf.tmp" <<CONF
add_header Content-Security-Policy "$csp" always;
add_header X-Content-Type-Options nosniff always;
add_header Referrer-Policy strict-origin-when-cross-origin always;
CONF
mv "$out/security-headers.conf.tmp" "$out/security-headers.conf"

echo "runtara-frontend: authMode=$auth_mode api=${RUNTARA_UI_API_BASE_URL:-<same origin>}"
