import * as Redis from 'ioredis';
import { RedisPubSub } from "graphql-redis-subscriptions";
import { EnvLoader } from "./env-loader";

export class RedisSingleton {

    private static instance: RedisSingleton;
    public pubsub: RedisPubSub;
    public static getInstance() {
        if (!RedisSingleton.instance) {
            RedisSingleton.instance = new RedisSingleton()
        }
        return RedisSingleton.instance;
    }

    private constructor() {
        const { REDIS_ENDPOINT, REDIS_PORT } = EnvLoader.getInstance().loadedVariables;
        const options = {
            host: REDIS_ENDPOINT,
            port: Number(REDIS_PORT),
            retryStrategy: (times: number) => {
                // reconnect after
                return Math.min(times * 50, 2000);
            }
        };

        this.pubsub = new RedisPubSub({
            messageEventName: 'messageBuffer',
            pmessageEventName: 'pmessageBuffer',
            publisher: new Redis.default(options),
            subscriber: new Redis.default(options)
        });
    }
}