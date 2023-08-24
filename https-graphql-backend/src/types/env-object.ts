export interface EnvObject extends Record<string,string> {
    GOOGLE_CLIENT_ID: string,
    GOOGLE_CLIENT_SECRET: string,
    SESSION_SECRET: string,
    REDIRECT_URL: string,
    MONGO_DB_ENDPOINT: string,
    REDIS_ENDPOINT: string,
    REDIS_PORT: string,
    DB_NAME: string,
    HTTPS_PORT: string,
    WHITELIST_MODE: string,
    VAPID_PUBLIC_KEY: string,
    VAPID_PRIVATE_KEY: string
}