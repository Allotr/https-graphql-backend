export interface EnvObject extends Record<string,string> {
    MONGO_DB_ENDPOINT: string,
    DB_NAME: string,
    IS_HTTPS: string,
    SSL_CRT_FILE: string,
    SSL_KEY_FILE: string,
    HTTPS_PORT: string
}