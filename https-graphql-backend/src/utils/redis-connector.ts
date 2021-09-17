import * as Redis from 'ioredis';
import { RedisPubSub } from "graphql-redis-subscriptions";
import { getLoadedEnvVariables } from "./env-loader";


function getRedisConnection(): { pubsub: RedisPubSub } {
    const { REDIS_ENDPOINT, REDIS_PORT } = getLoadedEnvVariables();
    const options = {
        host: REDIS_ENDPOINT,
        port: Number(REDIS_PORT),
        retryStrategy: (times: number) => {
            // reconnect after
            return Math.min(times * 50, 2000);
        }
    };

    return {
        pubsub: new RedisPubSub({
            messageEventName: 'messageBuffer',
            pmessageEventName: 'pmessageBuffer',
            publisher: new Redis.default(options),
            subscriber: new Redis.default(options)
        })
    };
}

export { getRedisConnection };