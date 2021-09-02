export interface EnvObject extends Record<string,string> {
    GOOGLE_CLIENT_ID: string,
    GOOGLE_CLIENT_SECRET: string,
    GOOGLE_CALLBACK_URL: string,
    SESSION_SECRET: string,
    REDIRECT_URL: string,
    VAPID_PRIVATE_KEY: string,
    VAPID_PUBLIC_KEY: string,
    MONGO_DB_ENDPOINT: string,
    DB_NAME: string,
    REDIS_ENDPOINT: string,
    REDIS_PORT: string,
    IS_HTTPS: string,
    SSL_CRT_FILE: string,
    SSL_KEY_FILE: string,
    HTTPS_PORT: string,
    WS_PATH: string
}