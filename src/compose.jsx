import './index.css';
import './app.css';

import './polyfills';

import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { Trans, useLingui } from '@lingui/react/macro';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import ComposeSuspense from './components/compose-suspense';
import { IconSpriteProvider } from './components/icon-sprite-manager';
import Loader from './components/loader';
import { initActivateLang } from './utils/lang';
import { initPWAViewport } from './utils/pwa-viewport';
import { initStates } from './utils/states';
import { getCurrentAccount } from './utils/store-utils';
import useTitle from './utils/useTitle';

initActivateLang();
initPWAViewport();

if (window.opener) {
  console = window.opener.console;
}

function App() {
  const { t } = useLingui();
  const [uiState, setUIState] = useState('default');
  const [isLoggedIn, setIsLoggedIn] = useState(null);

  const { editStatus, replyToStatus, replyMode, draftStatus, quoteStatus } =
    window.__COMPOSE__ || {};

  useTitle(
    editStatus
      ? t`Editing source status`
      : replyToStatus
        ? t`Replying to @${
            replyToStatus.account?.acct || replyToStatus.account?.username
          }`
        : t`Compose`,
  );

  useEffect(() => {
    const account = getCurrentAccount();
    setIsLoggedIn(!!account);
    if (account) {
      initStates();
    }
  }, []);

  useEffect(() => {
    if (uiState === 'closed') {
      try {
        // Focus parent window
        window.opener.focus();
      } catch (e) {}
      window.close();
    }
  }, [uiState]);

  if (uiState === 'closed') {
    return (
      <div class="box">
        <p>
          <Trans>You may close this page now.</Trans>
        </p>
        <p>
          <button
            onClick={() => {
              window.close();
            }}
          >
            <Trans>Close window</Trans>
          </button>
        </p>
      </div>
    );
  }

  console.debug('OPEN COMPOSE');

  if (isLoggedIn === false) {
    return (
      <div class="box">
        <h1>
          <Trans>Error</Trans>
        </h1>
        <p>
          <Trans>Login required.</Trans>
        </p>
        <p>
          <a href="/">
            <Trans>Go home</Trans>
          </a>
        </p>
      </div>
    );
  }

  if (isLoggedIn) {
    return (
      <ComposeSuspense
        editStatus={editStatus}
        replyToStatus={replyToStatus}
        replyMode={replyMode || 'all'}
        draftStatus={draftStatus}
        quoteStatus={quoteStatus}
        standalone
        hasOpener={window.opener}
        onClose={async (results) => {
          const { newStatus, fn = () => {}, pendingVideoUploads } =
            results || {};
          try {
            if (newStatus) {
              window.opener.__STATES__.reloadStatusPage++;
            }
            fn();
            if (pendingVideoUploads) {
              // Keep this popped-out window alive until the background
              // YouTube upload(s) + status edit finish. Closing the
              // window (setUIState('closed') below triggers
              // window.close() in the effect above) would kill this
              // window's whole JS realm mid-fetch otherwise -- the video
              // upload can take a while, and there's nothing left running
              // to swap the post's placeholder for the real link once
              // this window is gone. See compose.jsx's own comment at
              // the pendingVideoUploads call site for the full story.
              await pendingVideoUploads;
            }
            setUIState('closed');
          } catch (e) {}
        }}
      />
    );
  }

  return (
    <div class="box">
      <Loader />
    </div>
  );
}

render(
  <I18nProvider i18n={i18n}>
    <IconSpriteProvider>
      <App />
    </IconSpriteProvider>
  </I18nProvider>,
  document.getElementById('app-standalone'),
);
