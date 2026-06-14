import './translation-block.css';

import { Trans, useLingui } from '@lingui/react/macro';
import PQueue from 'p-queue';
import pRetry from 'p-retry';
import { useEffect, useRef, useState } from 'preact/hooks';

import languages from '../data/translang-languages';
import {
  translate as browserTranslate,
  supportsBrowserTranslator,
} from '../utils/browser-translator';
import getTranslateTargetLanguage from '../utils/get-translate-target-language';
import localeCode2Text from '../utils/localeCode2Text';
import pmem from '../utils/pmem';

import Icon from './icon';
import LazyShazam from './lazy-shazam';
import Loader from './loader';

const sourceLanguages = Object.entries(languages.sl).map(([code, name]) => ({
  code,
  name,
}));

const { PHANPY_TRANSLANG_INSTANCES } = import.meta.env;
const TRANSLANG_INSTANCES = PHANPY_TRANSLANG_INSTANCES
  ? PHANPY_TRANSLANG_INSTANCES.split(/\s+/)
  : [];

const translationQueue = new PQueue({
  concurrency: 1,
  interval: 2000,
  intervalCap: 1,
});

const TRANSLATED_MAX_AGE = 1000 * 60 * 60; // 1 hour
let currentTranslangInstance = 0;

function _translangTranslate(text, source, target) {
  console.log('TRANSLATE', text, source, target);
  const fetchCall = () => {
    let instance = TRANSLANG_INSTANCES[currentTranslangInstance];
    const tooLong = text.length > 2000;
    let fetchPromise;
    if (tooLong) {
      // POST
      fetchPromise = fetch(`https://${instance}/api/v1/translate`, {
        method: 'POST',
        priority: 'low',
        referrerPolicy: 'no-referrer',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sl: source,
          tl: target,
          text,
        }),
      });
    } else {
      // GET
      fetchPromise = fetch(
        `https://${instance}/api/v1/translate?sl=${encodeURIComponent(
          source,
        )}&tl=${encodeURIComponent(target)}&text=${encodeURIComponent(text)}`,
        {
          priority: 'low',
          referrerPolicy: 'no-referrer',
        },
      );
    }
    return fetchPromise
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return res.json();
      })
      .then((res) => {
        return {
          provider: 'translang',
          content: res.translated_text,
          detectedSourceLanguage: res.detected_language,
          pronunciation: res.pronunciation,
        };
      });
  };
  return pRetry(fetchCall, {
    retries: 3,
    onFailedAttempt: (e) => {
      currentTranslangInstance =
        (currentTranslangInstance + 1) % TRANSLANG_INSTANCES.length;
      console.log(
        'Retrying translation with another instance',
        currentTranslangInstance,
      );
    },
  });
}
const translangTranslate = pmem(_translangTranslate, {
  expires: TRANSLATED_MAX_AGE,
});
const throttledTranslangTranslate = pmem(
  ({ signal, text, source, target }) =>
    translationQueue.add(() => translangTranslate(text, source, target), {
      signal,
    }),
  {
    // I know, this is double-layered memoization
    expires: TRANSLATED_MAX_AGE,
  },
);

const throttledBrowserTranslate = ({ text, source, target, signal }) =>
  translationQueue.add(() => browserTranslate(text, source, target), {
    signal,
  });

