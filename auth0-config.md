# GeoMark Auth0 config (dev-geomark). Non-secret values.
AUTH0_DOMAIN=dev-geomark.jp.auth0.com
AUTH0_AUDIENCE=https://attendance-api
AUTH0_MOBILE_CLIENT_ID=T1FFcHDPO3CwmU7dcQG8meqeHZjx8Yqa   # Native, callback geomark://dev-geomark.jp.auth0.com/android/com.jajal.geomark/callback
AUTH0_ADMIN_CLIENT_ID=XBdoMKG3kteo2Z0ld3xxEpnjcF5Ndlnn    # SPA, http://localhost:5173
ROLES_CLAIM=https://attendance-api/roles
ROLE_ADMIN=rol_E4AkjiaEuuKbLdwW
ROLE_EMPLOYEE=rol_pN7mzwSoGG6tQhB0
# CLI: HOME=~/attendance-app/.auth0-cli auth0 <cmd> --tenant dev-geomark.jp.auth0.com --no-input </dev/null
