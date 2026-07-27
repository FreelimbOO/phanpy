import '@justinribeiro/lite-youtube';

import { decodeBlurHash, getBlurHashAverageColor } from 'fast-blurhash';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useSnapshot } from 'valtio';

import getDomain from '../utils/get-domain';
import isMastodonLinkMaybe from '../utils/isMastodonLinkMaybe';
import states from '../utils/states';
import unfurlMastodonLink from '../utils/unfurl-link';

import Byline from './byline';
import Icon from './icon';
import RelativeTime from './relative-time';

// "Post": Quote post + card link preview combo
// Assume all links from these domains are "posts"
// Mastodon links are "posts" too but they are converted to real quote posts and there's too many domains to check
// This is just "Progressive Enhancement"
function isCardPost(domain) {
  return [
    'x.com',
    'twitter.com',
    'threads.net',
    'bsky.app',
    'bsky.brid.gy',
    'fed.brid.gy',
  ].includes(domain);
}

function StatusCard({ card, selfReferential, selfAuthor, instance }) {
  const snapStates = useSnapshot(states);
  const {
    blurhash,
    title,
    description,
    html,
    providerName,
    providerUrl,
    authorName,
    authorUrl,
    width,
    height,
    image,
    imageDescription,
    url,
    type,
    embedUrl,
    language,
    publishedAt,
    authors,
  } = card;

  /* type
  link = Link OEmbed
  photo = Photo OEmbed
  video = Video OEmbed
  rich = iframe OEmbed. Not currently accepted, so won't show up in practice.
  */

  const hasText = title || providerName || authorName;
  const isLandscape = width / height >= 1.2;
  const size = isLandscape ? 'large' : '';

  const [cardStatusURL, setCardStatusURL] = useState(null);
  // const [cardStatusID, setCardStatusID] = useState(null);
  useEffect(() => {
    if (!hasText || !image || selfReferential || !isMastodonLinkMaybe(url)) {
      return;
    }

    const abortController = new AbortController();
    unfurlMastodonLink(instance, url, abortController.signal).then((result) => {
      if (!result) return;
      const { id, url } = result;
      setCardStatusURL('#' + url);

      // NOTE: This is for quote post
      // (async () => {
      //   const { masto } = api({ instance });
      //   const status = await masto.v1.statuses.$select(id).fetch();
      //   saveStatus(status, instance);
      //   setCardStatusID(id);
      // })();
    });

    return () => {
      abortController.abort();
    };
  }, [hasText, image, selfReferential]);

  // if (cardStatusID) {
  //   return (
  //     <Status statusID={cardStatusID} instance={instance} size="s" readOnly />
  //   );
  // }

  if (snapStates.unfurledLinks[url]) return null;

  const hasIframeHTML = /<iframe/i.test(html);
  const handleClick = useCallback(
    (e) => {
      if (hasIframeHTML) {
        e.preventDefault();
        states.showEmbedModal = {
          html,
          url: url || embedUrl,
          width,
          height,
        };
      }
    },
    [hasIframeHTML],
  );

  const [blurhashImage, setBlurhashImage] = useState(null);
  if (hasText && (image || (type === 'photo' && blurhash))) {
    const domain = getDomain(url);
    const rgbAverageColor =
      image && blurhash ? getBlurHashAverageColor(blurhash) : null;
    if (!image) {
      const w = 44;
      const h = 44;
      const blurhashPixels = decodeBlurHash(blurhash, w, h);
      const canvas = window.OffscreenCanvas
        ? new OffscreenCanvas(1, 1)
        : document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      const imageData = ctx.createImageData(w, h);
      imageData.data.set(blurhashPixels);
      ctx.putImageData(imageData, 0, 0);
      try {
        if (window.OffscreenCanvas) {
          canvas.convertToBlob().then((blob) => {
            setBlurhashImage(URL.createObjectURL(blob));
          });
        } else {
          setBlurhashImage(canvas.toDataURL());
        }
      } catch (e) {
        // Silently fail
        console.error(e);
      }
    }

    const isPost = isCardPost(domain);

    return (
      <Byline hidden={!!selfAuthor} authors={authors}>
        <a
          href={cardStatusURL || url}
          target={cardStatusURL ? null : '_blank'}
          rel="nofollow noopener"
          class={`card link ${isPost ? 'card-post' : ''} ${
            blurhashImage ? '' : size
          } ${hasIframeHTML ? 'can-show-embed' : ''}`}
          style={{
            '--average-color':
              rgbAverageColor && `rgb(${rgbAverageColor.join(',')})`,
          }}
          onClick={handleClick}
        >
          <div class="card-image">
            <img
              src={image || blurhashImage}
              width={width}
              height={height}
              loading="lazy"
              decoding="async"
              fetchPriority="low"
              alt={imageDescription || ''}
              onError={(e) => {
                try {
                  e.target.style.display = 'none';
                } catch (e) {}
              }}
              style={{
                '--anim-duration':
                  width &&
                  height &&
                  `${Math.min(
                    Math.max(Math.max(width, height) / 100, 5),
                    120,
                  )}s`,
              }}
            />
          </div>
          <div class="meta-container" lang={language}>
            <p class="meta domain">
              <span class="domain">{domain}</span>{' '}
              {!!publishedAt && <>&middot; </>}
              {!!publishedAt && (
                <>
                  <RelativeTime datetime={publishedAt} format="micro" />
                </>
              )}
            </p>
            <p class="title" dir="auto" title={title}>
              {title}
            </p>
            <p class="meta" dir="auto" title={description}>
              {description ||
                (!!publishedAt && (
                  <RelativeTime datetime={publishedAt} format="micro" />
                ))}
            </p>
          </div>
        </a>
      </Byline>
    );
  } else if (type === 'photo') {
    return (
      <a
        href={url}
        target="_blank"
        rel="nofollow noopener"
        class="card photo"
        onClick={handleClick}
      >
        <img
          src={embedUrl}
          width={width}
          height={height}
          alt={title || description}
          loading="lazy"
          style={{
            height: 'auto',
            aspectRatio: `${width}/${height}`,
          }}
        />
      </a>
    );
  } else {
    if (type === 'video') {
      if (/youtube/i.test(providerName)) {
        // Get ID from e.g. https://www.youtube.com/watch?v=[VIDEO_ID]
        const videoID = url.match(/watch\?v=([^&]+)/)?.[1];
        if (videoID) {
          return (
            <a class="card video" onClick={handleClick}>
              <lite-youtube videoid={videoID} nocookie autoPause></lite-youtube>
            </a>
          );
        }
      }
      // return (
      //   <div
      //     class="card video"
      //     style={{
      //       aspectRatio: `${width}/${height}`,
      //     }}
      //     dangerouslySetInnerHTML={{ __html: html }}
      //   />
      // );
    }
    if (hasText && !image) {
      const domain = getDomain(url);
      const isPost = isCardPost(domain);
      return (
        <a
          href={cardStatusURL || url}
          target={cardStatusURL ? null : '_blank'}
          rel="nofollow noopener"
          class={`card link ${isPost ? 'card-post' : ''} no-image`}
          lang={language}
          dir="auto"
          onClick={handleClick}
        >
          <div class="meta-container">
            <p class="meta domain">
              <span class="domain">
                <Icon icon="link" size="s" /> <span>{domain}</span>
              </span>{' '}
              {!!publishedAt && <>&middot; </>}
              {!!publishedAt && (
                <>
                  <RelativeTime datetime={publishedAt} format="micro" />
                </>
              )}
            </p>
            <p class="title" title={title}>
              {title}
            </p>
            <p class="meta" title={description || providerName || authorName}>
              {description || providerName || authorName}
            </p>
          </div>
        </a>
      );
    }
  }
}

