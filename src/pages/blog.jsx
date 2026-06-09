import './blog.css';

import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useEffect, useRef, useState } from 'preact/hooks';

import Icon from '../components/icon';
import Loader from '../components/loader';
import NavMenu from '../components/nav-menu';
import useTitle from '../utils/useTitle';

const BLOG_FEED_URL = 'https://blog.freelimbo.com/index.xml';
const BLOG_BASE_URL = 'https://blog.freelimbo.com';

function parseFeed(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const items = Array.from(doc.querySelectorAll('item'));

  return items.map((item) => {
    const title = item.querySelector('title')?.textContent || '';
    const link = item.querySelector('link')?.textContent?.trim() || '';
    const pubDate = item.querySelector('pubDate')?.textContent || '';
    const description = item.querySelector('description')?.textContent || '';

    // Categories
    const categories = Array.from(item.querySelectorAll('category')).map(
      (c) => c.textContent,
    );

    // Try to extract cover image from enclosure or description HTML
    let thumb = null;
    const enclosure = item.querySelector('enclosure');
    if (enclosure?.getAttribute('type')?.startsWith('image/')) {
      thumb = enclosure.getAttribute('url');
    }
    if (!thumb) {
      // Try to find first img in description HTML
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = description;
      const img = tempDiv.querySelector('img');
      if (img) thumb = img.src;
    }

    // Plain-text excerpt from description HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = description;
    const excerptHTML = tempDiv.innerHTML;

    // Parse date
    let dateLabel = '';
    if (pubDate) {
      try {
        const d = new Date(pubDate);
        dateLabel = d.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
      } catch (_) {
        dateLabel = pubDate;
      }
    }

    // Derive slug-based cover image URL from Hugo convention if no thumb found
    // Hugo stores covers at /img/<slug>/<cover> — the feed's <link> gives us the slug
    if (!thumb) {
      const slugMatch = link.match(/\/posts\/([^/]+)\/?$/);
      if (slugMatch) {
        // Heuristic: try /img/<slug>/cover.jpg but we can't know the exact filename
        // so we just leave thumb null
      }
    }

    return {
      title,
      link: link || `${BLOG_BASE_URL}/`,
      pubDate,
      dateLabel,
      description: excerptHTML,
      categories,
      thumb,
    };
  });
}

function BlogPostCard({ post }) {
  return (
    <article class="blog-post-card">
      {post.thumb && (
        <img
          class="blog-post-thumb"
          src={post.thumb}
          alt=""
          loading="lazy"
          width="72"
          height="72"
        />
      )}
      <div class="blog-post-body">
        <a
          class="blog-post-title"
          href={post.link}
          target="_blank"
          rel="noopener noreferrer"
        >
          {post.title}
        </a>
        <div class="blog-post-meta">
          {post.dateLabel}
          {post.categories?.length > 0 && (
            <> · {post.categories.join(', ')}</>
          )}
        </div>
        {post.description && (
          <div
            class="blog-post-excerpt"
            dangerouslySetInnerHTML={{ __html: post.description }}
          />
        )}
      </div>
    </article>
  );
}

function Blog({ columnMode }) {
  useTitle(t`Blog`, '/blog');
  const [posts, setPosts] = useState([]);
  const [uiState, setUIState] = useState('loading');
  const scrollableRef = useRef();

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(BLOG_FEED_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const parsed = parseFeed(text);
        setPosts(parsed);
        setUIState('default');
      } catch (e) {
        console.error('Blog feed fetch error', e);
        setUIState('error');
      }
    })();
  }, []);

  return (
    <div id="blog-page" class="deck-container" ref={scrollableRef} tabIndex="-1">
      <div class="timeline-deck deck">
        <header>
          <div class="header-grid">
            <div class="header-side">
              <NavMenu />
            </div>
            <h1>
              <Trans>Blog</Trans>
            </h1>
            <div class="header-side">
              <a
                href={BLOG_BASE_URL}
                target="_blank"
                rel="noopener noreferrer"
                class="button plain"
                title={t`Open blog`}
              >
                <Icon icon="external" size="l" />
              </a>
            </div>
          </div>
        </header>

        <div class="timeline-body">
          {uiState === 'loading' && (
            <div class="blog-loading">
              <Loader />
            </div>
          )}
          {uiState === 'error' && (
            <div class="blog-error">
              <Trans>Unable to load blog posts.</Trans>
              <br />
              <button
                class="textual"
                onClick={() => {
                  setUIState('loading');
                  fetch(BLOG_FEED_URL)
                    .then((r) => r.text())
                    .then((text) => {
                      setPosts(parseFeed(text));
                      setUIState('default');
                    })
                    .catch(() => setUIState('error'));
                }}
              >
                <Trans>Retry</Trans>
              </button>
            </div>
          )}
          {uiState === 'default' &&
            posts.map((post, i) => <BlogPostCard key={post.link || i} post={post} />)}
        </div>
      </div>
    </div>
  );
}

export default Blog;
