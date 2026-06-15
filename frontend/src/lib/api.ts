const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

export const API_BASE = BACKEND_URL;
export const WS_BASE = BACKEND_URL.replace(/^http/, 'ws');