export default StatusCard;

// YouTube video ID regex — matches watch?v=, youtu.be/, and /shorts/ URLs.
// `g` flag so extractYouTubeVideoIds can find every match in the content,
// not just the first -- a post can contain multiple plain-text YouTube
// links, each rendered as its own embedded player.
const YT_REGEX =
  /href="https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?(?:[^"]*&)*v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/gi;

// Returns every distinct YouTube video ID linked in the given (rendered)
// HTML content, in the order they first appear, or [] if none.
export function extractYouTubeVideoIds(html) {
  if (!html) return [];
  const ids = [];
  const seen = new Set();
  for (const match of html.matchAll(YT_REGEX)) {
    const id = match[1];
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export function YouTubeCard({ videoId }) {
  const [title, setTitle] = useState('');

  useEffect(() => {
    fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
    )
      .then((r) => r.json())
      .then((data) => setTitle(data.title))
      .catch(() => {});
  }, [videoId]);

  return (
    <div
      class="card video youtube-card"
      onClick={(e) => e.stopPropagation()}
    >
      <lite-youtube
        videoid={videoId}
        videotitle={title}
        nocookie
        autoPause
        style="pointer-events: auto"
      ></lite-youtube>
    </div>
  );
}

// Matches a YouTube video ID directly out of an anchor's resolved
// `.href` (an absolute URL string, unlike YT_REGEX above which expects
// a raw `href="..."` HTML attribute fragment).
const YT_HREF_ID_REGEX =
  /(?:youtube\.com\/watch\?(?:[^&]*&)*v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/i;

// Positions each YouTube card right after the paragraph (or list item /
// blockquote) containing its link, instead of status.jsx's other option
// of just appending every card after the whole post -- which reads fine
// for a short plain-text post with one link, but looks disconnected in
// a longer Markdown post where the link might be near the top and the
// card ends up stranded at the very bottom, past unrelated paragraphs
// and attached photos.
//
// Deliberately plain DOM manipulation on the already-rendered content
// (contentRef), not React children -- `content` is a server-rendered
// HTML string handed to PostContent, so there's no JSX tree to splice a
// <YouTubeCard> into at the right spot. This mirrors math-block.jsx's
// existing pattern of mutating contentRef.current directly for a
// similar reason (post-processing rendered HTML content). <lite-youtube>
// is a real custom element (registered by the import at the top of this
// file), so building it with plain DOM APIs works the same as JSX would.
export function InlineYouTubeCards({ contentRef, videoIds }) {
  const insertedRef = useRef([]);

  useEffect(() => {
    // Always clear out whatever this effect inserted last time first,
    // whether or not this run has anything new to insert -- content or
    // videoIds may have changed.
    insertedRef.current.forEach((el) => el.remove());
    insertedRef.current = [];

    const container = contentRef?.current;
    if (!container || !videoIds?.length) return;

    const idToAnchor = new Map();
    for (const a of container.querySelectorAll('a[href]')) {
      const id = a.href?.match(YT_HREF_ID_REGEX)?.[1];
      if (id && !idToAnchor.has(id)) idToAnchor.set(id, a);
    }

    for (const videoId of videoIds) {
      const link = idToAnchor.get(videoId);
      if (!link) continue; // Shouldn't normally happen -- youtubeVideoIds
      // is itself derived from this same content -- but content could
      // theoretically change between the two in a way that drops a
      // link, so don't throw if a match isn't found.
      //
      // Insert directly after the link itself, NOT its closest block
      // ancestor (p/li/blockquote) -- a Markdown paragraph with single
      // (not blank-line-separated) line breaks between "lines" renders
      // as ONE <p> with soft breaks in between, not one <p> per line, so
      // the closest paragraph can contain a lot more than just this
      // link (any text/images that came after it in the same block too).
      // Plain-text posts happened to look right with the old
      // closest-block approach only because GtS's plain-text formatter
      // wraps each line in its own <p>, which isn't true for Markdown.
      // A block-level <div> card inserted directly after an inline <a>
      // still naturally forces a line break before/after itself, so
      // this reads fine either way.
      const card = createYouTubeCardElement(videoId);
      link.insertAdjacentElement('afterend', card);
      insertedRef.current.push(card);
    }

    return () => {
      insertedRef.current.forEach((el) => el.remove());
      insertedRef.current = [];
    };
  }, [contentRef, videoIds]);

  return null;
}

function createYouTubeCardElement(videoId) {
  const card = document.createElement('div');
  card.className = 'card video youtube-card';
  card.addEventListener('click', (e) => e.stopPropagation());

  const liteYoutube = document.createElement('lite-youtube');
  liteYoutube.setAttribute('videoid', videoId);
  liteYoutube.setAttribute('nocookie', '');
  liteYoutube.setAttribute('autoPause', '');
  liteYoutube.style.pointerEvents = 'auto';
  card.appendChild(liteYoutube);

  // Best-effort, same as YouTubeCard's own title fetch -- fill it in
  // once it resolves rather than blocking insertion on it.
  fetch(
    `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
  )
    .then((r) => r.json())
    .then((data) => {
      if (data?.title) liteYoutube.setAttribute('videotitle', data.title);
    })
    .catch(() => {});

  return card;
}
