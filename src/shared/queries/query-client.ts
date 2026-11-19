import { QueryClient } from '@tanstack/react-query';

/**
 * The app's one query cache. It lives here, apart from the entry module that
 * mounts the app: code that reads or invalidates the cache outside a
 * component imports it without importing (and so running) the entry.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // Data stays fresh for 5 minutes
      gcTime: 1000 * 60 * 10, // Unused data is kept for 10
      retry: 1, // Once, not the default three times
      refetchOnWindowFocus: false,
    },
  },
});
