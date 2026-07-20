/*
 * Storage driver selection.
 *
 * Routes and the admin UI talk only to this module, so the backing store can
 * change without touching them.
 *
 *   DATABASE_URL set  -> postgres  (required on Vercel: its filesystem is
 *                                   ephemeral, so disk writes are lost on every
 *                                   deploy and cold start)
 *   otherwise         -> local     (JSON + files on disk, for development)
 *
 * Set MS_STORE=local|postgres to override the choice explicitly.
 */
'use strict';

const explicit = (process.env.MS_STORE || '').toLowerCase();
const hasDb = !!(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.MS_DATABASE_URL);
const usePostgres = explicit ? explicit === 'postgres' : hasDb;

// Fail loudly rather than silently writing applications to a disk that will be
// wiped — losing a family's application is worse than refusing to boot.
if (!usePostgres && (process.env.VERCEL || process.env.NODE_ENV === 'production')) {
  console.error(
    '[Masters] FATAL: running in production without DATABASE_URL. The local ' +
    'storage driver writes to an ephemeral filesystem and WILL lose submitted ' +
    'applications. Set DATABASE_URL (see tests/README.md).'
  );
}

module.exports = usePostgres ? require('./store.postgres') : require('./store.local');
