import axios from 'axios';
import {supabase} from "@/supabaseClient.js";

export function createAuthApiClient(getSession) {
    const instance = axios.create({
        baseURL: import.meta.env.VITE_API_URL,
        timeout: 10000,
    });

    // Request interceptor for auth token
    instance.interceptors.request.use(async (config) => {
        try {
            const session = await getSession();
            if (session?.access_token) {
                config.headers.Authorization = `Bearer ${session.access_token}`;
            }
            return config;
        } catch (error) {
            return Promise.reject(error);
        }
    });

    // Response interceptor for token refresh (if needed)
    instance.interceptors.response.use(
        response => response,
        async error => {

            const originalRequest = error.config;

            // If 401 and we haven't already retried
            if (error.response?.status === 401 && !originalRequest._retry) {
                originalRequest._retry = true;

                try {
                    // Refresh session
                    const { data: { session } } = await supabase.auth.refreshSession();
                    if (session?.access_token) {
                        originalRequest.headers.Authorization = `Bearer ${session.access_token}`;
                        return instance(originalRequest);
                    }
                } catch (refreshError) {
                    console.error('Session refresh failed:', refreshError);
                    // You might want to trigger logout here
                }
            }
            // Add token refresh logic here if needed
            return Promise.reject(error);
        }
    );

    return instance;
}