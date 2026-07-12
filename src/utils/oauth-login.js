import {
  getAuthorizationURL,
  getPKCEAuthorizationURL,
  registerApplication,
} from './auth';
import { openAuthPopup, watchAuthPopup } from './auth-popup';
import { supportsPKCE } from './oauth-pkce';
import store from './store';
import {
  getCredentialApplication,
  hasAccountInInstance,
  storeCredentialApplication,
} from './store-utils';

// Starts the "Sign in with Google" (or whatever IdP the instance uses)
// flow for a known instance, in a popup window, WITHOUT navigating the
// current page away first.
//
// This is meant for entry points where the user is already looking at a
// fully interactive page (nav menu, account switcher, settings) on a
// single-instance deployment: there's no need to detour through the
// instance-picker page (`/login`) just to have it auto-submit itself.
//
// If the popup is closed before finishing, or app registration fails,
// `onError` is called and the calling page is completely unaffected --
// since we never navigated away from it, there's nothing to get stuck
// on (no instance-picker form, no "redirecting..." screen).
export async function startInstanceLogin(instanceURL, { onError } = {}) {
  if (!instanceURL) return;

  // WEB_DOMAIN vs LOCAL_DOMAIN negotiation time
  // https://docs.joinmastodon.org/admin/config/#web_domain
  try {
    const res = await fetch(`https://${instanceURL}/.well-known/host-meta`); // returns XML
    const text = await res.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, 'text/xml');
    const link = xmlDoc.getElementsByTagName('Link')[0];
    const template = link.getAttribute('template');
    const url = URL.parse(template);
    const { host } = url; // host includes the port
    if (instanceURL !== host) {
      console.log(`💫 ${instanceURL} -> ${host}`);
      instanceURL = host;
    }
  } catch (e) {
    // Silently fail
    console.error(e);
  }

  store.local.set('instanceURL', instanceURL);

  try {
    let credentialApplication = getCredentialApplication(instanceURL);
    if (
      !credentialApplication ||
      !credentialApplication.client_id ||
      !credentialApplication.client_secret
    ) {
      credentialApplication = await registerApplication({ instanceURL });
      storeCredentialApplication(instanceURL, credentialApplication);
    }

    const { client_id, client_secret } = credentialApplication;
    if (!client_id || !client_secret) {
      onError?.(new Error('Failed to register application'));
      return;
    }

    const authPKCE = await supportsPKCE({ instanceURL });
    const forceLogin = hasAccountInInstance(instanceURL);

    let authUrl;
    if (authPKCE && window.isSecureContext) {
      const [url, verifier] = await getPKCEAuthorizationURL({
        instanceURL,
        client_id,
        forceLogin,
      });
      store.sessionCookie.set('codeVerifier', verifier);
      authUrl = url;
    } else {
      authUrl = await getAuthorizationURL({
        instanceURL,
        client_id,
        forceLogin,
      });
    }

    const popup = openAuthPopup(authUrl);

    if (popup) {
      watchAuthPopup(
        popup,
        (code) => {
          // Only on *success* do we hand off to the app's existing
          // top-level ?code= handler (app.jsx) by reloading with the
          // code attached. This doesn't affect the "stay put while
          // waiting" behavior, since it only fires once auth is done.
          const callbackUrl = `${window.location.origin}${window.location.pathname}?code=${encodeURIComponent(code)}`;
          window.location.href = callbackUrl;
        },
        (error) => {
          console.error('Popup auth error:', error);
          onError?.(error);
        },
      );
    } else {
      // Popup blocked -- browsers require a real top-level navigation to
      // start the OAuth request in this case, no way around it.
      location.href = authUrl;
    }
  } catch (e) {
    console.error(e);
    onError?.(e);
  }
}