function TranslationBlock({
  forceTranslate,
  sourceLanguage,
  onTranslate,
  text = '',
  mini,
  autoDetected,
}) {
  const { t } = useLingui();
  const targetLang = getTranslateTargetLanguage(true);
  const [uiState, setUIState] = useState('default');
  const [pronunciationContent, setPronunciationContent] = useState(null);
  const [translatedContent, setTranslatedContent] = useState(null);
  const [detectedLang, setDetectedLang] = useState(null);
  const detailsRef = useRef();
  const abortControllerRef = useRef();

  const sourceLangText = sourceLanguage
    ? localeCode2Text(sourceLanguage)
    : null;
  const targetLangText = localeCode2Text(targetLang);
  const apiSourceLang = useRef('auto');

  if (!onTranslate) {
    onTranslate = async ({ text, source, target, signal }) => {
      console.log('[TB] onTranslate called, mini=' + mini + ' supportsBrowserTranslator=' + supportsBrowserTranslator + ' TRANSLANG_INSTANCES.length=' + TRANSLANG_INSTANCES.length + ' source=' + source + ' target=' + target + ' textLen=' + text.length);
      if (supportsBrowserTranslator) {
        try {
          const result = await throttledBrowserTranslate({
            text,
            source,
            target,
            signal,
          });
          if (result && !result.error) {
            return result;
          }
        } catch (e) {
          // Browser translator unavailable or failed; fall through to next option
          console.warn('Browser translator failed:', e?.message || e);
        }
      }
      if (TRANSLANG_INSTANCES.length === 0) {
        // No Translang configured — fall back to MyMemory (free, no key needed)
        // Detect CJK from text directly — don't trust the server language tag
        // (GoToSocial and others often tag CJK posts as 'en')
        const srcLang = (() => {
          if (source !== 'auto') return source;
          const cjkCount = (text.match(/[\u2E80-\u9FFF\uF900-\uFAFF\u3400-\u4DBF]/g) || []).length;
          if (cjkCount / text.length > 0.15) {
            if (/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(text)) return 'ko';
            if (/[\u3041-\u309F\u30A0-\u30FF]/.test(text)) return 'ja';
            return 'zh';
          }
          return sourceLanguage || 'zh';
        })();
        const res = await fetch(
          `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(srcLang)}|${encodeURIComponent(target)}`,
          { priority: 'low', referrerPolicy: 'no-referrer', signal },
        );
        if (!res.ok) throw new Error(res.statusText);
        const json = await res.json();
        if (
          json.responseStatus === 200 &&
          json.responseData?.translatedText
        ) {
          console.log('[TB] MyMemory ok: srcLang=' + srcLang + ' result=' + json.responseData.translatedText.slice(0, 40));
          return {
            content: json.responseData.translatedText,
            detectedSourceLanguage: srcLang,
          };
        }
        console.log('[TB] MyMemory failed: status=' + json.responseStatus + ' details=' + json.responseDetails);
        throw new Error(json.responseDetails || 'MyMemory translation failed');
      }
      return mini
        ? await throttledTranslangTranslate({ signal, text, source, target })
        : await translangTranslate(text, source, target);
    };
  }

  const translate = async () => {
    setUIState('loading');
    try {
      const { content, detectedSourceLanguage, provider, error, ...props } =
        await onTranslate({
          text,
          source: apiSourceLang.current,
          target: targetLang,
          signal: abortControllerRef.current?.signal,
        });
      (window.__pdTBt = window.__pdTBt || []).push({k:text?.slice(0,12),content:content?.slice(0,20),dsl:detectedSourceLanguage,err:error,mini});
      if (content) {
        if (detectedSourceLanguage) {
          const detectedLangText = localeCode2Text(detectedSourceLanguage);
          setDetectedLang(detectedLangText);
        }
        if (provider === 'translang') {
          const pronunciation = props?.pronunciation;
          if (pronunciation) {
            setPronunciationContent(pronunciation);
          }
        }
        setTranslatedContent(content);
        setUIState('default');
        if (!mini && content.trim() !== text.trim() && detailsRef.current) {
          detailsRef.current.open = true;
          detailsRef.current.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
          });
        }
      } else {
        if (error) console.error(error);
        setUIState('error');
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error(e);
        setUIState('error');
      }
    }
  };

  useEffect(() => {
    if (forceTranslate) {
      translate();
    }
  }, [forceTranslate]);

  useEffect(() => {
    abortControllerRef.current = new AbortController();
    return () => {
      abortControllerRef.current.abort();
    };
  }, []);

  (window.__pdTB = window.__pdTB || []).push({k:text?.slice(0,12),mini,tc:translatedContent?.slice(0,20),dl:detectedLang,tlt:targetLangText,ft:forceTranslate,ui:uiState});
  if (mini) {
    if (
      !!translatedContent &&
      translatedContent.trim() !== text.trim() &&
      detectedLang !== targetLangText
    ) {
      return (
        <LazyShazam>
          <div class="status-translation-block-mini">
            <Icon
              icon="translate"
              alt={t`Auto-translated from ${sourceLangText}`}
            />
            <output
              lang={targetLang}
              dir="auto"
              title={pronunciationContent || ''}
            >
              {translatedContent}
            </output>
          </div>
        </LazyShazam>
      );
    }
    return null;
  }

  return (
    <div
      class="status-translation-block"
      onClick={(e) => {
        e.preventDefault();
      }}
    >
      <details ref={detailsRef}>
        <summary>
          <button
            type="button"
            class={uiState === 'loading' ? 'loading-mask' : ''}
            onClick={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              detailsRef.current.open = !detailsRef.current.open;
              if (uiState === 'loading') return;
              if (!translatedContent) translate();
            }}
          >
            <Icon icon="translate" />{' '}
            <span>
              {uiState === 'loading'
                ? t`Translating…`
                : sourceLanguage && sourceLangText && !detectedLang
                  ? autoDetected
                    ? t`Translate from ${sourceLangText} (auto-detected)`
                    : t`Translate from ${sourceLangText}`
                  : t`Translate`}
            </span>
          </button>
        </summary>
        <div class="translated-block">
          <div class="translation-info insignificant">
            <select
              class="translated-source-select"
              disabled={uiState === 'loading'}
              onChange={(e) => {
                apiSourceLang.current = e.target.value;
                translate();
              }}
            >
              {sourceLanguages.map((l) => {
                const common = localeCode2Text({
                  code: l.code,
                  fallback: l.name,
                });
                const native = localeCode2Text({
                  code: l.code,
                  locale: l.code,
                });
                const showCommon = native && common !== native;
                return (
                  <option value={l.code}>
                    {l.code === 'auto'
                      ? t`Auto (${detectedLang ?? '…'})`
                      : showCommon
                        ? `${native} - ${common}`
                        : common}
                  </option>
                );
              })}
            </select>{' '}
            <span>→ {targetLangText}</span>
            <Loader abrupt hidden={uiState !== 'loading'} />
          </div>
          {uiState === 'error' ? (
            <p class="ui-state">
              <Trans>Failed to translate</Trans>
            </p>
          ) : (
            !!translatedContent && (
              <>
                <output class="translated-content" lang={targetLang} dir="auto">
                  {translatedContent}
                </output>
                {!!pronunciationContent && (
                  <output
                    class="translated-pronunciation-content"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.target.classList.toggle('expand');
                    }}
                  >
                    {pronunciationContent}
                  </output>
                )}
              </>
            )
          )}
        </div>
      </details>
    </div>
  );
}

export default TranslationBlock;
