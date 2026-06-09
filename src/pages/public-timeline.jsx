import './public-timeline.css';

import { useEffect, useRef, useState } from 'preact/hooks';
import { Link } from 'react-router-dom';

import logo from '../assets/logo.svg';

const { PHANPY_DEFAULT_INSTANCE: DEFAULT_INSTANCE } = import.meta.env;

function formatTime(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = (now - date) / 1000; // seconds

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function PostCard({ post }) {
  const isBoost = !!post.reblog;
  const content = post.reblog || post;

  return (
    <article class="pt-post">
      {isBoost && (
        <div class="pt-boost-label">
          ↻ {post.account.display_name || post.account.username} boosted
        </div>
      )}
      <div class="pt-post-header">
        <img
          class="pt-avatar"
          src={content.account.avatar_static || content.account.avatar}
          alt=""
          loading="lazy"
          width="44"
          height="44"
        />
        <div class="pt-account-info">
          <span class="pt-display-name">
            {content.account.display_name || content.account.username}
          </span>
          <span class="pt-acct">@{content.account.acct}</span>
        </div>
        <time class="pt-time" dateTime={content.created_at}>
          {formatTime(content.created_at)}
        </time>
      </div>

      {content.content && (
        <div
          class="pt-content"
          dangerouslySetInnerHTML={{ __html: content.content }}
        />
      )}

      {content.media_attachments?.length > 0 && (
        <div class="pt-media">
          {content.media_attachments.map((media) => {
            if (media.type === 'image') {
              return (
                <img
                  key={media.id}
                  src={media.preview_url || media.url}
                  alt={media.description || ''}
                  loading="lazy"
                />
              );
            }
            if (media.type === 'video' || media.type === 'gifv') {
              return (
                <video
                  key={media.id}
                  src={media.url}
                  poster={media.preview_url}
                  controls
                  loop={media.type === 'gifv'}
                  muted={media.type === 'gifv'}
                  autoPlay={media.type === 'gifv'}
                />
              );
            }
            return null;
          })}
        </div>
      )}
    </article>
  );
}

function PublicTimeline() {
  const [posts, setPosts] = useState([]);
  const [uiState, setUIState] = useState('loading');
  const [maxId, setMaxId] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const loadingMoreRef = useRef(false);

  const fetchPosts = async (olderThan = null) => {
    if (!DEFAULT_INSTANCE) return;
    try {
      let url = `https://${DEFAULT_INSTANCE}/api/v1/timelines/public?local=true&limit=20`;
      if (olderThan) url += `&max_id=${olderThan}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();

      if (data.length === 0) {
        setHasMore(false);
      } else {
        setPosts((prev) => olderThan ? [...prev, ...data] : data);
        setMaxId(data[data.length - 1]?.id);
      }
      return data;
    } catch (e) {
      console.error(e);
      throw e;
    }
  };

  useEffect(() => {
    (async () => {
      try {
        await fetchPosts();
        setUIState('default');
      } catch {
        setUIState('error');
      }
    })();
  }, []);

  const loadMore = async () => {
    if (loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    try {
      await fetchPosts(maxId);
    } catch {
      // silently fail on load-more
    } finally {
      loadingMoreRef.current = false;
    }
  };

  return (
    <main id="public-timeline">
      <header class="pt-header">
        <div class="pt-header-brand">
          <img src={logo} alt="" width="28" height="28" />
          <span>{import.meta.env.PHANPY_APP_NAME || 'FreelimbO'}</span>
        </div>
        <Link to="/login" class="button plain6">
          Log in
        </Link>
      </header>

      <div class="pt-posts">
        {uiState === 'loading' && (
          <div class="pt-loader">Loading posts…</div>
        )}
        {uiState === 'error' && (
          <div class="pt-error">
            Could not load posts.{' '}
            <button
              class="textual"
              onClick={() => {
                setUIState('loading');
                fetchPosts().then(() => setUIState('default')).catch(() => setUIState('error'));
              }}
            >
              Retry
            </button>
          </div>
        )}
        {uiState === 'default' && posts.length === 0 && (
          <div class="pt-empty">No public posts yet.</div>
        )}
        {uiState === 'default' &&
          posts.map((post) => <PostCard key={post.id} post={post} />)}

        {uiState === 'default' && hasMore && (
          <button class="pt-load-more" onClick={loadMore}>
            Load more
          </button>
        )}
      </div>

      <footer class="pt-footer">
        Powered by{' '}
        <a href="https://github.com/cheeaun/phanpy" target="_blank" rel="noopener noreferrer">
          Phanpy
        </a>
      </footer>
    </main>
  );
}

export default PublicTimeline;
