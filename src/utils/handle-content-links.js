import states from './states';

const supportsHover = window.matchMedia('(hover: hover)').matches;

function handleContentLinks(opts) {
  const {
    mentions = [],
    instance,
    previewMode,
    statusURL,
    mediaAttachments = [],
    statusID,
  } = opts || {};
  return (e) => {
    // If cmd/ctrl/shift/alt key is pressed or middle-click, let the browser handle it
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.which === 2) {
      return;
    }

    let { target } = e;

    // Inline Markdown images (Freelimbo-fork extension, `![alt](url)`
    // syntax) are rendered as plain <img class="inline-attachment">
    // tags directly in status content -- unlike gallery attachments,
    // they have no click-to-zoom wired up by default. Open the same
    // media lightbox gallery attachments use, matching against the
    // status's own media_attachments by URL so we get the real
    // type/blurhash/description if available, falling back to a
    // minimal synthetic entry (same as the custom-emoji case below)
    // if no match is found.
    if (target.matches?.('img.inline-attachment')) {
      e.preventDefault();
      e.stopPropagation();
      const matched = mediaAttachments.find((m) => m.url === target.src);
      states.showMediaModal = {
        mediaAttachments: [
          matched || {
            type: 'image',
            url: target.src,
            description: target.title || target.alt,
          },
        ],
        instance,
        statusID,
      };
      return;
    }

    // Experiment opening custom emoji in a modal
    // TODO: Rename this function because it's not just for links
    if (target.closest('.shortcode-emoji')) {
      const { naturalWidth, naturalHeight, width, height } = target;
      const kindaLargeRatio = 2;
      const kindaLarge =
        naturalWidth > width * kindaLargeRatio ||
        naturalHeight > height * kindaLargeRatio;
      if (kindaLarge) {
        e.preventDefault();
        e.stopPropagation();
        states.showMediaModal = {
          mediaAttachments: [
            {
              type: 'image',
              url: target.src,
              description: target.title || target.alt,
            },
          ],
        };
        return;
      }
    }

    target = target.closest('a');
    if (!target) return;
    // Only handle links inside, not itself or anything outside
    if (!e.currentTarget.contains(target)) return;

    const { href } = target;

    const prevText = target.previousSibling?.textContent;
    const textBeforeLinkIsAt =
      prevText?.endsWith('@') || prevText?.endsWith('＠');
    const textStartsWithAt =
      target.innerText.startsWith('@') || target.innerText.startsWith('＠');
    if (
      ((target.classList.contains('u-url') ||
        target.classList.contains('mention')) &&
        textStartsWithAt) ||
      (textBeforeLinkIsAt && !textStartsWithAt)
    ) {
      const targetText = (
        target.querySelector('span') || target
      ).innerText.trim();
      const username = targetText.replace(/^[@＠]/, '');
      // Only fallback to acct/username check if url doesn't match
      const mention =
        mentions.find((mention) => mention.url === href) ||
        mentions.find(
          (mention) =>
            mention.acct === username || mention.username === username,
        );
      console.warn('MENTION', mention, href);
      if (mention) {
        e.preventDefault();
        e.stopPropagation();
        states.showAccount = {
          account: mention.acct,
          instance,
        };
        return;
      } else if (!/^http/i.test(targetText)) {
        console.log('mention not found', targetText);
        e.preventDefault();
        e.stopPropagation();
        states.showAccount = {
          account: href,
          instance,
        };
        return;
      }
    } else if (!previewMode) {
      const textBeforeLinkIsHash =
        prevText?.endsWith('#') || prevText?.endsWith('＃');
      if (target.classList.contains('hashtag') || textBeforeLinkIsHash) {
        e.preventDefault();
        e.stopPropagation();
        const tag = target.innerText.replace(/^[#＃]/, '').trim();
        const hashURL = instance ? `#/${instance}/t/${tag}` : `#/t/${tag}`;
        console.log({ hashURL });
        location.hash = hashURL;
        return;
      } else if (states.unfurledLinks[href]?.url && statusURL !== href) {
        // If unfurled AND not self-referential
        e.preventDefault();
        e.stopPropagation();
        states.prevLocation = {
          pathname: location.hash.replace(/^#/, ''),
        };
        location.hash = `#${states.unfurledLinks[href].url}`;
        return;
      }
    }

    try {
      const urlObj = URL.parse(href);
      const domain = urlObj.hostname.replace(/^www\./i, '');
      const containsDomain = target.innerText
        .toLowerCase()
        .includes(domain.toLowerCase());
      // Only show this on non-hover devices (touch-only)
      // Assuming that hover-supported = there's a statusbar to see the URL
      // Non-hover devices don't have statusbar, so we show this
      if (!containsDomain && !supportsHover) {
        e.preventDefault();
        e.stopPropagation();
        const linkText = target.innerText.trim();
        states.showOpenLink = {
          url: href,
          linkText,
        };
      }
    } catch (e) {}
  };
}

export default handleContentLinks;
