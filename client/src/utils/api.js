// Get the base API URL from environment or default based on environment
export const getApiUrl = (path) => {
  const baseUrl = import.meta.env.VITE_SERVER_URL ||
    (import.meta.env.PROD ? '' : 'http://localhost:3000');
  return `${baseUrl}/api${path}`;
};